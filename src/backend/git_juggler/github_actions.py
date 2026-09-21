from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from git import Repo

from .schemas import CiRunInfo


GITHUB_RUNS_PER_PAGE = 100
GITHUB_RUNS_MAX_PAGES = 10


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _duration_ms(created_at: str | None, updated_at: str | None) -> int | None:
    start = _parse_time(created_at)
    end = _parse_time(updated_at)
    if start is None or end is None:
        return None
    return max(0, int((end - start).total_seconds() * 1000))


def _normalize_status(status: str | None, conclusion: str | None) -> str:
    if status in {"queued", "in_progress", "requested", "waiting", "pending"}:
        return "running"
    if conclusion in {"failure", "timed_out"}:
        return "failure"
    if conclusion in {"success", "cancelled", "skipped", "action_required", "neutral"}:
        return conclusion
    return "unknown"


def _matching_repo_config(github_config: dict, repo_path: Path) -> dict | None:
    for item in github_config.get("repos", []):
        if not isinstance(item, dict):
            continue
        raw_path = item.get("repo_path")
        if not isinstance(raw_path, str):
            continue
        try:
            configured_path = Path(raw_path).expanduser().resolve()
        except Exception:
            continue
        if configured_path == repo_path.resolve():
            return item
    return None


def _api_base_url_for_host(host: str) -> str | None:
    normalized = host.lower().removeprefix("www.")
    if normalized == "github.com":
        return "https://api.github.com"
    if "." not in normalized:
        return None
    return f"https://{normalized}/api/v3"


def _repo_config_from_remote_url(url: str) -> dict | None:
    parsed = urlparse(url)
    if parsed.scheme:
        host = parsed.hostname or ""
        path = parsed.path.lstrip("/")
    else:
        if ":" not in url:
            return None
        host, path = url.split(":", 1)
        if "@" in host:
            host = host.rsplit("@", 1)[1]

    api_base_url = _api_base_url_for_host(host)
    if api_base_url is None:
        return None

    parts = path.removesuffix(".git").split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return {"api_base_url": api_base_url, "owner": parts[0], "repo": parts[1]}


def _inferred_repo_config(repo_path: Path) -> dict | None:
    try:
        remote_url = Repo(repo_path).remotes.origin.url
    except Exception:
        return None
    if not isinstance(remote_url, str):
        return None
    return _repo_config_from_remote_url(remote_url)


def _fetch_workflow_runs(github_config: dict, repo_config: dict) -> list[dict]:
    api_base_url = str(
        repo_config.get("api_base_url") or github_config.get("api_base_url") or "https://api.github.com"
    ).rstrip("/")
    owner = repo_config.get("owner")
    repo = repo_config.get("repo")
    if not isinstance(owner, str) or not owner or not isinstance(repo, str) or not repo:
        return []

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "git-juggler",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    token_env = github_config.get("token_env") or "GITHUB_TOKEN"
    token = os.environ.get(token_env) if isinstance(token_env, str) and token_env else None
    if token:
        headers["Authorization"] = f"Bearer {token}"

    all_runs: list[dict] = []
    for page in range(1, GITHUB_RUNS_MAX_PAGES + 1):
        query = urlencode({"per_page": str(GITHUB_RUNS_PER_PAGE), "page": str(page)})
        url = f"{api_base_url}/repos/{owner}/{repo}/actions/runs?{query}"
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=10) as response:  # noqa: S310 - configured user URL, read-only local app integration
                body = response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError, OSError):
            return all_runs

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return all_runs

        runs = data.get("workflow_runs") if isinstance(data, dict) else None
        page_runs = [run for run in runs if isinstance(run, dict)] if isinstance(runs, list) else []
        all_runs.extend(page_runs)
        if len(page_runs) < GITHUB_RUNS_PER_PAGE:
            break

    return all_runs


def _tag_targets(repo_path: Path) -> dict[str, str]:
    try:
        repo = Repo(repo_path)
    except Exception:
        return {}
    targets: dict[str, str] = {}
    for tag in repo.tags:
        try:
            targets[tag.name] = tag.commit.hexsha
        except Exception:
            continue
    return targets


def _matching_run_sha(run: dict, commit_hashes: set[str], tags_by_name: dict[str, str]) -> str | None:
    sha = run.get("head_sha")
    if isinstance(sha, str) and sha in commit_hashes:
        return sha

    # Tag-triggered workflows can be reported by tag name rather than by a
    # branch name. Match those back to the local tag's target commit.
    head_branch = run.get("head_branch")
    if isinstance(head_branch, str):
        tag_name = head_branch.removeprefix("refs/tags/")
        tag_sha = tags_by_name.get(tag_name)
        if tag_sha in commit_hashes:
            return tag_sha

    return None


def get_github_actions_runs(repo_path: Path, commit_hashes: set[str], github_config: dict | None) -> dict[str, list[CiRunInfo]]:
    if not commit_hashes:
        return {}

    github_config = github_config or {}
    repo_config = _matching_repo_config(github_config, repo_path)
    if repo_config is None and github_config.get("auto_detect", True):
        repo_config = _inferred_repo_config(repo_path)
    if repo_config is None:
        return {}

    by_sha: dict[str, list[CiRunInfo]] = {}
    tags_by_name = _tag_targets(repo_path)
    for run in _fetch_workflow_runs(github_config, repo_config):
        sha = _matching_run_sha(run, commit_hashes, tags_by_name)
        if sha is None:
            continue

        created_at = run.get("created_at") if isinstance(run.get("created_at"), str) else None
        updated_at = run.get("updated_at") if isinstance(run.get("updated_at"), str) else None
        info = CiRunInfo(
            provider="github_actions",
            status=_normalize_status(run.get("status"), run.get("conclusion")),
            name=str(run.get("name") or run.get("display_title") or "GitHub Actions"),
            number=int(run.get("run_number") or 0),
            url=str(run.get("html_url") or ""),
            branch=run.get("head_branch") if isinstance(run.get("head_branch"), str) else None,
            event=run.get("event") if isinstance(run.get("event"), str) else None,
            created_at=created_at,
            updated_at=updated_at,
            duration_ms=_duration_ms(created_at, updated_at),
        )
        by_sha.setdefault(sha, []).append(info)

    return by_sha

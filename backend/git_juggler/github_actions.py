from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import GitHubActionsRunInfo


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


def _fetch_workflow_runs(github_config: dict, repo_config: dict) -> list[dict]:
    api_base_url = str(github_config.get("api_base_url") or "https://api.github.com").rstrip("/")
    owner = repo_config.get("owner")
    repo = repo_config.get("repo")
    if not isinstance(owner, str) or not owner or not isinstance(repo, str) or not repo:
        return []

    query = urlencode({"per_page": "100"})
    url = f"{api_base_url}/repos/{owner}/{repo}/actions/runs?{query}"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "git-juggler",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    token_env = github_config.get("token_env")
    token = os.environ.get(token_env) if isinstance(token_env, str) and token_env else None
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured user URL, read-only local app integration
            body = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError, OSError):
        return []

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []

    runs = data.get("workflow_runs") if isinstance(data, dict) else None
    return [run for run in runs if isinstance(run, dict)] if isinstance(runs, list) else []


def get_github_actions_runs(repo_path: Path, commit_hashes: set[str], github_config: dict | None) -> dict[str, list[GitHubActionsRunInfo]]:
    if not github_config or not commit_hashes:
        return {}

    repo_config = _matching_repo_config(github_config, repo_path)
    if repo_config is None:
        return {}

    by_sha: dict[str, list[GitHubActionsRunInfo]] = {}
    for run in _fetch_workflow_runs(github_config, repo_config):
        sha = run.get("head_sha")
        if not isinstance(sha, str) or sha not in commit_hashes:
            continue

        created_at = run.get("created_at") if isinstance(run.get("created_at"), str) else None
        updated_at = run.get("updated_at") if isinstance(run.get("updated_at"), str) else None
        info = GitHubActionsRunInfo(
            status=_normalize_status(run.get("status"), run.get("conclusion")),
            workflow_name=str(run.get("name") or run.get("display_title") or "GitHub Actions"),
            run_number=int(run.get("run_number") or 0),
            run_id=int(run.get("id") or 0),
            url=str(run.get("html_url") or ""),
            branch=run.get("head_branch") if isinstance(run.get("head_branch"), str) else None,
            event=run.get("event") if isinstance(run.get("event"), str) else None,
            created_at=created_at,
            updated_at=updated_at,
            duration_ms=_duration_ms(created_at, updated_at),
        )
        by_sha.setdefault(sha, []).append(info)

    return by_sha

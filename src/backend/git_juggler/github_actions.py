from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from git import Repo

from .schemas import CiRunInfo, CiStage


GITHUB_RUNS_PER_PAGE = 100
GITHUB_RUNS_MAX_PAGES = 10
ACTIVE_RUN_STATUSES = {"queued", "in_progress", "waiting", "pending", "requested"}


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


def _api_base_url(github_config: dict, repo_config: dict) -> str:
    return str(
        repo_config.get("api_base_url") or github_config.get("api_base_url") or "https://api.github.com"
    ).rstrip("/")


def _headers(github_config: dict) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "git-juggler",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token_env = github_config.get("token_env") or "GITHUB_TOKEN"
    token = os.environ.get(token_env) if isinstance(token_env, str) and token_env else None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _repo_api_url(github_config: dict, repo_config: dict) -> str | None:
    owner = repo_config.get("owner")
    repo = repo_config.get("repo")
    if not isinstance(owner, str) or not owner or not isinstance(repo, str) or not repo:
        return None
    return f"{_api_base_url(github_config, repo_config)}/repos/{owner}/{repo}"


def _get_json(url: str, headers: dict[str, str]) -> dict | None:
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured user URL, read-only local app integration
            body = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError, OSError):
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _fetch_workflow_runs(github_config: dict, repo_config: dict) -> list[dict]:
    repo_url = _repo_api_url(github_config, repo_config)
    if repo_url is None:
        return []
    headers = _headers(github_config)

    all_runs: list[dict] = []
    for page in range(1, GITHUB_RUNS_MAX_PAGES + 1):
        query = urlencode({"per_page": str(GITHUB_RUNS_PER_PAGE), "page": str(page)})
        data = _get_json(f"{repo_url}/actions/runs?{query}", headers)
        if data is None:
            return all_runs
        runs = data.get("workflow_runs")
        page_runs = [run for run in runs if isinstance(run, dict)] if isinstance(runs, list) else []
        all_runs.extend(page_runs)
        if len(page_runs) < GITHUB_RUNS_PER_PAGE:
            break

    return all_runs


def _stage_status(status: str | None, conclusion: str | None) -> str:
    if status in {"queued", "waiting", "pending", "requested"}:
        return "pending"
    return _normalize_status(status, conclusion)


def _run_info(run: dict) -> CiRunInfo:
    created_at = run.get("created_at") if isinstance(run.get("created_at"), str) else None
    updated_at = run.get("updated_at") if isinstance(run.get("updated_at"), str) else None
    run_id = run.get("id")
    return CiRunInfo(
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
        run_id=str(run_id) if isinstance(run_id, int) else None,
    )


def _resolve_repo_config(github_config: dict, repo_path: Path) -> dict | None:
    repo_config = _matching_repo_config(github_config, repo_path)
    if repo_config is None and github_config.get("auto_detect", True):
        repo_config = _inferred_repo_config(repo_path)
    return repo_config


def _stage_from_job_or_step(item: dict, steps: list[CiStage] | None = None) -> CiStage:
    started_at = item.get("started_at") if isinstance(item.get("started_at"), str) else None
    completed_at = item.get("completed_at") if isinstance(item.get("completed_at"), str) else None
    return CiStage(
        name=str(item.get("name") or "job"),
        status=_stage_status(item.get("status"), item.get("conclusion")),
        started_at=started_at,
        duration_ms=_duration_ms(started_at, completed_at),
        steps=steps,
    )


def _fetch_run_stages(github_config: dict, repo_config: dict, run_id: str) -> list[CiStage] | None:
    repo_url = _repo_api_url(github_config, repo_config)
    if repo_url is None or not run_id.isdigit():
        return None
    data = _get_json(f"{repo_url}/actions/runs/{run_id}/jobs?per_page=100", _headers(github_config))
    jobs = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(jobs, list):
        return None
    stages: list[CiStage] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        raw_steps = job.get("steps")
        steps = (
            [_stage_from_job_or_step(step) for step in raw_steps if isinstance(step, dict)]
            if isinstance(raw_steps, list)
            else None
        )
        stages.append(_stage_from_job_or_step(job, steps or None))
    return stages


def get_run_stages(repo_path: Path, github_config: dict | None, run_id: str) -> list[CiStage] | None:
    github_config = github_config or {}
    repo_config = _resolve_repo_config(github_config, repo_path)
    if repo_config is None:
        return None
    return _fetch_run_stages(github_config, repo_config, run_id)


def get_active_runs(repo_path: Path, github_config: dict | None) -> list[CiRunInfo]:
    """Runs that are queued or in progress right now, with their stages.
    Independent of the commit graph: works for commits that aren't loaded."""
    github_config = github_config or {}
    repo_config = _resolve_repo_config(github_config, repo_path)
    if repo_config is None:
        return []
    repo_url = _repo_api_url(github_config, repo_config)
    if repo_url is None:
        return []
    headers = _headers(github_config)

    # One call per repo (the `status` filter takes a single value, and this is
    # polled across every repo, so requests are kept low against rate limits):
    # the latest runs, filtered here to the ones still going.
    data = _get_json(f"{repo_url}/actions/runs?{urlencode({'per_page': '30'})}", headers)
    items = data.get("workflow_runs") if isinstance(data, dict) else None
    runs = [
        run
        for run in (items if isinstance(items, list) else [])
        if isinstance(run, dict) and run.get("status") in ACTIVE_RUN_STATUSES
    ]

    result: list[CiRunInfo] = []
    for run in runs:
        info = _run_info(run)
        if info.run_id:
            info.stages = _fetch_run_stages(github_config, repo_config, info.run_id)
        result.append(info)
    return result


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
    repo_config = _resolve_repo_config(github_config, repo_path)
    if repo_config is None:
        return {}

    by_sha: dict[str, list[CiRunInfo]] = {}
    tags_by_name = _tag_targets(repo_path)
    for run in _fetch_workflow_runs(github_config, repo_config):
        sha = _matching_run_sha(run, commit_hashes, tags_by_name)
        if sha is None:
            continue

        info = _run_info(run)
        by_sha.setdefault(sha, []).append(info)

    return by_sha

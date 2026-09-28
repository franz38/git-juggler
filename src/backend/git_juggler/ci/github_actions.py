from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from git import Repo

from . import run_cache
from .http import fetch_json
from ..schemas import CiRunInfo, CiStage


PROVIDER = "github_actions"
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
    return fetch_json(url, headers, opener=urlopen)


# Conditional-request cache for the polling calls: GitHub answers a request
# carrying a matching `If-None-Match` with 304, which does not count against
# the rate limit, so polling an unchanged run is free.
_ETAG_CACHE: dict[str, tuple[str, dict]] = {}
_ETAG_CACHE_MAX = 256


def _get_json_cached(url: str, headers: dict[str, str]) -> dict | None:
    cached = _ETAG_CACHE.get(url)
    request_headers = dict(headers)
    if cached:
        request_headers["If-None-Match"] = cached[0]
    request = Request(url, headers=request_headers)
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured user URL, read-only local app integration
            body = response.read().decode("utf-8")
            etag = response.headers.get("ETag")
    except HTTPError as e:
        return cached[1] if e.code == 304 and cached else None
    except (URLError, TimeoutError, OSError):
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    if etag:
        if len(_ETAG_CACHE) >= _ETAG_CACHE_MAX:
            _ETAG_CACHE.pop(next(iter(_ETAG_CACHE)))
        _ETAG_CACHE[url] = (etag, data)
    return data


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
        head_sha=run.get("head_sha") if isinstance(run.get("head_sha"), str) else None,
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
    data = _get_json_cached(f"{repo_url}/actions/runs/{run_id}/jobs?per_page=100", _headers(github_config))
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
    """A run's jobs/steps; a finished run's come from the run cache once stored."""
    github_config = github_config or {}
    repo_config = _resolve_repo_config(github_config, repo_path)
    if repo_config is None:
        return None
    cached = run_cache.get(PROVIDER, run_id)
    if cached is not None and cached.run.stages is not None:
        return cached.run.stages
    stages = _fetch_run_stages(github_config, repo_config, run_id)
    if stages is not None and cached is not None:
        run_cache.put_stages(PROVIDER, run_id, stages)
    return stages


def _remember_runs(scope: str, runs: list[tuple[CiRunInfo, set[str]]]) -> None:
    """Store the finished runs among `runs` (with the commits they match). A
    stored run that changed since (re-run: same id, new attempt) is replaced,
    dropping its old stages."""
    stored = run_cache.get_many(PROVIDER, [info.run_id for info, _ in runs if info.run_id])
    for info, shas in runs:
        cached = stored.get(info.run_id or "")
        if cached is not None:
            if cached.run.updated_at == info.updated_at and cached.run.status == info.status:
                continue
            run_cache.delete(PROVIDER, cached.run.run_id or "")
        run_cache.put(PROVIDER, scope, info, shas)


def _unlisted_cached_runs(scope: str, listed: list[CiRunInfo], limit: int | None = None) -> list[run_cache.CachedRun]:
    """Stored runs of the repo that the live listing didn't return, marked
    `archived` when they fall inside the listed time range (so GitHub no longer
    has them); older ones may just be past the capped listing."""
    listed_ids = {info.run_id for info in listed}
    oldest = min((info.created_at for info in listed if info.created_at), default=None)
    result: list[run_cache.CachedRun] = []
    for cached in run_cache.for_scope_prefixes(PROVIDER, [scope], limit):
        if cached.run.run_id in listed_ids:
            continue
        cached.run.archived = oldest is not None and (cached.run.created_at or "") >= oldest
        result.append(cached)
    return result


def get_active_runs(repo_path: Path, github_config: dict | None, head_sha: str | None = None) -> list[CiRunInfo]:
    """Runs that are queued or in progress right now, with their stages.
    Independent of the commit graph: works for commits that aren't loaded.
    With `head_sha` only that commit's runs are listed (the pipeline of a
    commit action that was just performed)."""
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
    query = {"per_page": "30"}
    if head_sha:
        query["head_sha"] = head_sha
    data = _get_json_cached(f"{repo_url}/actions/runs?{urlencode(query)}", headers)
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


def get_recent_runs(repo_path: Path, github_config: dict | None, limit: int) -> list[CiRunInfo]:
    """The repo's latest runs, running or finished, newest first, without
    stages. Same single cached call as `get_active_runs`."""
    github_config = github_config or {}
    repo_config = _resolve_repo_config(github_config, repo_path)
    repo_url = _repo_api_url(github_config, repo_config) if repo_config else None
    if repo_url is None:
        return []
    data = _get_json_cached(f"{repo_url}/actions/runs?{urlencode({'per_page': '30'})}", _headers(github_config))
    items = data.get("workflow_runs") if isinstance(data, dict) else None
    listed = [_run_info(run) for run in (items if isinstance(items, list) else []) if isinstance(run, dict)]
    _remember_runs(repo_url, [(info, {info.head_sha} if info.head_sha else set()) for info in listed])
    archived = [cached.run for cached in _unlisted_cached_runs(repo_url, listed, limit) if cached.run.archived]
    return sorted(listed[:limit] + archived, key=lambda info: info.created_at or "", reverse=True)[:limit]


def get_runs_by_id(repo_path: Path, github_config: dict | None, run_ids: list[str]) -> list[CiRunInfo]:
    """Current state of specific runs (one conditional call per run, plus one
    for the stages of a run that is still going). A run that has finished comes
    back with its final status and without stages."""
    github_config = github_config or {}
    repo_config = _resolve_repo_config(github_config, repo_path)
    repo_url = _repo_api_url(github_config, repo_config) if repo_config else None
    if repo_config is None or repo_url is None:
        return []
    headers = _headers(github_config)

    result: list[CiRunInfo] = []
    for run_id in run_ids:
        if not run_id.isdigit():
            continue
        data = _get_json_cached(f"{repo_url}/actions/runs/{run_id}", headers)
        if data is None:
            continue
        info = _run_info(data)
        if info.status == "running" and info.run_id:
            info.stages = _fetch_run_stages(github_config, repo_config, info.run_id)
        result.append(info)
    return result


def poll_runs(
    repo_path: Path,
    github_config: dict | None,
    run_ids: list[str] | None,
    head_sha: str | None = None,
) -> list[CiRunInfo]:
    """`run_ids=None`: every active run of the repo (discovery). Otherwise
    exactly those runs, whatever their state."""
    if run_ids is None:
        return get_active_runs(repo_path, github_config, head_sha)
    return get_runs_by_id(repo_path, github_config, run_ids)


def test_connection(github_config: dict | None) -> tuple[bool, str]:
    """Read-only connectivity check for the settings screen."""
    github_config = github_config or {}
    api_base = str(github_config.get("api_base_url") or "https://api.github.com").rstrip("/")
    data = _get_json(f"{api_base}/rate_limit", _headers(github_config))
    if data is None:
        return False, f"Could not reach {api_base} with the current settings."
    token_env = github_config.get("token_env") or "GITHUB_TOKEN"
    token_note = f" using ${token_env}" if isinstance(token_env, str) and os.environ.get(token_env) else " without a token"
    return True, f"Connected to {api_base}{token_note}."


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
    listed: list[tuple[CiRunInfo, set[str]]] = []
    for run in _fetch_workflow_runs(github_config, repo_config):
        info = _run_info(run)
        sha = _matching_run_sha(run, commit_hashes, tags_by_name)
        listed.append((info, {s for s in (info.head_sha, sha) if s}))
        if sha is not None:
            by_sha.setdefault(sha, []).append(info)

    # Runs GitHub no longer lists (pruned past its retention) come from the cache.
    repo_url = _repo_api_url(github_config, repo_config)
    if repo_url is not None:
        _remember_runs(repo_url, listed)
        for cached in _unlisted_cached_runs(repo_url, [info for info, _ in listed]):
            for sha in cached.shas & commit_hashes:
                by_sha.setdefault(sha, []).append(cached.run.model_copy(update={"stages": None}))

    return by_sha

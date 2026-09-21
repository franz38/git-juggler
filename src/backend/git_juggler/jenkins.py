from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlparse
from urllib.request import Request, urlopen

from .schemas import CiRunInfo


def _matching_job_configs(jenkins_config: dict, repo_path: Path) -> list[dict]:
    matches: list[dict] = []
    for item in jenkins_config.get("jobs", []):
        if not isinstance(item, dict):
            continue
        raw_path = item.get("repo_path")
        job_url = item.get("job_url")
        if not isinstance(raw_path, str) or not isinstance(job_url, str) or not job_url:
            continue
        try:
            configured_path = Path(raw_path).expanduser().resolve()
        except Exception:
            continue
        if configured_path == repo_path.resolve():
            matches.append(item)
    return matches


def _headers(jenkins_config: dict) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "git-juggler"}
    username = jenkins_config.get("username")
    token_env = jenkins_config.get("api_token_env") or "JENKINS_API_TOKEN"
    token = os.environ.get(token_env) if isinstance(token_env, str) and token_env else None
    if isinstance(username, str) and username and token:
        encoded = base64.b64encode(f"{username}:{token}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {encoded}"
    return headers


def _fetch_json(url: str, headers: dict[str, str]) -> dict | None:
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


def _normalize_status(result: object, building: object) -> str:
    if building is True:
        return "running"
    if result == "SUCCESS":
        return "success"
    if result == "FAILURE":
        return "failure"
    if result == "UNSTABLE":
        return "unstable"
    if result == "ABORTED":
        return "aborted"
    return "unknown"


def _timestamp_ms_to_iso(value: object) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _extract_parameters(actions: object) -> dict[str, str]:
    params: dict[str, str] = {}
    if not isinstance(actions, list):
        return params
    for action in actions:
        if not isinstance(action, dict):
            continue
        raw_params = action.get("parameters")
        if not isinstance(raw_params, list):
            continue
        for item in raw_params:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            value = item.get("value")
            if isinstance(name, str) and isinstance(value, str):
                params[name] = value
    return params


def _extract_branch(actions: object, params: dict[str, str]) -> str | None:
    for key in ("BRANCH_NAME", "GIT_BRANCH"):
        branch = params.get(key)
        if branch:
            return branch
    if not isinstance(actions, list):
        return None
    for action in actions:
        if not isinstance(action, dict):
            continue
        revision = action.get("lastBuiltRevision")
        if not isinstance(revision, dict):
            continue
        branches = revision.get("branch")
        if not isinstance(branches, list):
            continue
        for branch in branches:
            if isinstance(branch, dict) and isinstance(branch.get("name"), str):
                return branch["name"]
    return None


def _extract_commit_shas(build: dict) -> set[str]:
    shas: set[str] = set()
    actions = build.get("actions")
    if isinstance(actions, list):
        for action in actions:
            if not isinstance(action, dict):
                continue
            revision = action.get("lastBuiltRevision")
            if isinstance(revision, dict) and isinstance(revision.get("SHA1"), str):
                shas.add(revision["SHA1"])

    change_set = build.get("changeSet")
    items = change_set.get("items") if isinstance(change_set, dict) else None
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("commitId"), str):
                shas.add(item["commitId"])

    params = _extract_parameters(actions)
    git_commit = params.get("GIT_COMMIT")
    if git_commit:
        shas.add(git_commit)

    return shas


def _job_name(job_url: str) -> str:
    path_parts = [unquote(part) for part in urlparse(job_url).path.split("/") if part]
    names: list[str] = []
    for index, part in enumerate(path_parts):
        if part == "job" and index + 1 < len(path_parts):
            names.append(path_parts[index + 1])
    return "/".join(names) if names else "Jenkins"


def _fetch_job_build_refs(job_url: str, build_limit: int, headers: dict[str, str]) -> list[dict]:
    limit = max(1, min(build_limit, 500))
    tree = f"builds[number,url]{{0,{limit}}}"
    query = urlencode({"tree": tree})
    data = _fetch_json(f"{job_url.rstrip('/')}/api/json?{query}", headers)
    builds = data.get("builds") if isinstance(data, dict) else None
    return [build for build in builds if isinstance(build, dict)] if isinstance(builds, list) else []


def _fetch_build(build_url: str, headers: dict[str, str]) -> dict | None:
    tree = "number,url,result,building,timestamp,duration,actions[lastBuiltRevision[SHA1,branch[name]],parameters[name,value]],changeSet[items[commitId]]"
    query = urlencode({"tree": tree})
    return _fetch_json(f"{build_url.rstrip('/')}/api/json?{query}", headers)


def get_jenkins_builds(repo_path: Path, commit_hashes: set[str], jenkins_config: dict | None) -> dict[str, list[CiRunInfo]]:
    if not commit_hashes or not jenkins_config:
        return {}
    jobs = _matching_job_configs(jenkins_config, repo_path)
    if not jobs:
        return {}

    headers = _headers(jenkins_config)
    build_limit = jenkins_config.get("build_limit")
    if not isinstance(build_limit, int):
        build_limit = 50

    by_sha: dict[str, list[CiRunInfo]] = {}
    for job in jobs:
        job_url = job.get("job_url")
        if not isinstance(job_url, str) or not job_url:
            continue
        name = _job_name(job_url)
        for build_ref in _fetch_job_build_refs(job_url, build_limit, headers):
            build_url = build_ref.get("url")
            if not isinstance(build_url, str) or not build_url:
                continue
            build = _fetch_build(build_url, headers)
            if build is None:
                continue
            matching_shas = _extract_commit_shas(build) & commit_hashes
            if not matching_shas:
                continue
            actions = build.get("actions")
            params = _extract_parameters(actions)
            info = CiRunInfo(
                provider="jenkins",
                status=_normalize_status(build.get("result"), build.get("building")),
                name=name,
                number=int(build.get("number") or 0),
                url=str(build.get("url") or build_url),
                branch=_extract_branch(actions, params),
                event=None,
                created_at=_timestamp_ms_to_iso(build.get("timestamp")),
                updated_at=None,
                duration_ms=int(build.get("duration")) if isinstance(build.get("duration"), int) else None,
            )
            for sha in matching_shas:
                by_sha.setdefault(sha, []).append(info)

    return by_sha

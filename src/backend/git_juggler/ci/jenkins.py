from __future__ import annotations

import base64
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlencode, urlparse
from urllib.request import urlopen

from git import InvalidGitRepositoryError, NoSuchPathError, Repo

from .http import fetch_json
from ..schemas import CiRunInfo, CiStage


_TEMPLATE_RE = re.compile(r"\{([A-Za-z0-9_]+)\}")
_BRANCH_TEMPLATE_RE = re.compile(r"\{branch_[A-Za-z0-9_]+\}")


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or value


def _repo_template_values(repo_path: Path) -> dict[str, str]:
    resolved = repo_path.expanduser().resolve()
    repo_name = resolved.name
    repo_slug = _slug(repo_name)
    return {
        "repo_path": str(resolved),
        "repo_name": repo_name,
        "repo_name_url": quote(repo_name, safe=""),
        "repo_slug": repo_slug,
        "repo_slug_url": quote(repo_slug, safe=""),
    }


def _branch_template_values(branch_name: str | None) -> dict[str, str]:
    if not branch_name:
        return {}
    branch_slug = _slug(branch_name)
    return {
        "branch_name": branch_name,
        "branch_name_url": quote(branch_name, safe=""),
        "branch_slug": branch_slug,
        "branch_slug_url": quote(branch_slug, safe=""),
    }


def _render_template(value: str, values: dict[str, str]) -> str:
    return _TEMPLATE_RE.sub(lambda match: values.get(match.group(1), match.group(0)), value)


def _has_branch_template(value: str) -> bool:
    return _BRANCH_TEMPLATE_RE.search(value) is not None


def _matches_repo_path(raw_path: str, repo_path: Path, values: dict[str, str]) -> bool:
    rendered_path = _render_template(raw_path, values).strip()
    if rendered_path == "*":
        return True
    try:
        return Path(rendered_path).expanduser().resolve() == repo_path.resolve()
    except Exception:
        return False


def _render_job_config(item: dict, repo_path: Path, values: dict[str, str], branch_name: str | None) -> dict | None:
    job_url = item.get("job_url")
    if not isinstance(job_url, str) or not job_url:
        return None
    if _has_branch_template(job_url) and not branch_name:
        return None
    rendered = _render_template(job_url, {**values, **_branch_template_values(branch_name)})
    return {**item, "repo_path": str(repo_path.resolve()), "job_url": rendered}


def _matching_rule_job_configs(jenkins_config: dict, repo_path: Path, values: dict[str, str], branch_name: str | None) -> list[dict]:
    for rule in jenkins_config.get("rules", []):
        if not isinstance(rule, dict):
            continue
        repo_paths = rule.get("repo_paths")
        if not isinstance(repo_paths, list) or not any(
            isinstance(raw_path, str) and _matches_repo_path(raw_path, repo_path, values) for raw_path in repo_paths
        ):
            continue
        rendered = _render_job_config({"repo_path": str(repo_path), "job_url": rule.get("job_url")}, repo_path, values, branch_name)
        if rendered is not None:
            return [rendered]
        return []
    return []


def _matching_job_configs(jenkins_config: dict, repo_path: Path, branch_name: str | None = None) -> list[dict]:
    values = _repo_template_values(repo_path)
    return _matching_rule_job_configs(jenkins_config, repo_path, values, branch_name)


def _job_url_prefixes(jenkins_config: dict, repo_path: Path) -> list[str]:
    values = _repo_template_values(repo_path)
    prefixes: list[str] = []
    for job in _matching_job_configs(jenkins_config, repo_path):
        prefixes.append(str(job["job_url"]).rstrip("/"))

    items: list[dict] = []
    for rule in jenkins_config.get("rules", []):
        if not isinstance(rule, dict):
            continue
        repo_paths = rule.get("repo_paths")
        if not isinstance(repo_paths, list) or not any(
            isinstance(raw_path, str) and _matches_repo_path(raw_path, repo_path, values) for raw_path in repo_paths
        ):
            continue
        items.append({"job_url": rule.get("job_url")})
        break

    for item in items:
        raw_url = item.get("job_url")
        if not isinstance(raw_url, str) or not _has_branch_template(raw_url):
            continue
        prefix_template = _BRANCH_TEMPLATE_RE.split(raw_url, maxsplit=1)[0]
        prefix = _render_template(prefix_template, values).rstrip("/")
        if prefix:
            prefixes.append(prefix)
    return list(dict.fromkeys(prefixes))


def _headers(jenkins_config: dict) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "git-juggler"}
    username = jenkins_config.get("username")
    token_env = jenkins_config.get("api_token_env") or "JENKINS_API_TOKEN"
    token = os.environ.get(token_env) if isinstance(token_env, str) and token_env else None
    if isinstance(username, str) and username and token:
        encoded = base64.b64encode(f"{username}:{token}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {encoded}"
    return headers


def _default_branch(repo_path: Path) -> str | None:
    try:
        names = {head.name for head in Repo(repo_path).heads}
    except (InvalidGitRepositoryError, NoSuchPathError, OSError):
        return None
    if "main" in names:
        return "main"
    if "master" in names:
        return "master"
    return None


def _fetch_json(url: str, headers: dict[str, str]) -> dict | None:
    return fetch_json(url, headers, opener=urlopen)


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


def _head_sha(build: dict) -> str | None:
    """The commit a build ran on: the last built revision, else GIT_COMMIT.
    (The change set lists every commit since the previous build, so it says
    nothing about which one is the head.)"""
    actions = build.get("actions")
    if isinstance(actions, list):
        for action in actions:
            revision = action.get("lastBuiltRevision") if isinstance(action, dict) else None
            if isinstance(revision, dict) and isinstance(revision.get("SHA1"), str):
                return revision["SHA1"]
    return _extract_parameters(actions).get("GIT_COMMIT")


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


def _build_info(build: dict, name: str, build_url: str) -> CiRunInfo:
    actions = build.get("actions")
    params = _extract_parameters(actions)
    url = str(build.get("url") or build_url)
    return CiRunInfo(
        provider="jenkins",
        status=_normalize_status(build.get("result"), build.get("building")),
        name=name,
        number=int(build.get("number") or 0),
        url=url,
        branch=_extract_branch(actions, params),
        event=None,
        created_at=_timestamp_ms_to_iso(build.get("timestamp")),
        updated_at=None,
        duration_ms=int(build.get("duration")) if isinstance(build.get("duration"), int) else None,
        run_id=url,
        head_sha=_head_sha(build),
    )


_STAGE_STATUSES = {
    "SUCCESS": "success",
    "FAILED": "failure",
    "IN_PROGRESS": "running",
    "PAUSED_PENDING_INPUT": "action_required",
    "NOT_EXECUTED": "pending",
    "UNSTABLE": "unstable",
    "ABORTED": "aborted",
}


def _fetch_build_stages(build_url: str, headers: dict[str, str]) -> list[CiStage] | None:
    """Stages from the Pipeline Stage View plugin (`wfapi`). None when the
    plugin isn't installed / the job isn't a pipeline (404)."""
    data = _fetch_json(f"{build_url.rstrip('/')}/wfapi/describe", headers)
    raw_stages = data.get("stages") if isinstance(data, dict) else None
    if not isinstance(raw_stages, list):
        return None
    stages: list[CiStage] = []
    for raw in raw_stages:
        if not isinstance(raw, dict):
            continue
        duration = raw.get("durationMillis")
        stages.append(
            CiStage(
                name=str(raw.get("name") or "stage"),
                status=_STAGE_STATUSES.get(str(raw.get("status")), "unknown"),
                started_at=_timestamp_ms_to_iso(raw.get("startTimeMillis")),
                duration_ms=duration if isinstance(duration, int) else None,
            )
        )
    return stages


def get_build_stages(repo_path: Path, jenkins_config: dict | None, build_url: str) -> list[CiStage] | None:
    """Stages for one build. The build URL comes from the client, so it is only
    followed when it lives under a job configured for this repo."""
    if not jenkins_config:
        return None
    wanted = build_url.rstrip("/")
    if any(wanted.startswith(prefix + "/") for prefix in _job_url_prefixes(jenkins_config, repo_path)):
        return _fetch_build_stages(build_url, _headers(jenkins_config))
    return None


def get_active_builds(repo_path: Path, jenkins_config: dict | None, branch_name: str | None = None) -> list[CiRunInfo]:
    """Builds running right now, with their stages."""
    if not jenkins_config:
        return []
    headers = _headers(jenkins_config)
    tree = (
        "builds[number,url,result,building,timestamp,duration,"
        "actions[lastBuiltRevision[SHA1,branch[name]],parameters[name,value]]]{0,10}"
    )
    result: list[CiRunInfo] = []
    for job in _matching_job_configs(jenkins_config, repo_path, branch_name):
        job_url = str(job["job_url"])
        data = _fetch_json(f"{job_url.rstrip('/')}/api/json?{urlencode({'tree': tree})}", headers)
        builds = data.get("builds") if isinstance(data, dict) else None
        for build in builds if isinstance(builds, list) else []:
            if not isinstance(build, dict) or build.get("building") is not True:
                continue
            info = _build_info(build, _job_name(job_url), job_url)
            info.stages = _fetch_build_stages(info.url, headers)
            result.append(info)
    return result


def get_builds_by_url(repo_path: Path, jenkins_config: dict | None, build_urls: list[str]) -> list[CiRunInfo]:
    """Current state of specific builds (`wfapi/describe` also carries the stages
    of one that is still going, so that is one extra call per running build).
    Only URLs under one of the repo's configured jobs are fetched: the URLs come
    from the client, and the request carries the configured credentials."""
    if not jenkins_config:
        return []
    headers = _headers(jenkins_config)
    job_urls = _job_url_prefixes(jenkins_config, repo_path)

    result: list[CiRunInfo] = []
    for build_url in build_urls:
        normalized = build_url.rstrip("/")
        job_url = next((job for job in job_urls if normalized.startswith(f"{job}/")), None)
        if job_url is None or ".." in normalized:
            continue
        build = _fetch_build(normalized, headers)
        if build is None:
            continue
        info = _build_info(build, _job_name(job_url), normalized)
        if info.status == "running":
            info.stages = _fetch_build_stages(info.url, headers)
        result.append(info)
    return result


def poll_runs(
    repo_path: Path,
    jenkins_config: dict | None,
    run_ids: list[str] | None,
    head_sha: str | None = None,
    branch_name: str | None = None,
) -> list[CiRunInfo]:
    """`run_ids=None`: every running build of the repo's jobs (discovery).
    Otherwise exactly those builds, whatever their state. Jenkins can't filter
    builds by commit, so `head_sha` is accepted for interface parity only."""
    if run_ids is None:
        return get_active_builds(repo_path, jenkins_config, branch_name)
    return get_builds_by_url(repo_path, jenkins_config, run_ids)


def test_connection(jenkins_config: dict | None) -> tuple[bool, str]:
    """Read-only connectivity check for the settings screen."""
    if not jenkins_config:
        return False, "Jenkins settings are empty."

    urls: list[str] = []
    base_url = jenkins_config.get("base_url")
    if isinstance(base_url, str) and base_url.strip():
        urls.append(f"{base_url.strip().rstrip('/')}/api/json")

    for rule in jenkins_config.get("rules", []):
        if isinstance(rule, dict):
            job_url = rule.get("job_url")
            if isinstance(job_url, str) and job_url.strip() and not _has_branch_template(job_url):
                urls.append(f"{job_url.strip().rstrip('/')}/api/json")

    if not urls:
        return False, "Set a Jenkins base URL or at least one job URL first."

    headers = _headers(jenkins_config)
    for url in urls:
        if _fetch_json(url, headers) is not None:
            return True, f"Connected to {url.removesuffix('/api/json')}."
    return False, "Could not reach Jenkins with the current settings."


def test_rule_connection(jenkins_config: dict | None, rule: dict, repo_path: Path) -> tuple[bool, str]:
    """Render one rule for one repo's default branch and check the Jenkins job."""
    if not jenkins_config:
        return False, "Jenkins settings are empty."
    branch = _default_branch(repo_path)
    if not branch:
        return False, f"{repo_path.name}: no local main or master branch found."

    rendered = _render_job_config({"repo_path": str(repo_path), "job_url": rule.get("job_url")}, repo_path, _repo_template_values(repo_path), branch)
    if rendered is None:
        return False, f"{repo_path.name}: rule does not have a Jenkins job URL."

    job_url = str(rendered["job_url"]).strip().rstrip("/")
    if not job_url:
        return False, f"{repo_path.name}: rule does not have a Jenkins job URL."

    api_url = f"{job_url}/api/json"
    if _fetch_json(api_url, _headers(jenkins_config)) is not None:
        return True, f"{repo_path.name} ({branch}): connected to {job_url}."
    return False, f"{repo_path.name} ({branch}): could not reach {job_url}."


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
            info = _build_info(build, name, build_url)
            for sha in matching_shas:
                by_sha.setdefault(sha, []).append(info)

    return by_sha

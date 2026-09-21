from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .github_actions import get_active_runs, get_github_actions_runs, get_run_stages as get_github_run_stages
from .jenkins import get_active_builds, get_build_stages, get_jenkins_builds
from .schemas import ActivePipeline, CiRunInfo, CiStage, RepoSummary


def get_ci_runs(
    repo_path: Path,
    commit_hashes: set[str],
    github_config: dict | None,
    jenkins_config: dict | None,
) -> dict[str, list[CiRunInfo]]:
    by_sha: dict[str, list[CiRunInfo]] = {}

    if github_config is None or github_config.get("enabled") is not False:
        for sha, runs in get_github_actions_runs(repo_path, commit_hashes, github_config or {}).items():
            by_sha.setdefault(sha, []).extend(runs)

    if jenkins_config and jenkins_config.get("enabled") is not False:
        for sha, runs in get_jenkins_builds(repo_path, commit_hashes, jenkins_config).items():
            by_sha.setdefault(sha, []).extend(runs)

    return by_sha


def get_ci_run_stages(
    repo_path: Path,
    provider: str,
    run_id: str,
    github_config: dict | None,
    jenkins_config: dict | None,
) -> list[CiStage] | None:
    if provider == "github_actions" and (github_config is None or github_config.get("enabled") is not False):
        return get_github_run_stages(repo_path, github_config, run_id)
    if provider == "jenkins" and jenkins_config and jenkins_config.get("enabled") is not False:
        return get_build_stages(repo_path, jenkins_config, run_id)
    return None


def _active_runs_for_repo(repo: RepoSummary, github_config: dict | None, jenkins_config: dict | None) -> list[ActivePipeline]:
    path = Path(repo.path)
    runs: list[CiRunInfo] = []
    if github_config is None or github_config.get("enabled") is not False:
        runs.extend(get_active_runs(path, github_config))
    if jenkins_config and jenkins_config.get("enabled") is not False:
        runs.extend(get_active_builds(path, jenkins_config))
    return [ActivePipeline(repo_id=repo.id, repo_name=repo.name, run=run) for run in runs]


def get_active_pipelines(
    repos: list[RepoSummary],
    github_config: dict | None,
    jenkins_config: dict | None,
) -> list[ActivePipeline]:
    """Queued/running pipelines across every known repo. Repos are queried
    concurrently since each one is a network round trip."""
    if not repos:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(repos))) as pool:
        per_repo = pool.map(lambda repo: _active_runs_for_repo(repo, github_config, jenkins_config), repos)
        pipelines = [item for group in per_repo for item in group]
    return sorted(pipelines, key=lambda item: item.run.created_at or "", reverse=True)

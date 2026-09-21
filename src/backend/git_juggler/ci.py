from __future__ import annotations

from pathlib import Path

from .github_actions import get_github_actions_runs
from .jenkins import get_jenkins_builds
from .schemas import CiRunInfo


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

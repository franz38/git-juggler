from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from . import github_actions, jenkins
from ..schemas import ActivePipeline, CiRunInfo, CiStage, RepoSummary


class CiProvider(Protocol):
    """What a CI backend (GitHub Actions, Jenkins) offers the app."""

    name: str

    def fetch_completed_runs(self, repo_path: Path, commit_hashes: set[str]) -> dict[str, list[CiRunInfo]]:
        """Recent runs of the repo keyed by commit hash. Loaded with the commit
        graph and refreshed on its own, slow, interval — never by the run poll."""
        ...

    def poll_runs(self, repo_path: Path, run_ids: list[str] | None, head_sha: str | None, branch_name: str | None) -> list[CiRunInfo]:
        """`run_ids=None`: every active (queued/running) run of the repo, to
        discover a pipeline that just started (`head_sha` narrows it to one
        commit where the provider can filter). Otherwise exactly those runs,
        whatever their state, so a finished run reports its final status.
        Stages are included for runs that are still going."""
        ...

    def recent_runs(self, repo_path: Path, limit: int) -> list[CiRunInfo]:
        """The repo's latest runs (at most `limit` per job/workflow listing),
        running or finished, without stages."""
        ...


@dataclass
class GitHubActionsProvider:
    config: dict | None
    name: str = "github_actions"

    def fetch_completed_runs(self, repo_path: Path, commit_hashes: set[str]) -> dict[str, list[CiRunInfo]]:
        return github_actions.get_github_actions_runs(repo_path, commit_hashes, self.config or {})

    def poll_runs(self, repo_path: Path, run_ids: list[str] | None, head_sha: str | None, branch_name: str | None) -> list[CiRunInfo]:
        return github_actions.poll_runs(repo_path, self.config, run_ids, head_sha)

    def recent_runs(self, repo_path: Path, limit: int) -> list[CiRunInfo]:
        return github_actions.get_recent_runs(repo_path, self.config, limit)


@dataclass
class JenkinsProvider:
    config: dict
    name: str = "jenkins"

    def fetch_completed_runs(self, repo_path: Path, commit_hashes: set[str]) -> dict[str, list[CiRunInfo]]:
        return jenkins.get_jenkins_builds(repo_path, commit_hashes, self.config)

    def poll_runs(self, repo_path: Path, run_ids: list[str] | None, head_sha: str | None, branch_name: str | None) -> list[CiRunInfo]:
        return jenkins.poll_runs(repo_path, self.config, run_ids, head_sha, branch_name)

    def recent_runs(self, repo_path: Path, limit: int) -> list[CiRunInfo]:
        return jenkins.get_recent_builds(repo_path, self.config, limit)


def enabled_providers(github_config: dict | None, jenkins_config: dict | None) -> list[CiProvider]:
    providers: list[CiProvider] = []
    if github_config is None or github_config.get("enabled") is not False:
        providers.append(GitHubActionsProvider(github_config))
    if jenkins_config and jenkins_config.get("enabled") is not False:
        providers.append(JenkinsProvider(jenkins_config))
    return providers


def get_ci_runs(
    repo_path: Path,
    commit_hashes: set[str],
    github_config: dict | None,
    jenkins_config: dict | None,
) -> dict[str, list[CiRunInfo]]:
    by_sha: dict[str, list[CiRunInfo]] = {}
    for provider in enabled_providers(github_config, jenkins_config):
        for sha, runs in provider.fetch_completed_runs(repo_path, commit_hashes).items():
            by_sha.setdefault(sha, []).extend(runs)
    return by_sha


def poll_ci_runs(
    repo_path: Path,
    run_refs: list[str] | None,
    head_sha: str | None,
    branch_name: str | None,
    github_config: dict | None,
    jenkins_config: dict | None,
) -> list[CiRunInfo]:
    """Poll the CI providers. `run_refs=None` discovers the active runs of every
    provider; otherwise each ref is `"<provider>:<run_id>"` and only the
    providers named there are asked, about just those runs."""
    providers = enabled_providers(github_config, jenkins_config)
    if run_refs is None:
        return [run for provider in providers for run in provider.poll_runs(repo_path, None, head_sha, branch_name)]

    ids_by_provider: dict[str, list[str]] = {}
    for ref in run_refs:
        provider_name, _, run_id = ref.partition(":")
        if run_id:
            ids_by_provider.setdefault(provider_name, []).append(run_id)
    return [
        run
        for provider in providers
        if provider.name in ids_by_provider
        for run in provider.poll_runs(repo_path, ids_by_provider[provider.name], head_sha, branch_name)
    ]


def get_ci_run_stages(
    repo_path: Path,
    provider: str,
    run_id: str,
    github_config: dict | None,
    jenkins_config: dict | None,
) -> list[CiStage] | None:
    if provider == "github_actions" and (github_config is None or github_config.get("enabled") is not False):
        return github_actions.get_run_stages(repo_path, github_config, run_id)
    if provider == "jenkins" and jenkins_config and jenkins_config.get("enabled") is not False:
        return jenkins.get_build_stages(repo_path, jenkins_config, run_id)
    return None


def _recent_runs_for_repo(
    repo: RepoSummary, github_config: dict | None, jenkins_config: dict | None, limit: int
) -> list[tuple[RepoSummary, CiRunInfo]]:
    providers = enabled_providers(github_config, jenkins_config)
    return [(repo, run) for provider in providers for run in provider.recent_runs(Path(repo.path), limit)]


def _run_key(run: CiRunInfo) -> tuple[str, str]:
    return (run.provider, run.run_id or run.url)


def _created_at_key(run: CiRunInfo) -> datetime:
    # Providers format timestamps differently ("Z" vs "+00:00"), so compare
    # parsed values rather than strings.
    try:
        parsed = datetime.fromisoformat((run.created_at or "").replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def get_recent_pipelines(
    repos: list[RepoSummary],
    github_config: dict | None,
    jenkins_config: dict | None,
    limit: int = 10,
) -> list[ActivePipeline]:
    """The `limit` most recent pipelines across every known repo, running or
    finished, newest first, with their stages. Repos are queried concurrently
    since each one is a network round trip; stages are only fetched for the
    runs that make the cut."""
    if not repos or limit <= 0:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(repos))) as pool:
        per_repo = pool.map(lambda repo: _recent_runs_for_repo(repo, github_config, jenkins_config, limit), repos)
        found = [item for group in per_repo for item in group]
    deduped: dict[tuple[str, str], tuple[RepoSummary, CiRunInfo]] = {}
    for repo, run in found:
        deduped.setdefault(_run_key(run), (repo, run))
    newest = sorted(deduped.values(), key=lambda item: _created_at_key(item[1]), reverse=True)[:limit]

    def with_stages(item: tuple[RepoSummary, CiRunInfo]) -> ActivePipeline:
        repo, run = item
        if run.run_id:
            run.stages = get_ci_run_stages(Path(repo.path), run.provider, run.run_id, github_config, jenkins_config)
        return ActivePipeline(repo_id=repo.id, repo_name=repo.name, run=run)

    if not newest:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(newest))) as pool:
        return list(pool.map(with_stages, newest))

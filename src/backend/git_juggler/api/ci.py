from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from .. import config
from ..ci import github_actions, jenkins
from ..ci import get_active_pipelines, get_ci_run_stages, get_ci_runs, poll_ci_runs
from ..git.data import get_commit_hashes
from ..repo_discovery import list_repos, resolve_repo_path
from ..schemas import (
    ActivePipeline,
    CiConnectionTestResponse,
    CiRunInfo,
    CiStage,
    GitHubConfig,
    JenkinsConfig,
)


router = APIRouter()


def _resolve_repo_path(repo_id: str) -> Path:
    path = resolve_repo_path(config.load_repo_paths(), repo_id)
    if path is None:
        raise HTTPException(status_code=404, detail="repo not found")
    return path


@router.get("/api/repos/{repo_id}/ci/runs", response_model=dict[str, list[CiRunInfo]])
def api_ci_runs(repo_id: str) -> dict[str, list[CiRunInfo]]:
    path = _resolve_repo_path(repo_id)
    return get_ci_runs(
        path,
        get_commit_hashes(path),
        config.load_github_config(),
        config.load_jenkins_config(),
    )


# Live poll of a repo's pipelines. Without `run`, every active run of the
# repo (`head_sha` narrows it where the provider can filter): used right
# after a commit action, when the run may not be known yet. With one or more
# `run=<provider>:<run_id>` (CiRunInfo.provider / run_id), only those runs,
# including their final status once finished.
@router.get("/api/repos/{repo_id}/ci/poll", response_model=list[CiRunInfo])
def api_ci_poll(
    repo_id: str,
    run: Annotated[list[str] | None, Query()] = None,
    head_sha: str | None = None,
) -> list[CiRunInfo]:
    path = _resolve_repo_path(repo_id)
    return poll_ci_runs(
        path, run, head_sha, config.load_github_config(), config.load_jenkins_config()
    )


# Stages (GitHub jobs / Jenkins pipeline stages) of one run. `run_id` is the
# value CiRunInfo.run_id carried; 404 when the provider has no stage data.
@router.get("/api/repos/{repo_id}/ci/stages", response_model=list[CiStage])
def api_ci_stages(repo_id: str, provider: str, run_id: str) -> list[CiStage]:
    path = _resolve_repo_path(repo_id)
    stages = get_ci_run_stages(
        path,
        provider,
        run_id,
        config.load_github_config(),
        config.load_jenkins_config(),
    )
    if stages is None:
        raise HTTPException(status_code=404, detail="stages not available")
    return stages


# Queued/running pipelines across all repos, for the Pipelines tab.
@router.get("/api/ci/active", response_model=list[ActivePipeline])
def api_ci_active() -> list[ActivePipeline]:
    return get_active_pipelines(
        list_repos(config.load_repo_paths()),
        config.load_github_config(),
        config.load_jenkins_config(),
    )


@router.post("/api/ci/github/test", response_model=CiConnectionTestResponse)
def api_test_github_connection(body: GitHubConfig) -> CiConnectionTestResponse:
    ok, message = github_actions.test_connection(body.model_dump())
    return CiConnectionTestResponse(ok=ok, message=message)


@router.post("/api/ci/jenkins/test", response_model=CiConnectionTestResponse)
def api_test_jenkins_connection(body: JenkinsConfig) -> CiConnectionTestResponse:
    ok, message = jenkins.test_connection(body.model_dump())
    return CiConnectionTestResponse(ok=ok, message=message)

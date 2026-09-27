from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .agent_hook_events import AgentHookEventReader
from .agent_hooks import hooks_status, install_claude_hooks, install_opencode_hooks
from .agent_tracking.activity_models import AgentRepositoryScan
from .api.config import create_config_router
from .api.terminal import create_terminal_router
from .ci import github_actions, jenkins
from .ci import get_active_pipelines, get_ci_run_stages, get_ci_runs, poll_ci_runs
from .git.data import (
    GRAPH_PAGE_SIZE,
    HistoryChangedError,
    get_commit_hashes,
    get_graph,
    get_repo_status,
)
from .git.detail import get_commit_detail
from .git.diff import get_commit_file_diff, get_working_file_diff
from .repos import get_scan_progress, list_repos, resolve_repo_path
from .schemas import (
    ActivePipeline,
    AgentActivityResponse,
    AgentHookProviderStatusResponse,
    AgentHooksResponse,
    AgentRepositoryScanResponse,
    BrowseDirectoryResponse,
    CiRunInfo,
    CiStage,
    CiConnectionTestResponse,
    CommitDetail,
    FileDiff,
    GitHubConfig,
    GraphResponse,
    JenkinsConfig,
    RepoScanProgress,
    RepoStatusResponse,
    RepoSummary,
)
from .ui.folder_picker import browse_directory


def create_app(root_path: Path, frontend_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="git-juggler")
    app.state.root_path = root_path
    config.ensure_seeded(root_path)

    # Only needed for local dev, when the Vite dev server (a different origin)
    # talks to this API directly instead of through its proxy.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(create_config_router(root_path))
    app.include_router(create_terminal_router(root_path))

    def _resolve_repo_path(repo_id: str) -> Path:
        path = resolve_repo_path(config.load_repo_paths(), repo_id)
        if path is None:
            raise HTTPException(status_code=404, detail="repo not found")
        return path

    @app.get("/api/repos", response_model=list[RepoSummary])
    def api_list_repos() -> list[RepoSummary]:
        return list_repos(config.load_repo_paths())

    @app.get("/api/repos/scan-progress", response_model=RepoScanProgress)
    def api_repos_scan_progress() -> RepoScanProgress:
        return RepoScanProgress(**get_scan_progress())

    @app.get("/api/browse", response_model=BrowseDirectoryResponse)
    def api_browse(path: str | None = None) -> BrowseDirectoryResponse:
        return browse_directory(path)

    @app.get("/api/repos/{repo_id}/graph", response_model=GraphResponse)
    def api_graph(
        repo_id: str,
        before: str | None = None,
        limit: int = Query(GRAPH_PAGE_SIZE, ge=1, le=10 * GRAPH_PAGE_SIZE),
    ) -> GraphResponse:
        path = _resolve_repo_path(repo_id)
        try:
            return GraphResponse(
                **get_graph(path, limit=limit, before=before)._asdict()
            )
        except HistoryChangedError as exc:
            # The cursor commit is gone (history rewritten): the client should reload from the first page.
            raise HTTPException(
                status_code=409, detail="graph history changed"
            ) from exc

    @app.get("/api/repos/{repo_id}/status", response_model=RepoStatusResponse)
    def api_repo_status(repo_id: str) -> RepoStatusResponse:
        path = _resolve_repo_path(repo_id)
        return get_repo_status(path)

    @app.get("/api/repos/{repo_id}/commits/{sha}", response_model=CommitDetail)
    def api_commit_detail(repo_id: str, sha: str) -> CommitDetail:
        path = _resolve_repo_path(repo_id)
        try:
            return get_commit_detail(path, sha)
        except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
            raise HTTPException(status_code=404, detail="commit not found") from exc

    @app.get("/api/repos/{repo_id}/commits/{sha}/diff", response_model=FileDiff)
    def api_commit_file_diff(
        repo_id: str,
        sha: str,
        path: str,
        old_path: str | None = None,
        full: bool = False,
    ) -> FileDiff:
        repo_path = _resolve_repo_path(repo_id)
        try:
            return get_commit_file_diff(repo_path, sha, path, old_path, full)
        except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
            raise HTTPException(status_code=404, detail="diff not found") from exc

    @app.get("/api/repos/{repo_id}/diff", response_model=FileDiff)
    def api_working_file_diff(
        repo_id: str, path: str, old_path: str | None = None, full: bool = False
    ) -> FileDiff:
        repo_path = _resolve_repo_path(repo_id)
        try:
            return get_working_file_diff(repo_path, path, old_path, full)
        except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
            raise HTTPException(status_code=404, detail="diff not found") from exc

    @app.get("/api/repos/{repo_id}/ci/runs", response_model=dict[str, list[CiRunInfo]])
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
    @app.get("/api/repos/{repo_id}/ci/poll", response_model=list[CiRunInfo])
    def api_ci_poll(
        repo_id: str,
        run: Annotated[list[str] | None, Query()] = None,
        head_sha: str | None = None,
    ) -> list[CiRunInfo]:
        path = _resolve_repo_path(repo_id)
        return poll_ci_runs(path, run, head_sha, config.load_github_config(), config.load_jenkins_config())

    # Stages (GitHub jobs / Jenkins pipeline stages) of one run. `run_id` is the
    # value CiRunInfo.run_id carried; 404 when the provider has no stage data.
    @app.get("/api/repos/{repo_id}/ci/stages", response_model=list[CiStage])
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
    @app.get("/api/ci/active", response_model=list[ActivePipeline])
    def api_ci_active() -> list[ActivePipeline]:
        return get_active_pipelines(
            list_repos(config.load_repo_paths()),
            config.load_github_config(),
            config.load_jenkins_config(),
        )

    @app.post("/api/ci/github/test", response_model=CiConnectionTestResponse)
    def api_test_github_connection(body: GitHubConfig) -> CiConnectionTestResponse:
        ok, message = github_actions.test_connection(body.model_dump())
        return CiConnectionTestResponse(ok=ok, message=message)

    @app.post("/api/ci/jenkins/test", response_model=CiConnectionTestResponse)
    def api_test_jenkins_connection(body: JenkinsConfig) -> CiConnectionTestResponse:
        ok, message = jenkins.test_connection(body.model_dump())
        return CiConnectionTestResponse(ok=ok, message=message)

    hook_event_reader = AgentHookEventReader()

    def _agent_scan_response(scan: AgentRepositoryScan) -> AgentRepositoryScanResponse:
        return AgentRepositoryScanResponse(
            agent_pid=scan.agent_pid,
            session_directory=scan.session_directory,
            worktrees=[
                {
                    "repository_id": activity.repository_id,
                    "worktree_path": activity.worktree_path,
                    "branch": activity.branch,
                    "commit": activity.commit,
                    "process_ids": activity.process_ids,
                    "first_seen": activity.first_seen,
                    "last_seen": activity.last_seen,
                    "last_activity": activity.last_activity,
                    "evidence": [evidence.__dict__ for evidence in activity.evidence],
                    "activity_score": activity.activity_score,
                    "state": activity.state,
                    "is_home": activity.is_home,
                }
                for activity in scan.worktrees
            ],
            scanned_at=scan.scanned_at,
            state=scan.state,
            provider=scan.provider,
            session_id=scan.session_id,
            process_pid=scan.process_pid,
            name=scan.name,
            details=scan.details.__dict__ if scan.details is not None else None,
            waiting_for=scan.waiting_for,
        )

    def _hook_status_response(status) -> AgentHookProviderStatusResponse:
        return AgentHookProviderStatusResponse(**status.__dict__)

    @app.get("/api/agents/activity", response_model=AgentActivityResponse)
    def api_agent_activity() -> AgentActivityResponse:
        hook_scans = hook_event_reader.recent_scans()
        scans = [_agent_scan_response(scan) for scan in hook_scans]
        scanned_at = max((scan.scanned_at for scan in scans), default=0)
        return AgentActivityResponse(
            agents=[
                {
                    "pid": scan.agent_pid,
                    "command_line": "hook activity",
                    "matched_pattern": "hook",
                }
                for scan in hook_scans
            ],
            scans=scans,
            scanned_at=scanned_at,
        )

    @app.get("/api/agents/hooks", response_model=AgentHooksResponse)
    def api_agent_hooks() -> AgentHooksResponse:
        statuses = hooks_status()
        return AgentHooksResponse(
            claude=_hook_status_response(statuses["claude"]),
            opencode=_hook_status_response(statuses["opencode"]),
        )

    @app.post(
        "/api/agents/hooks/claude/install",
        response_model=AgentHookProviderStatusResponse,
    )
    def api_install_claude_hooks() -> AgentHookProviderStatusResponse:
        return _hook_status_response(install_claude_hooks())

    @app.post(
        "/api/agents/hooks/opencode/install",
        response_model=AgentHookProviderStatusResponse,
    )
    def api_install_opencode_hooks() -> AgentHookProviderStatusResponse:
        return _hook_status_response(install_opencode_hooks())

    if frontend_dist and frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}")
        def spa(full_path: str) -> FileResponse:
            candidate = frontend_dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

    return app

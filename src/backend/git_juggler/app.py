from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .agent_hook_events import AgentHookEventReader
from .agent_hooks import hooks_status, install_claude_hooks, install_opencode_hooks
from .agent_tracking.activity_models import AgentRepositoryScan
from .browse import browse_directory
from .ci import get_ci_runs
from .commit_detail import get_commit_detail
from .git_data import get_graph, get_repo_status
from .repos import list_repos, resolve_repo_path
from .schemas import AgentActivityResponse, AgentHookProviderStatusResponse, AgentHooksResponse, AgentRepositoryScanResponse, BrowseDirectoryResponse, CiRunInfo, CommitDetail, ConfigResponse, ConfigUpdateRequest, GraphResponse, Preferences, RepoStatusResponse, RepoSummary, ThemesResponse, VscodeTheme
from .terminal import run_terminal_session
from .themes import discover_themes


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

    def _resolve_repo_path(repo_id: str) -> Path:
        path = resolve_repo_path(config.load_repo_paths(), repo_id)
        if path is None:
            raise HTTPException(status_code=404, detail="repo not found")
        return path

    @app.get("/api/repos", response_model=list[RepoSummary])
    def api_list_repos() -> list[RepoSummary]:
        return list_repos(config.load_repo_paths())

    @app.get("/api/browse", response_model=BrowseDirectoryResponse)
    def api_browse(path: str | None = None) -> BrowseDirectoryResponse:
        return browse_directory(path)

    def _current_config() -> ConfigResponse:
        return ConfigResponse(
            repo_paths=[str(p) for p in config.load_repo_paths()],
            pinned_repo_paths=config.load_pinned_repo_paths(),
            repo_groups=config.load_repo_groups(),
            excluded_paths=config.load_excluded_paths(),
            github=config.load_github_config(),
            jenkins=config.load_jenkins_config(),
        )

    @app.get("/api/config", response_model=ConfigResponse)
    def api_get_config() -> ConfigResponse:
        return _current_config()

    @app.put("/api/config", response_model=ConfigResponse)
    def api_update_config(body: ConfigUpdateRequest) -> ConfigResponse:
        if body.repo_paths is not None:
            resolved: list[Path] = []
            seen: set[str] = set()
            for raw in body.repo_paths:
                path = Path(raw).expanduser().resolve()
                if not path.is_dir():
                    raise HTTPException(status_code=400, detail=f"not a directory: {raw}")
                key = str(path)
                if key in seen:
                    continue
                seen.add(key)
                resolved.append(path)
            config.save_repo_paths(resolved)

        if body.pinned_repo_paths is not None:
            deduped = list(dict.fromkeys(body.pinned_repo_paths))
            config.save_pinned_repo_paths(deduped)

        if body.repo_groups is not None:
            config.save_repo_groups([group.model_dump() for group in body.repo_groups])

        if body.excluded_paths is not None:
            config.save_excluded_paths(body.excluded_paths)

        if body.github is not None:
            config.save_github_config(body.github.model_dump())

        if body.jenkins is not None:
            config.save_jenkins_config(body.jenkins.model_dump())

        return _current_config()

    def _current_themes() -> ThemesResponse:
        imported = [VscodeTheme(**t) for t in config.load_imported_themes()]
        return ThemesResponse(installed=discover_themes(), imported=imported)

    @app.get("/api/themes", response_model=ThemesResponse)
    def api_get_themes() -> ThemesResponse:
        return _current_themes()

    # Stores theme *files* the user imported in the UI (app settings, not repo
    # state, so this doesn't fall under the git-mutations-via-terminal rule).
    @app.put("/api/themes/imported", response_model=ThemesResponse)
    def api_put_imported_themes(body: list[VscodeTheme]) -> ThemesResponse:
        config.save_imported_themes([t.model_dump() for t in body])
        return _current_themes()

    # UI preferences (theme, pinned themes, key bindings, agent settings, ...)
    # kept server-side so every browser shows the same setup. App settings only,
    # nothing here touches a repo.
    @app.get("/api/preferences", response_model=Preferences)
    def api_get_preferences() -> Preferences:
        return config.load_preferences()

    @app.put("/api/preferences", response_model=Preferences)
    def api_put_preferences(body: Preferences) -> Preferences:
        return config.update_preferences(body.model_dump(mode="json", exclude_unset=True))

    @app.get("/api/repos/{repo_id}/graph", response_model=GraphResponse)
    def api_graph(repo_id: str) -> GraphResponse:
        path = _resolve_repo_path(repo_id)
        commits, branches, current_branch, head_commit, upstream_commit, is_dirty, uncommitted_files, checked_out_branches = get_graph(path)
        return GraphResponse(
            commits=commits,
            branches=branches,
            current_branch=current_branch,
            head_commit=head_commit,
            upstream_commit=upstream_commit,
            is_dirty=is_dirty,
            uncommitted_files=uncommitted_files,
            checked_out_branches=checked_out_branches,
        )

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

    @app.get("/api/repos/{repo_id}/ci/runs", response_model=dict[str, list[CiRunInfo]])
    def api_ci_runs(repo_id: str) -> dict[str, list[CiRunInfo]]:
        path = _resolve_repo_path(repo_id)
        commits, _, _, _, _, _, _, _ = get_graph(path)
        return get_ci_runs(path, {c.hash for c in commits}, config.load_github_config(), config.load_jenkins_config())

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
                {"pid": scan.agent_pid, "command_line": "hook activity", "matched_pattern": "hook"}
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

    @app.post("/api/agents/hooks/claude/install", response_model=AgentHookProviderStatusResponse)
    def api_install_claude_hooks() -> AgentHookProviderStatusResponse:
        return _hook_status_response(install_claude_hooks())

    @app.post("/api/agents/hooks/opencode/install", response_model=AgentHookProviderStatusResponse)
    def api_install_opencode_hooks() -> AgentHookProviderStatusResponse:
        return _hook_status_response(install_opencode_hooks())

    @app.websocket("/ws/terminal")
    async def ws_terminal(websocket: WebSocket) -> None:
        repo_id = websocket.query_params.get("repo")
        cwd = root_path
        if repo_id:
            resolved = resolve_repo_path(config.load_repo_paths(), repo_id)
            if resolved is None:
                await websocket.close(code=1008)
                return
            cwd = resolved
        await websocket.accept()
        try:
            await run_terminal_session(websocket, cwd=cwd)
        except WebSocketDisconnect:
            pass

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

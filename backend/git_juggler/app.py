from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .commit_detail import get_commit_detail
from .git_data import get_graph, get_repo_status
from .github_actions import get_github_actions_runs
from .repos import list_repos, resolve_repo_path
from .schemas import CommitDetail, ConfigResponse, ConfigUpdateRequest, GitHubActionsRunInfo, GraphResponse, RepoStatusResponse, RepoSummary
from .terminal import run_terminal_session


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

    def _current_config() -> ConfigResponse:
        return ConfigResponse(
            repo_paths=[str(p) for p in config.load_repo_paths()],
            pinned_repo_paths=config.load_pinned_repo_paths(),
            github=config.load_github_config(),
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

        if body.github is not None:
            config.save_github_config(body.github.model_dump())

        return _current_config()

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

    @app.get("/api/repos/{repo_id}/github/actions", response_model=dict[str, list[GitHubActionsRunInfo]])
    def api_github_actions(repo_id: str) -> dict[str, list[GitHubActionsRunInfo]]:
        path = _resolve_repo_path(repo_id)
        commits, _, _, _, _, _, _, _ = get_graph(path)
        return get_github_actions_runs(path, {c.hash for c in commits}, config.load_github_config())

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

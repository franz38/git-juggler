from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .api.agents import router as agents_router
from .api.ci import router as ci_router
from .api.config import create_config_router
from .api.git import router as git_router
from .api.repos import router as repos_router
from .api.terminal import create_terminal_router


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
    app.include_router(repos_router)
    app.include_router(git_router)
    app.include_router(ci_router)
    app.include_router(agents_router)
    app.include_router(create_config_router(root_path))
    app.include_router(create_terminal_router(root_path))

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

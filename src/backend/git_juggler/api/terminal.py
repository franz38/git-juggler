from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import config
from ..repo_discovery import resolve_repo_path
from ..terminal import run_terminal_session


def create_terminal_router(root_path: Path) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws/terminal")
    async def ws_terminal(websocket: WebSocket) -> None:
        repo_id = websocket.query_params.get("repo")
        cwd = root_path
        if repo_id:
            resolved = resolve_repo_path(config.load_repo_paths(), repo_id, config.load_individual_repo_paths())
            if resolved is None:
                await websocket.close(code=1008)
                return
            cwd = resolved
        await websocket.accept()
        try:
            await run_terminal_session(websocket, cwd=cwd)
        except WebSocketDisconnect:
            pass

    return router

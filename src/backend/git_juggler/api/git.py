from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from .. import config
from ..git.conflicts import create_resolution_token, get_conflict_file_content
from ..git.data import GRAPH_PAGE_SIZE, HistoryChangedError, get_graph, get_repo_status
from ..git.detail import get_commit_detail
from ..git.diff import get_commit_file_diff, get_working_file_diff
from ..repo_discovery import resolve_repo_path
from ..schemas import CommitDetail, ConflictFileContent, ConflictResolutionTokenRequest, ConflictResolutionTokenResponse, FileDiff, GraphResponse, RepoStatusResponse


router = APIRouter()


def _resolve_repo_path(repo_id: str) -> Path:
    path = resolve_repo_path(config.load_repo_paths(), repo_id)
    if path is None:
        raise HTTPException(status_code=404, detail="repo not found")
    return path


@router.get("/api/repos/{repo_id}/graph", response_model=GraphResponse)
def api_graph(
    repo_id: str,
    before: str | None = None,
    limit: int = Query(GRAPH_PAGE_SIZE, ge=1, le=10 * GRAPH_PAGE_SIZE),
) -> GraphResponse:
    path = _resolve_repo_path(repo_id)
    try:
        return GraphResponse(**get_graph(path, limit=limit, before=before)._asdict())
    except HistoryChangedError as exc:
        # The cursor commit is gone (history rewritten): the client should reload from the first page.
        raise HTTPException(status_code=409, detail="graph history changed") from exc


@router.get("/api/repos/{repo_id}/status", response_model=RepoStatusResponse)
def api_repo_status(repo_id: str) -> RepoStatusResponse:
    path = _resolve_repo_path(repo_id)
    return get_repo_status(path)


@router.get("/api/repos/{repo_id}/commits/{sha}", response_model=CommitDetail)
def api_commit_detail(repo_id: str, sha: str) -> CommitDetail:
    path = _resolve_repo_path(repo_id)
    try:
        return get_commit_detail(path, sha)
    except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
        raise HTTPException(status_code=404, detail="commit not found") from exc


@router.get("/api/repos/{repo_id}/commits/{sha}/diff", response_model=FileDiff)
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


@router.get("/api/repos/{repo_id}/diff", response_model=FileDiff)
def api_working_file_diff(
    repo_id: str, path: str, old_path: str | None = None, full: bool = False
) -> FileDiff:
    repo_path = _resolve_repo_path(repo_id)
    try:
        return get_working_file_diff(repo_path, path, old_path, full)
    except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
        raise HTTPException(status_code=404, detail="diff not found") from exc


@router.get("/api/repos/{repo_id}/conflicts/content", response_model=ConflictFileContent)
def api_conflict_file_content(repo_id: str, path: str) -> ConflictFileContent:
    repo_path = _resolve_repo_path(repo_id)
    try:
        return get_conflict_file_content(repo_path, path)
    except Exception as exc:  # noqa: BLE001 - surfaced as a 404 either way
        raise HTTPException(status_code=404, detail="conflict file not found") from exc


@router.post("/api/repos/{repo_id}/conflicts/resolution-token", response_model=ConflictResolutionTokenResponse)
def api_create_conflict_resolution_token(
    repo_id: str, request: ConflictResolutionTokenRequest
) -> ConflictResolutionTokenResponse:
    if request.repo_id != repo_id:
        raise HTTPException(status_code=400, detail="repo mismatch")
    _resolve_repo_path(repo_id)
    return ConflictResolutionTokenResponse(
        token=create_resolution_token(repo_id, request.path, request.content)
    )

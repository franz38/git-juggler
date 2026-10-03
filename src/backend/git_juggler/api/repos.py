from __future__ import annotations

from fastapi import APIRouter

from .. import config
from ..repo_discovery import get_scan_progress, list_repos
from ..schemas import BrowseDirectoryResponse, RepoScanProgress, RepoSummary
from ..ui.folder_picker import browse_directory


router = APIRouter()


@router.get("/api/repos", response_model=list[RepoSummary])
def api_list_repos() -> list[RepoSummary]:
    return list_repos(config.load_repo_paths(), config.load_individual_repo_paths())


@router.get("/api/repos/scan-progress", response_model=RepoScanProgress)
def api_repos_scan_progress() -> RepoScanProgress:
    return RepoScanProgress(**get_scan_progress())


@router.get("/api/browse", response_model=BrowseDirectoryResponse)
def api_browse(path: str | None = None) -> BrowseDirectoryResponse:
    return browse_directory(path)

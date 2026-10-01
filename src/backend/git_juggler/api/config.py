from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import config
from ..schemas import (
    ConfigResponse,
    ConfigUpdateRequest,
    PickFolderResponse,
    Preferences,
    ThemesResponse,
    VscodeTheme,
)
from ..themes import discover_themes
from ..ui.folder_picker import NativePickerUnavailable, pick_folder


def create_config_router(root_path: Path) -> APIRouter:
    router = APIRouter()
    terminal_shell = "cmd" if sys.platform == "win32" else "posix"

    def _current_config() -> ConfigResponse:
        return ConfigResponse(
            repo_paths=[str(p) for p in config.load_repo_paths()],
            pinned_repo_paths=config.load_pinned_repo_paths(),
            repo_groups=config.load_repo_groups(),
            excluded_paths=config.load_excluded_paths(),
            graph_page_size=config.load_graph_page_size(),
            github=config.load_github_config(),
            jenkins=config.load_jenkins_config(),
            terminal_shell=terminal_shell,
        )

    @router.get("/api/config", response_model=ConfigResponse)
    def api_get_config() -> ConfigResponse:
        return _current_config()

    @router.put("/api/config", response_model=ConfigResponse)
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

        if body.graph_page_size is not None:
            config.save_graph_page_size(body.graph_page_size)

        if body.github is not None:
            config.save_github_config(body.github.model_dump())

        if body.jenkins is not None:
            config.save_jenkins_config(body.jenkins.model_dump())

        return _current_config()

    # Wipes every stored setting back to a first-run state. App settings only,
    # nothing here touches a repo.
    @router.post("/api/config/reset", response_model=ConfigResponse)
    def api_reset_config() -> ConfigResponse:
        config.reset_to_factory(root_path)
        return _current_config()

    @router.post("/api/pick-folder", response_model=PickFolderResponse)
    def api_pick_folder() -> PickFolderResponse:
        try:
            return PickFolderResponse(path=pick_folder())
        except NativePickerUnavailable as e:
            raise HTTPException(status_code=501, detail=str(e))

    def _current_themes() -> ThemesResponse:
        imported = [VscodeTheme(**theme) for theme in config.load_imported_themes()]
        return ThemesResponse(installed=discover_themes(), imported=imported)

    @router.get("/api/themes", response_model=ThemesResponse)
    def api_get_themes() -> ThemesResponse:
        return _current_themes()

    # Stores theme *files* the user imported in the UI (app settings, not repo
    # state, so this doesn't fall under the git-mutations-via-terminal rule).
    @router.put("/api/themes/imported", response_model=ThemesResponse)
    def api_put_imported_themes(body: list[VscodeTheme]) -> ThemesResponse:
        config.save_imported_themes([theme.model_dump() for theme in body])
        return _current_themes()

    # UI preferences (theme, pinned themes, key bindings, agent settings, ...)
    # kept server-side so every browser shows the same setup. App settings only,
    # nothing here touches a repo.
    @router.get("/api/preferences", response_model=Preferences)
    def api_get_preferences() -> Preferences:
        return config.load_preferences()

    @router.put("/api/preferences", response_model=Preferences)
    def api_put_preferences(body: Preferences) -> Preferences:
        return config.update_preferences(body.model_dump(mode="json", exclude_unset=True))

    return router

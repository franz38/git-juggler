from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from .schemas import Preferences

CONFIG_DIR = Path.home() / ".config" / "git-juggler"
CONFIG_PATH = CONFIG_DIR / "config.json"


def _load_raw() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_raw(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = CONFIG_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(CONFIG_PATH)


def load_repo_paths() -> list[Path]:
    raw = _load_raw().get("repo_paths", [])
    if not isinstance(raw, list):
        return []
    return [Path(p) for p in raw if isinstance(p, str)]


def save_repo_paths(paths: list[Path]) -> None:
    data = _load_raw()
    data["repo_paths"] = [str(p) for p in paths]
    _save_raw(data)


def load_pinned_repo_paths() -> list[str]:
    raw = _load_raw().get("pinned_repo_paths", [])
    if not isinstance(raw, list):
        return []
    return [p for p in raw if isinstance(p, str)]


def save_pinned_repo_paths(paths: list[str]) -> None:
    data = _load_raw()
    data["pinned_repo_paths"] = paths
    _save_raw(data)


def load_preferences() -> Preferences:
    """The stored UI preferences. Each field is validated on its own so one bad
    (hand-edited, or from a newer version) value doesn't discard the others."""
    raw = _load_raw().get("preferences", {})
    if not isinstance(raw, dict):
        return Preferences()
    valid: dict = {}
    for key, value in raw.items():
        if key not in Preferences.model_fields:
            continue
        try:
            Preferences.model_validate({key: value})
        except ValidationError:
            continue
        valid[key] = value
    return Preferences.model_validate(valid)


def update_preferences(patch: dict) -> Preferences:
    """Apply a partial update: keys in ``patch`` are set, ``None`` values clear
    the stored key, everything not mentioned is left alone."""
    stored = _load_raw().get("preferences", {})
    merged = dict(stored) if isinstance(stored, dict) else {}
    for key, value in patch.items():
        if key not in Preferences.model_fields:
            continue
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    data = _load_raw()
    data["preferences"] = merged
    _save_raw(data)
    return load_preferences()


def load_imported_themes() -> list[dict]:
    raw = _load_raw().get("imported_themes", [])
    if not isinstance(raw, list):
        return []
    return [t for t in raw if isinstance(t, dict) and isinstance(t.get("id"), str)]


def save_imported_themes(themes: list[dict]) -> None:
    data = _load_raw()
    data["imported_themes"] = themes
    _save_raw(data)


def load_repo_groups() -> list[dict]:
    raw = _load_raw().get("repo_groups", [])
    if not isinstance(raw, list):
        return []

    groups: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        group_id = item.get("id")
        name = item.get("name")
        repo_paths = item.get("repo_paths", [])
        if not isinstance(group_id, str) or not group_id or group_id in seen:
            continue
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(repo_paths, list):
            repo_paths = []
        seen.add(group_id)
        groups.append(
            {
                "id": group_id,
                "name": name.strip(),
                "repo_paths": list(dict.fromkeys(p for p in repo_paths if isinstance(p, str))),
            }
        )
    return groups


def save_repo_groups(groups: list[dict]) -> None:
    data = _load_raw()
    data["repo_groups"] = groups
    _save_raw(data)


def load_excluded_paths() -> list[str]:
    """Paths ignored when detecting a repo's uncommitted changes. Defaults to
    [".claude"] whenever the key is absent -- not just on first run like
    ensure_seeded -- so an existing config.json from before this setting
    existed still gets the default. An explicit empty list (the user cleared
    the field) is respected and returned as-is.
    """
    raw = _load_raw().get("excluded_paths")
    if raw is None or not isinstance(raw, list):
        return [".claude"]
    return [p for p in raw if isinstance(p, str)]


def save_excluded_paths(paths: list[str]) -> None:
    data = _load_raw()
    data["excluded_paths"] = paths
    _save_raw(data)


def load_graph_page_size() -> int:
    raw = _load_raw().get("graph_page_size")
    if not isinstance(raw, int):
        return 500
    return min(5000, max(1, raw))


def save_graph_page_size(size: int) -> None:
    data = _load_raw()
    data["graph_page_size"] = min(5000, max(1, size))
    _save_raw(data)


def load_github_config() -> dict | None:
    raw = _load_raw().get("github")
    return raw if isinstance(raw, dict) else None


def save_github_config(github: dict | None) -> None:
    data = _load_raw()
    if github is None:
        data.pop("github", None)
    else:
        data["github"] = github
    _save_raw(data)


def load_jenkins_config() -> dict | None:
    raw = _load_raw().get("jenkins")
    return raw if isinstance(raw, dict) else None


def save_jenkins_config(jenkins: dict | None) -> None:
    data = _load_raw()
    if jenkins is None:
        data.pop("jenkins", None)
    else:
        data["jenkins"] = jenkins
    _save_raw(data)


def ensure_seeded(default_path: Path) -> None:
    """On first run (no config file yet), seed it with the CLI-provided path
    so existing single-path usage keeps working without extra setup."""
    if CONFIG_PATH.exists():
        return
    save_repo_paths([default_path])


def reset_to_factory(default_path: Path) -> None:
    """Deletes the whole config file (repo paths, groups, integrations, imported
    themes, preferences, ...) and re-seeds it like a first run."""
    CONFIG_PATH.unlink(missing_ok=True)
    ensure_seeded(default_path)

from __future__ import annotations

import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "git-juggler"
CONFIG_PATH = CONFIG_DIR / "config.json"


def _load_raw() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_raw(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = CONFIG_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(data, indent=2))
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


def ensure_seeded(default_path: Path) -> None:
    """On first run (no config file yet), seed it with the CLI-provided path
    so existing single-path usage keeps working without extra setup."""
    if CONFIG_PATH.exists():
        return
    save_repo_paths([default_path])

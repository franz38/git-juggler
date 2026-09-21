from __future__ import annotations

from pathlib import Path


def normalize_path(path: str | Path) -> str:
    return str(Path(path).expanduser().resolve())

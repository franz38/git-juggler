from __future__ import annotations

from pathlib import Path

from .schemas import BrowseDirectoryResponse, BrowseEntry


def browse_directory(raw_path: str | None) -> BrowseDirectoryResponse:
    """List the subdirectories of a path, for the repo-search-path folder
    picker. Read-only — never creates, renames, or deletes anything."""
    path = Path(raw_path).expanduser().resolve() if raw_path else Path.home()
    if not path.is_dir():
        path = path.parent if path.parent.is_dir() else Path.home()

    entries: list[BrowseEntry] = []
    try:
        for child in sorted(path.iterdir(), key=lambda p: p.name.lower()):
            try:
                if child.is_dir():
                    entries.append(BrowseEntry(name=child.name, path=str(child)))
            except OSError:
                continue
    except PermissionError:
        pass

    parent = str(path.parent) if path.parent != path else None
    return BrowseDirectoryResponse(path=str(path), parent=parent, entries=entries)

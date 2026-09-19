from __future__ import annotations

import hashlib
import os
from pathlib import Path

from git import Repo

from .git_utils import get_current_branch
from .schemas import RepoSummary


def root_key(root: Path) -> str:
    """Stable id for a scan root, independent of its position in the config
    list — so pinned repos / open tabs don't silently point at the wrong
    repo just because the user removed a different, unrelated path."""
    return hashlib.sha1(str(root.resolve()).encode()).hexdigest()[:8]


def resolve_repo_path(roots: list[Path], repo_id: str) -> Path | None:
    if "::" not in repo_id:
        return None
    key, name = repo_id.split("::", 1)
    if "/" in name or "\\" in name or name in ("..", "."):
        return None
    for root in roots:
        if root_key(root) == key:
            path = root / name
            if (path / ".git").exists():
                return path
    return None


def list_repos(roots: list[Path]) -> list[RepoSummary]:
    """Scan the immediate children of each root for git repos. No recursion."""
    repos: list[RepoSummary] = []
    for root in roots:
        if not root.is_dir():
            continue
        key = root_key(root)
        with os.scandir(root) as it:
            for entry in it:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                path = Path(entry.path)
                if not (path / ".git").exists():
                    continue
                try:
                    current_branch = get_current_branch(Repo(path))
                except Exception:
                    current_branch = None
                repos.append(
                    RepoSummary(
                        id=f"{key}::{entry.name}",
                        name=entry.name,
                        path=str(path.resolve()),
                        current_branch=current_branch,
                    )
                )
    repos.sort(key=lambda r: r.name.lower())
    return repos

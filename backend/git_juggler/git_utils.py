from __future__ import annotations

from git import Repo


def get_current_branch(repo: Repo) -> str | None:
    try:
        return repo.active_branch.name
    except TypeError:
        return None  # detached HEAD

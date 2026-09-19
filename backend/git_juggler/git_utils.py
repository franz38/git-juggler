from __future__ import annotations

from git import Repo


def get_current_branch(repo: Repo) -> str | None:
    try:
        return repo.active_branch.name
    except TypeError:
        return None  # detached HEAD


def get_worktree_branches(repo: Repo) -> list[str]:
    """Branch names currently checked out in *any* worktree of this repo
    (including the one `repo` points at), so the graph can give each of them
    a stable lane instead of treating them like an ordinary, not-checked-out
    branch. `repo.active_branch` only sees HEAD of `repo`'s own path, so a
    branch checked out in a sibling worktree is otherwise indistinguishable
    from one nobody is using.
    """
    try:
        raw = repo.git.worktree("list", "--porcelain")
    except Exception:
        return []
    branches: list[str] = []
    prefix = "refs/heads/"
    for line in raw.splitlines():
        if line.startswith("branch "):
            ref = line[len("branch "):].strip()
            if ref.startswith(prefix):
                branches.append(ref[len(prefix):])
    return branches

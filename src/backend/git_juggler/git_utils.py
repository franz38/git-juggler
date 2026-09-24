from __future__ import annotations

from git import Repo


def get_current_branch(repo: Repo) -> str | None:
    try:
        return repo.active_branch.name
    except TypeError:
        return None  # detached HEAD


def parse_worktree_branches(raw: str) -> list[str]:
    """Branch names currently checked out in *any* worktree of a repo, out of
    `git worktree list --porcelain` output, so the graph can give each of them
    a stable lane instead of treating them like an ordinary, not-checked-out
    branch. A repo's own HEAD only shows the branch checked out at its own
    path, so one checked out in a sibling worktree is otherwise
    indistinguishable from one nobody is using.
    """
    branches: list[str] = []
    prefix = "refs/heads/"
    for line in raw.splitlines():
        if line.startswith("branch "):
            ref = line[len("branch "):].strip()
            if ref.startswith(prefix):
                branches.append(ref[len(prefix):])
    return branches

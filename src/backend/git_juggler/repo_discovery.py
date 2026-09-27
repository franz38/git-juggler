from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

from git import Repo

from .git.utils import get_current_branch
from .schemas import RepoSummary

# Lets the frontend poll a live "N found" count while list_repos() is
# scanning — a single global tracker, not per-scan, since only one scan
# realistically runs at a time; it's a cosmetic progress indicator, not
# something correctness depends on.
_scan_progress_lock = threading.Lock()
_scan_progress: dict[str, object] = {"found": 0, "scanning": False}


def get_scan_progress() -> dict[str, object]:
    with _scan_progress_lock:
        return dict(_scan_progress)


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


def _resolve_git_dir(dot_git: Path) -> Path:
    """Resolve a repo's own git-dir from its `.git` entry: a plain directory
    for a normal checkout, or (for a worktree checkout) a file containing
    `gitdir: <path>` pointing at the real one under the main repo's
    `.git/worktrees/<name>`."""
    if dot_git.is_dir():
        return dot_git
    content = dot_git.read_text(encoding="utf-8", errors="replace").strip()
    prefix = "gitdir:"
    if not content.lower().startswith(prefix):
        return dot_git
    target = Path(content[len(prefix) :].strip())
    if not target.is_absolute():
        target = (dot_git.parent / target).resolve()
    return target


def _read_current_branch(git_dir: Path) -> str | None:
    """Best-effort branch name straight from HEAD, no GitPython/subprocess.
    Returns None for detached HEAD or an unreadable/unexpected HEAD file --
    same as get_current_branch's behavior, just read directly."""
    try:
        content = (git_dir / "HEAD").read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    prefix = "ref: refs/heads/"
    if content.startswith(prefix):
        return content[len(prefix) :]
    return None


def _resolve_common_dir(git_dir: Path) -> Path:
    """No-subprocess equivalent of `git rev-parse --git-common-dir`: reads
    the same `commondir` file GitPython's own `common_dir` property reads
    internally. Absent for a non-worktree repo, whose own git-dir already
    *is* the common dir."""
    commondir_file = git_dir / "commondir"
    try:
        content = commondir_file.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return git_dir
    common = Path(content)
    if not common.is_absolute():
        common = (git_dir / common).resolve()
    return common


def _scan_repo_fast(path: Path) -> tuple[str | None, str]:
    """Direct-file-read fast path: a normal repo or worktree checkout costs
    2-3 small reads here, versus constructing a full GitPython Repo (which
    also parses config, resolves alternates, etc.) or shelling out to git."""
    git_dir = _resolve_git_dir(path / ".git")
    current_branch = _read_current_branch(git_dir)
    repository_id = str(_resolve_common_dir(git_dir).resolve())
    return current_branch, repository_id


def _scan_repo_via_gitpython(path: Path) -> tuple[str | None, str]:
    """Fallback for anything the fast path can't handle (unusual layouts,
    unreadable files, etc.) -- still no subprocess, since repo.common_dir
    is computed the same way GitPython builds it internally."""
    repo = Repo(path)
    current_branch = get_current_branch(repo)
    repository_id = str(Path(repo.common_dir).resolve())
    return current_branch, repository_id


def list_repos(roots: list[Path]) -> list[RepoSummary]:
    """Scan the immediate children of each root for git repos. No recursion."""
    with _scan_progress_lock:
        _scan_progress["scanning"] = True
        _scan_progress["found"] = 0
    try:
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
                        current_branch, repository_id = _scan_repo_fast(path)
                    except Exception:
                        try:
                            current_branch, repository_id = _scan_repo_via_gitpython(path)
                        except Exception:
                            current_branch = None
                            repository_id = str((path / ".git").resolve())
                    repos.append(
                        RepoSummary(
                            id=f"{key}::{entry.name}",
                            name=entry.name,
                            path=str(path.resolve()),
                            repository_id=repository_id,
                            current_branch=current_branch,
                        )
                    )
                    with _scan_progress_lock:
                        _scan_progress["found"] = len(repos)
        repos.sort(key=lambda r: r.name.lower())
        return repos
    finally:
        with _scan_progress_lock:
            _scan_progress["scanning"] = False

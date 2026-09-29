from __future__ import annotations

import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from ...git.gitfiles import Checkout, UnsupportedLayout, find_checkout, read_head
from .paths import normalize_path


@dataclass(frozen=True)
class GitWorktreeInfo:
    repository_id: str
    worktree_path: str
    common_git_dir: str
    branch: str | None
    commit: str


class GitCommandRunner:
    def run(self, args: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)  # noqa: S603 - fixed executable plus arg array


@dataclass(frozen=True)
class _Layout:
    checkout: Checkout
    worktree_path: str
    common_git_dir: str


# Marks a directory whose layout the file readers don't handle: ask git.
_ASK_GIT = object()


class GitResolver:
    """Maps a path to its git worktree (root, repo id, branch, commit).

    Reads the same files `git rev-parse` would (see git/gitfiles.py), so a
    lookup is a few small reads and never a process. Which checkout a
    directory belongs to is kept for `layout_ttl_seconds`; HEAD is read again
    once `head_ttl_seconds` have passed, so every recompute of a caller that
    polls sees the current branch and commit.

    Layouts the readers don't handle fall back to one `git rev-parse` per
    directory per `ttl_seconds` (including "not a repo"). `ttl_seconds` is
    also what callers use to bound how long they reuse a result.
    """

    def __init__(self, runner: GitCommandRunner | None = None, ttl_seconds: float = 3.0, clock: Callable[[], float] = time.monotonic, layout_ttl_seconds: float = 30.0, head_ttl_seconds: float = 0.5) -> None:
        self.runner = runner or GitCommandRunner()
        self.ttl_seconds = ttl_seconds
        self.layout_ttl_seconds = layout_ttl_seconds
        self.head_ttl_seconds = head_ttl_seconds
        self._clock = clock
        self._layouts: dict[str, tuple[float, object]] = {}
        self._heads: dict[Path, tuple[float, object]] = {}
        self._cache: dict[str, tuple[float, GitWorktreeInfo | None]] = {}

    def clear_cache(self) -> None:
        self._layouts.clear()
        self._heads.clear()
        self._cache.clear()

    def resolve_directory(self, directory: str | Path) -> GitWorktreeInfo | None:
        try:
            key = normalize_path(directory)
        except OSError:
            return None
        now = self._clock()
        layout = self._layout(key, now)
        if layout is None:
            return None
        if layout is _ASK_GIT:
            return self._resolve_with_git_cached(key, now)
        assert isinstance(layout, _Layout)
        head = self._head(layout.checkout, now)
        if head is _ASK_GIT:
            return self._resolve_with_git_cached(key, now)
        if head is None:
            return None  # a branch with no commits yet: nothing to attribute
        branch, commit = head  # type: ignore[misc]
        return GitWorktreeInfo(
            repository_id=layout.common_git_dir,
            worktree_path=layout.worktree_path,
            common_git_dir=layout.common_git_dir,
            branch=branch,
            commit=commit,
        )

    def _layout(self, key: str, now: float) -> object:
        cached = self._layouts.get(key)
        if cached is not None and now - cached[0] < self.layout_ttl_seconds:
            return cached[1]
        layout: object
        try:
            checkout = find_checkout(Path(key))
            layout = None if checkout is None else _Layout(checkout, normalize_path(checkout.top_level), normalize_path(checkout.common_dir))
        except (UnsupportedLayout, OSError):
            layout = _ASK_GIT
        self._layouts[key] = (now, layout)
        return layout

    def _head(self, checkout: Checkout, now: float) -> object:
        cached = self._heads.get(checkout.git_dir)
        if cached is not None and now - cached[0] < self.head_ttl_seconds:
            return cached[1]
        head: object
        try:
            head = read_head(checkout)
        except (UnsupportedLayout, OSError):
            head = _ASK_GIT
        self._heads[checkout.git_dir] = (now, head)
        return head

    def _resolve_with_git_cached(self, key: str, now: float) -> GitWorktreeInfo | None:
        cached = self._cache.get(key)
        if cached is not None and now - cached[0] < self.ttl_seconds:
            return cached[1]
        info = self._resolve_with_git(Path(key))
        self._cache[key] = (now, info)
        return info

    def resolve_path(self, path: str | Path) -> GitWorktreeInfo | None:
        try:
            candidate = Path(path).expanduser().resolve()
        except OSError:
            return None
        # Discovery walks up on its own, so only step up past directories
        # that don't exist (e.g. a deleted file's folder).
        while not candidate.is_dir():
            parent = candidate.parent
            if parent == candidate:
                return None
            candidate = parent
        return self.resolve_directory(candidate)

    def _resolve_with_git(self, directory: Path) -> GitWorktreeInfo | None:
        # One spawn for everything. `--abbrev-ref` only affects the argument
        # after it, so the output is: toplevel, common dir, full sha, branch
        # ("HEAD" when detached). Fails as a whole in a non-repo or unborn repo.
        output = self._git(directory, "rev-parse", "--show-toplevel", "--git-common-dir", "HEAD", "--abbrev-ref", "HEAD")
        lines = output.splitlines() if output else []
        if len(lines) != 4:
            return None
        top_level, common_git_dir, commit, branch = lines
        return GitWorktreeInfo(
            repository_id=self._normalize_git_path(directory, common_git_dir),
            worktree_path=normalize_path(top_level),
            common_git_dir=self._normalize_git_path(directory, common_git_dir),
            branch=None if branch == "HEAD" else branch,
            commit=commit,
        )

    def _git(self, directory: Path, *args: str) -> str | None:
        try:
            result = self.runner.run(["git", "-C", str(directory), *args])
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0:
            return None
        return result.stdout.strip()

    def _normalize_git_path(self, directory: Path, raw_path: str) -> str:
        path = Path(raw_path)
        if not path.is_absolute():
            path = directory / path
        return normalize_path(path)

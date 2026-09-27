from __future__ import annotations

import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

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


class GitResolver:
    """Maps a path to its git worktree (root, repo id, branch, commit).

    Results are cached for `ttl_seconds` (including "not a repo"), so a caller
    that resolves the same directories every second only spawns git once per
    directory per TTL window. The TTL bounds how stale branch/commit can be.
    """

    def __init__(self, runner: GitCommandRunner | None = None, ttl_seconds: float = 3.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.runner = runner or GitCommandRunner()
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._cache: dict[str, tuple[float, GitWorktreeInfo | None]] = {}

    def clear_cache(self) -> None:
        self._cache.clear()

    def resolve_directory(self, directory: str | Path) -> GitWorktreeInfo | None:
        try:
            key = normalize_path(directory)
        except OSError:
            return None
        now = self._clock()
        cached = self._cache.get(key)
        if cached is not None and now - cached[0] < self.ttl_seconds:
            return cached[1]
        info = self._resolve_uncached(Path(key))
        self._cache[key] = (now, info)
        return info

    def resolve_path(self, path: str | Path) -> GitWorktreeInfo | None:
        try:
            candidate = Path(path).expanduser().resolve()
        except OSError:
            return None
        # git discovers the repo by walking up on its own, so only step up past
        # directories that don't exist (e.g. a deleted file's folder); never
        # spawn git once per ancestor.
        while not candidate.is_dir():
            parent = candidate.parent
            if parent == candidate:
                return None
            candidate = parent
        return self.resolve_directory(candidate)

    def _resolve_uncached(self, directory: Path) -> GitWorktreeInfo | None:
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

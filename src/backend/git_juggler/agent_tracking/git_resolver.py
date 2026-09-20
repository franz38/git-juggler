from __future__ import annotations

import subprocess
from collections.abc import Sequence
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
    def __init__(self, runner: GitCommandRunner | None = None) -> None:
        self.runner = runner or GitCommandRunner()
        self._cache: dict[str, GitWorktreeInfo | None] = {}

    def clear_cache(self) -> None:
        self._cache.clear()

    def resolve_directory(self, directory: str | Path) -> GitWorktreeInfo | None:
        try:
            key = normalize_path(directory)
        except OSError:
            return None
        if key not in self._cache:
            self._cache[key] = self._resolve_uncached(Path(key))
        return self._cache[key]

    def resolve_path(self, path: str | Path) -> GitWorktreeInfo | None:
        try:
            candidate = Path(path).expanduser().resolve()
        except OSError:
            return None
        if candidate.is_file():
            candidate = candidate.parent
        while True:
            resolved = self.resolve_directory(candidate)
            if resolved is not None:
                return resolved
            parent = candidate.parent
            if parent == candidate:
                return None
            candidate = parent

    def _resolve_uncached(self, directory: Path) -> GitWorktreeInfo | None:
        top_level = self._git(directory, "rev-parse", "--show-toplevel")
        common_git_dir = self._git(directory, "rev-parse", "--git-common-dir")
        commit = self._git(directory, "rev-parse", "HEAD")
        if top_level is None or common_git_dir is None or commit is None:
            return None

        branch = self._git(directory, "branch", "--show-current")
        normalized_common = self._normalize_git_path(directory, common_git_dir)
        normalized_top = normalize_path(top_level)
        return GitWorktreeInfo(
            repository_id=normalized_common,
            worktree_path=normalized_top,
            common_git_dir=normalized_common,
            branch=branch if branch else None,
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

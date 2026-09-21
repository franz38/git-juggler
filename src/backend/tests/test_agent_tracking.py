from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from git_juggler.agent_tracking.git_resolver import GitResolver


class GitResolverIntegrationTest(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> str:
        result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def _init_repo(self, path: Path) -> str:
        path.mkdir(parents=True)
        self._git(path, "init")
        self._git(path, "config", "user.name", "Test User")
        self._git(path, "config", "user.email", "test@example.com")
        (path / "notes.txt").write_text("hello\n", encoding="utf-8")
        self._git(path, "add", "notes.txt")
        self._git(path, "commit", "-m", "initial")
        return self._git(path, "rev-parse", "HEAD")

    def test_resolves_normal_repository_with_spaces(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo_path = Path(directory) / "repo with spaces"
            commit = self._init_repo(repo_path)

            info = GitResolver().resolve_directory(repo_path)

            self.assertIsNotNone(info)
            assert info is not None
            self.assertEqual(info.worktree_path, str(repo_path.resolve()))
            self.assertEqual(info.repository_id, str((repo_path / ".git").resolve()))
            self.assertEqual(info.commit, commit)
            self.assertIsNotNone(info.branch)

    def test_resolves_detached_head(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo_path = Path(directory) / "repo"
            commit = self._init_repo(repo_path)
            self._git(repo_path, "checkout", "--detach", commit)

            info = GitResolver().resolve_directory(repo_path)

            self.assertIsNotNone(info)
            assert info is not None
            self.assertIsNone(info.branch)
            self.assertEqual(info.commit, commit)

    def test_resolves_linked_worktree_to_same_repository_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_path = root / "repo"
            worktree_path = root / "repo-feature"
            self._init_repo(repo_path)
            self._git(repo_path, "worktree", "add", "-b", "feature/test", str(worktree_path))

            resolver = GitResolver()
            main = resolver.resolve_directory(repo_path)
            linked = resolver.resolve_directory(worktree_path)

            self.assertIsNotNone(main)
            self.assertIsNotNone(linked)
            assert main is not None and linked is not None
            self.assertEqual(main.repository_id, linked.repository_id)
            self.assertNotEqual(main.worktree_path, linked.worktree_path)
            self.assertEqual(linked.branch, "feature/test")

    def test_resolves_file_path_to_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo_path = Path(directory) / "repo"
            self._init_repo(repo_path)
            file_path = repo_path / "notes.txt"

            info = GitResolver().resolve_path(file_path)

            self.assertIsNotNone(info)
            assert info is not None
            self.assertEqual(info.worktree_path, str(repo_path.resolve()))

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from git_juggler.repos import get_scan_progress, list_repos


class RepoListTest(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> str:
        result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def _init_repo(self, path: Path) -> None:
        path.mkdir(parents=True)
        self._git(path, "init")
        self._git(path, "config", "user.name", "Test User")
        self._git(path, "config", "user.email", "test@example.com")
        (path / "file.txt").write_text("base\n", encoding="utf-8")
        self._git(path, "add", "file.txt")
        self._git(path, "commit", "-m", "initial")

    def test_repository_id_is_relative_to_each_repo_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo_a = root / "repo-a"
            repo_b = root / "repo-b"
            self._init_repo(repo_a)
            self._init_repo(repo_b)

            summaries = {repo.name: repo for repo in list_repos([root])}

            self.assertEqual(summaries["repo-a"].repository_id, str((repo_a / ".git").resolve()))
            self.assertEqual(summaries["repo-b"].repository_id, str((repo_b / ".git").resolve()))

    def test_repository_id_matches_between_a_repo_and_its_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            worktree = root / "repo-worktree"
            self._git(repo, "worktree", "add", "-b", "feature", str(worktree))

            summaries = {repo_summary.name: repo_summary for repo_summary in list_repos([root])}

            self.assertEqual(summaries["repo"].repository_id, summaries["repo-worktree"].repository_id)
            self.assertEqual(summaries["repo"].repository_id, str((repo / ".git").resolve()))
            self.assertEqual(summaries["repo-worktree"].current_branch, "feature")

    def test_current_branch_is_none_for_detached_head(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            head_commit = self._git(repo, "rev-parse", "HEAD")
            self._git(repo, "checkout", head_commit)

            summaries = {repo_summary.name: repo_summary for repo_summary in list_repos([root])}

            self.assertIsNone(summaries["repo"].current_branch)

    def test_current_branch_matches_named_branch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            expected_branch = self._git(repo, "rev-parse", "--abbrev-ref", "HEAD")

            summaries = {repo_summary.name: repo_summary for repo_summary in list_repos([root])}

            self.assertEqual(summaries["repo"].current_branch, expected_branch)

    def test_scan_progress_reflects_repos_found_and_resets_scanning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._init_repo(root / "repo-a")
            self._init_repo(root / "repo-b")

            list_repos([root])
            progress = get_scan_progress()

            self.assertEqual(progress["found"], 2)
            self.assertFalse(progress["scanning"])


if __name__ == "__main__":
    unittest.main()

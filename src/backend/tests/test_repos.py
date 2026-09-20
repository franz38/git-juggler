from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from git_juggler.repos import list_repos


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


if __name__ == "__main__":
    unittest.main()

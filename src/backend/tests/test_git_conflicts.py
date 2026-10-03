from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from git import Actor, GitCommandError, Repo

from git_juggler.git.conflicts import (
    consume_resolution_token,
    create_resolution_token,
    get_conflict_file_content,
)
from git_juggler.git.data import get_repo_status

AUTHOR = Actor("Test User", "test@example.com")


class GitConflictsTest(unittest.TestCase):
    def _init_repo(self, path: Path) -> Repo:
        repo = Repo.init(path)
        with repo.config_writer() as config:
            config.set_value("user", "name", AUTHOR.name)
            config.set_value("user", "email", AUTHOR.email)
        return repo

    def test_merge_conflict_state_content_and_resolution_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path)
            (path / "notes.txt").write_text("base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("base", author=AUTHOR, committer=AUTHOR)
            repo.git.branch("feature")

            (path / "notes.txt").write_text("main\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("main", author=AUTHOR, committer=AUTHOR)

            repo.git.checkout("feature")
            (path / "notes.txt").write_text("feature\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("feature", author=AUTHOR, committer=AUTHOR)

            repo.git.checkout("master")
            with self.assertRaises(GitCommandError):
                repo.git.merge("feature")

            status = get_repo_status(path)
            self.assertEqual(status.conflict_state.operation, "merge")
            self.assertFalse(status.conflict_state.can_continue)
            self.assertEqual(status.conflict_state.files[0].path, "notes.txt")
            self.assertEqual(status.conflict_state.files[0].status, "both_modified")
            self.assertTrue(status.conflict_state.files[0].base_available)
            self.assertTrue(status.conflict_state.files[0].ours_available)
            self.assertTrue(status.conflict_state.files[0].theirs_available)
            self.assertEqual(status.uncommitted_files[0].status, "conflicted")

            content = get_conflict_file_content(path, "notes.txt")
            self.assertIn("<<<<<<<", content.worktree or "")
            self.assertEqual(content.base, "base\n")
            self.assertEqual(content.ours, "main\n")
            self.assertEqual(content.theirs, "feature\n")

            token = create_resolution_token("repo", "notes.txt", "resolved\n")
            consume_resolution_token(token, "notes.txt", path)
            self.assertEqual((path / "notes.txt").read_text(encoding="utf-8"), "resolved\n")

            repo.index.add(["notes.txt"])
            resolved = get_repo_status(path)
            self.assertEqual(resolved.conflict_state.operation, "merge")
            self.assertEqual(resolved.conflict_state.files, [])
            self.assertTrue(resolved.conflict_state.can_continue)


if __name__ == "__main__":
    unittest.main()

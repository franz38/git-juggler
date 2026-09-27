from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git import Actor, Repo

from git_juggler.git import diff as file_diff
from git_juggler.git.detail import get_commit_detail
from git_juggler.git.diff import get_commit_file_diff, get_working_file_diff

AUTHOR = Actor("Test User", "test@example.com")


class FileDiffTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name)
        self.repo = Repo.init(self.path)
        with self.repo.config_writer() as config:
            config.set_value("user", "name", AUTHOR.name)
            config.set_value("user", "email", AUTHOR.email)

    def _commit(self, message: str, *paths: str) -> str:
        self.repo.index.add(list(paths))
        return self.repo.index.commit(message, author=AUTHOR, committer=AUTHOR).hexsha

    def test_root_commit_shows_file_as_added(self) -> None:
        (self.path / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
        sha = self._commit("init", "a.txt")
        result = get_commit_file_diff(self.path, sha, "a.txt")
        self.assertIn("+one", result.patch)
        self.assertIn("new file mode", result.patch)
        self.assertFalse(result.binary)

    def test_modified_and_deleted_file(self) -> None:
        (self.path / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
        self._commit("init", "a.txt")
        (self.path / "a.txt").write_text("one\nthree\n", encoding="utf-8")
        modified = self._commit("edit", "a.txt")
        result = get_commit_file_diff(self.path, modified, "a.txt")
        self.assertIn("-two", result.patch)
        self.assertIn("+three", result.patch)

        self.repo.index.remove(["a.txt"], working_tree=True)
        deleted = self.repo.index.commit("rm", author=AUTHOR, committer=AUTHOR).hexsha
        result = get_commit_file_diff(self.path, deleted, "a.txt")
        self.assertIn("deleted file mode", result.patch)
        self.assertIn("-three", result.patch)

    def test_rename_uses_old_path(self) -> None:
        (self.path / "old.txt").write_text("line1\nline2\nline3\nline4\n", encoding="utf-8")
        self._commit("init", "old.txt")
        self.repo.git.mv("old.txt", "new.txt")
        sha = self.repo.index.commit("mv", author=AUTHOR, committer=AUTHOR).hexsha

        detail = get_commit_detail(self.path, sha)
        self.assertEqual(detail.files[0].path, "new.txt")
        self.assertEqual(detail.files[0].old_path, "old.txt")
        self.assertEqual((detail.files[0].additions, detail.files[0].deletions), (0, 0))

        result = get_commit_file_diff(self.path, sha, "new.txt", "old.txt")
        self.assertIn("rename from old.txt", result.patch)
        self.assertNotIn("+line1", result.patch)

    def test_detail_reports_line_counts(self) -> None:
        (self.path / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
        root = self._commit("init", "a.txt")
        (self.path / "a.txt").write_text("one\nthree\nfour\n", encoding="utf-8")
        edit = self._commit("edit", "a.txt")

        root_file = get_commit_detail(self.path, root).files[0]
        self.assertEqual((root_file.additions, root_file.deletions), (2, 0))
        edit_file = get_commit_detail(self.path, edit).files[0]
        self.assertEqual((edit_file.additions, edit_file.deletions), (2, 1))

    def test_full_flag_includes_unchanged_lines(self) -> None:
        lines = [f"line{i}\n" for i in range(40)]
        (self.path / "a.txt").write_text("".join(lines), encoding="utf-8")
        self._commit("init", "a.txt")
        lines[20] = "changed\n"
        (self.path / "a.txt").write_text("".join(lines), encoding="utf-8")
        sha = self._commit("edit", "a.txt")

        short = get_commit_file_diff(self.path, sha, "a.txt")
        self.assertNotIn("line0\n", short.patch)
        full = get_commit_file_diff(self.path, sha, "a.txt", full=True)
        self.assertIn(" line0\n", full.patch)
        self.assertIn(" line39\n", full.patch)

        (self.path / "a.txt").write_text("".join(lines) + "tail\n", encoding="utf-8")
        working = get_working_file_diff(self.path, "a.txt", full=True)
        self.assertIn(" line0\n", working.patch)
        self.assertIn("+tail", working.patch)

    def test_binary_file(self) -> None:
        (self.path / "b.bin").write_bytes(b"\x00\x01\x02\xff" * 10)
        sha = self._commit("bin", "b.bin")
        result = get_commit_file_diff(self.path, sha, "b.bin")
        self.assertTrue(result.binary)
        self.assertEqual(result.patch, "")

    def test_truncation(self) -> None:
        (self.path / "big.txt").write_text("x\n" * 500, encoding="utf-8")
        sha = self._commit("big", "big.txt")
        with patch.object(file_diff, "MAX_PATCH_BYTES", 100):
            result = get_commit_file_diff(self.path, sha, "big.txt")
        self.assertTrue(result.truncated)
        self.assertLessEqual(len(result.patch), 100)

    def test_working_tree_modified_untracked_and_deleted(self) -> None:
        (self.path / "a.txt").write_text("one\n", encoding="utf-8")
        (self.path / "gone.txt").write_text("bye\n", encoding="utf-8")
        self._commit("init", "a.txt", "gone.txt")

        (self.path / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
        self.assertIn("+two", get_working_file_diff(self.path, "a.txt").patch)

        (self.path / "new.txt").write_text("fresh\n", encoding="utf-8")
        untracked = get_working_file_diff(self.path, "new.txt")
        self.assertIn("+fresh", untracked.patch)

        (self.path / "gone.txt").unlink()
        self.assertIn("-bye", get_working_file_diff(self.path, "gone.txt").patch)

    def test_working_tree_without_head(self) -> None:
        (self.path / "a.txt").write_text("one\n", encoding="utf-8")
        self.repo.index.add(["a.txt"])
        self.assertIn("+one", get_working_file_diff(self.path, "a.txt").patch)

    def test_working_tree_rejects_path_escape(self) -> None:
        (self.path / "a.txt").write_text("one\n", encoding="utf-8")
        self._commit("init", "a.txt")
        with self.assertRaises(ValueError):
            get_working_file_diff(self.path, "../outside.txt")


if __name__ == "__main__":
    unittest.main()

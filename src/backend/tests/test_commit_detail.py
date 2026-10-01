from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git import Actor, Repo

from git_juggler.git import detail
from git_juggler.git.command import GitCommandError
from git_juggler.git.detail import get_commit_detail

AUTHOR = Actor("Zoë Author", "author@example.com")
COMMITTER = Actor("Cy Committer", "committer@example.com")


class CommitDetailTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name)
        self.repo = Repo.init(self.path, initial_branch="main")

    def _write(self, name: str, content: str | bytes) -> None:
        target = self.path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")

    def _commit(self, message: str, *paths: str) -> str:
        self.repo.index.add(list(paths))
        return self.repo.index.commit(message, author=AUTHOR, committer=COMMITTER).hexsha

    def _set_config(self, section: str, option: str, value: str) -> None:
        with self.repo.config_writer() as config:
            config.set_value(section, option, value)

    def test_metadata_and_message(self) -> None:
        self._write("a.txt", "one\n")
        root = self._commit("init", "a.txt")
        self._write("a.txt", "two\n")
        sha = self._commit("Subject line\n\nBody line 1\nBody line 2\n", "a.txt")

        result = get_commit_detail(self.path, sha)

        self.assertEqual(result.hash, sha)
        self.assertEqual(result.short_hash, sha[:7])
        self.assertEqual(result.parents, [root])
        self.assertEqual((result.author.name, result.author.email), (AUTHOR.name, AUTHOR.email))
        self.assertEqual((result.committer.name, result.committer.email), (COMMITTER.name, COMMITTER.email))
        self.assertRegex(result.authored_date, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$")
        self.assertEqual(result.subject, "Subject line")
        self.assertEqual(result.message, "Subject line\n\nBody line 1\nBody line 2\n")

    def test_binary_and_unusual_paths(self) -> None:
        self._write("bin.dat", b"x\x00y")
        self._write("dir/café ☕.md", "hi\n")
        sha = self._commit("init", "bin.dat", "dir/café ☕.md")

        files = {f.path: f for f in get_commit_detail(self.path, sha).files}

        self.assertEqual(sorted(files), ["bin.dat", "dir/café ☕.md"])
        self.assertEqual((files["bin.dat"].additions, files["bin.dat"].deletions), (None, None))
        self.assertEqual((files["dir/café ☕.md"].status, files["dir/café ☕.md"].additions), ("added", 1))

    def test_root_commit_listed_even_with_show_root_off(self) -> None:
        self._set_config("log", "showRoot", "false")
        self._write("a.txt", "one\ntwo\n")
        sha = self._commit("init", "a.txt")

        files = get_commit_detail(self.path, sha).files

        self.assertEqual([(f.path, f.status, f.additions) for f in files], [("a.txt", "added", 2)])

    def test_merges_diff_against_first_parent_only(self) -> None:
        # A combined diff would list nothing for these clean merges.
        self._set_config("log", "diffMerges", "combined")
        self._write("base.txt", "base\n")
        self._commit("init", "base.txt")
        for branch in ("b1", "b2"):
            self.repo.git.checkout("-b", branch, "main")
            self._write(f"{branch}.txt", f"{branch}\n")
            self._commit(branch, f"{branch}.txt")
        self.repo.git.checkout("main")
        self._write("main.txt", "main\n")
        self._commit("main side", "main.txt")

        env = {"GIT_AUTHOR_NAME": AUTHOR.name, "GIT_AUTHOR_EMAIL": AUTHOR.email,
               "GIT_COMMITTER_NAME": COMMITTER.name, "GIT_COMMITTER_EMAIL": COMMITTER.email}
        with self.repo.git.custom_environment(**env):
            self.repo.git.merge("--no-edit", "b1")
            two_parent = self.repo.head.commit.hexsha
            self.repo.git.reset("--hard", "HEAD~1")
            self.repo.git.merge("--no-edit", "b1", "b2")
            octopus = self.repo.head.commit.hexsha

        self.assertEqual([f.path for f in get_commit_detail(self.path, two_parent).files], ["b1.txt"])
        result = get_commit_detail(self.path, octopus)
        self.assertEqual(len(result.parents), 3)
        self.assertEqual([f.path for f in result.files], ["b1.txt", "b2.txt"])

    def test_rejects_anything_but_a_hash_before_running_git(self) -> None:
        with patch.object(detail, "run_git") as run_git:
            for sha in ("--output=/tmp/x", "HEAD", "abc", "a" * 65, "deadbeef --"):
                with self.subTest(sha=sha), self.assertRaises(ValueError):
                    get_commit_detail(self.path, sha)
            run_git.assert_not_called()

    def test_unknown_commit_raises(self) -> None:
        self._write("a.txt", "one\n")
        self._commit("init", "a.txt")
        with self.assertRaises(GitCommandError):
            get_commit_detail(self.path, "0" * 40)


if __name__ == "__main__":
    unittest.main()

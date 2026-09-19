from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from git import Actor, Repo

from git_juggler.git_data import get_graph


class GitGraphTest(unittest.TestCase):
    def _init_repo(self, path: Path, author: Actor) -> Repo:
        repo = Repo.init(path)
        with repo.config_writer() as config:
            config.set_value("user", "name", author.name)
            config.set_value("user", "email", author.email)
        return repo

    def test_stash_is_returned_as_graph_node(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)

            tracked_file = path / "notes.txt"
            tracked_file.write_text("base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            base_commit = repo.index.commit("initial commit", author=author, committer=author)

            tracked_file.write_text("base\nstashed\n", encoding="utf-8")
            repo.git.stash("push", "-m", "work in progress")

            stash_commit = repo.commit("stash@{0}")
            commits, *_ = get_graph(path)
            by_hash = {commit.hash: commit for commit in commits}

            self.assertIn(stash_commit.hexsha, by_hash)
            stash_node = by_hash[stash_commit.hexsha]
            self.assertEqual(stash_node.parents, [base_commit.hexsha])
            self.assertEqual(stash_node.branch, "stash@{0}")
            self.assertEqual(stash_node.refs.stashes, ["stash@{0}"])
            self.assertEqual(by_hash[base_commit.hexsha].refs.stashes, [])

    def test_remote_branch_is_returned_on_pushed_commit(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "repo"
            remote_path = Path(directory) / "remote.git"
            repo = self._init_repo(path, author)
            Repo.init(remote_path, bare=True)

            tracked_file = path / "notes.txt"
            tracked_file.write_text("base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            pushed_commit = repo.index.commit("initial commit", author=author, committer=author)

            branch = repo.active_branch.name
            repo.create_remote("origin", str(remote_path))
            repo.git.push("-u", "origin", branch)

            tracked_file.write_text("base\nlocal only\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("local commit", author=author, committer=author)

            commits, *_ = get_graph(path)
            by_hash = {commit.hash: commit for commit in commits}

            self.assertIn(f"origin/{branch}", by_hash[pushed_commit.hexsha].refs.remote_branches)


if __name__ == "__main__":
    unittest.main()

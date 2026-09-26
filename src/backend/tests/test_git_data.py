from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git import Actor, Repo

from git_juggler import git_data
from git_juggler.git_data import HistoryChangedError, get_commit_hashes, get_graph, get_repo_status


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

    def test_stash_base_abandoned_by_rebase_is_returned_as_graph_node(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)

            tracked_file = path / "notes.txt"
            tracked_file.write_text("initial\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            initial_commit = repo.index.commit("initial commit", author=author, committer=author)

            tracked_file.write_text("initial\nold base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            old_base_commit = repo.index.commit("old base", author=author, committer=author)

            tracked_file.write_text("initial\nold base\nstashed\n", encoding="utf-8")
            repo.git.stash("push", "-m", "work in progress")
            stash_commit = repo.commit("stash@{0}")

            repo.git.reset("--hard", initial_commit.hexsha)
            tracked_file.write_text("initial\nrebased main\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("rebased main", author=author, committer=author)

            commits, *_ = get_graph(path)
            by_hash = {commit.hash: commit for commit in commits}

            self.assertIn(old_base_commit.hexsha, by_hash)
            self.assertIn(stash_commit.hexsha, by_hash)
            self.assertEqual(by_hash[stash_commit.hexsha].parents, [old_base_commit.hexsha])

    def test_rows_follow_commit_dates_not_branch_grouping(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)
            (path / "a.txt").write_text("a\n", encoding="utf-8")
            repo.index.add(["a.txt"])

            def commit(message: str, timestamp: int, parents: list | None = None):
                date = f"{timestamp} +0000"
                return repo.index.commit(
                    message, author=author, committer=author, author_date=date, commit_date=date, parent_commits=parents
                )

            base = commit("base", 1_000)
            repo.git.branch("-M", "main")
            repo.git.branch("feature")
            feature_1 = commit("feature 1", 2_000, [base])
            merge = commit("merge feature 1", 3_000, [base, feature_1])
            main_2 = commit("main 2", 5_000, [merge])
            feature_2 = commit("feature 2", 4_000, [feature_1])
            # index.commit() moves HEAD each time, so pin both branch tips explicitly.
            repo.heads.main.commit = main_2
            repo.heads.feature.commit = feature_2

            commits, *_ = get_graph(path)
            order = [c.hash for c in commits]  # oldest first

            # feature 2 is newer than the merge that absorbed its parent, so it must sort after it.
            self.assertLess(order.index(merge.hexsha), order.index(feature_2.hexsha))

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

    def test_excluded_paths_are_filtered_from_uncommitted_files(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)

            tracked_file = path / "notes.txt"
            tracked_file.write_text("base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("initial commit", author=author, committer=author)

            (path / ".claude").mkdir()
            (path / ".claude" / "session.json").write_text("{}", encoding="utf-8")
            (path / "real_change.txt").write_text("oops\n", encoding="utf-8")

            with patch("git_juggler.git_data.config.load_excluded_paths", return_value=[".claude"]):
                status = get_repo_status(path)

            paths = {f.path for f in status.uncommitted_files}
            self.assertIn("real_change.txt", paths)
            self.assertNotIn(".claude/session.json", paths)

    def test_is_dirty_false_when_only_excluded_paths_changed(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)

            tracked_file = path / "notes.txt"
            tracked_file.write_text("base\n", encoding="utf-8")
            repo.index.add(["notes.txt"])
            repo.index.commit("initial commit", author=author, committer=author)

            (path / ".claude").mkdir()
            (path / ".claude" / "session.json").write_text("{}", encoding="utf-8")

            with patch("git_juggler.git_data.config.load_excluded_paths", return_value=[".claude"]):
                status = get_repo_status(path)

            self.assertFalse(status.is_dirty)
            self.assertEqual(status.uncommitted_files, [])

    def test_refs_signature_changes_for_new_branch_and_worktree(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "main-repo"
            path.mkdir()
            repo = self._init_repo(path, author)
            (path / "a.txt").write_text("a\n", encoding="utf-8")
            repo.index.add(["a.txt"])
            repo.index.commit("initial", author=author, committer=author)

            before = get_repo_status(path).refs_signature
            self.assertEqual(before, get_repo_status(path).refs_signature)

            repo.git.branch("feature")
            with_branch = get_repo_status(path).refs_signature
            self.assertNotEqual(before, with_branch)

            repo.git.worktree("add", str(Path(directory) / "wt"), "feature")
            self.assertNotEqual(with_branch, get_repo_status(path).refs_signature)

    def _branchy_repo(self, path: Path, author: Actor) -> Repo:
        """main with a merged feature branch and an unmerged one, 12 commits."""
        repo = self._init_repo(path, author)
        (path / "f.txt").write_text("0\n", encoding="utf-8")
        repo.index.add(["f.txt"])
        repo.index.commit("root", author=author, committer=author)
        repo.git.branch("-M", "main")
        for i in range(3):
            repo.index.commit(f"main {i}", author=author, committer=author)
        repo.git.checkout("-b", "feature")
        for i in range(3):
            repo.index.commit(f"feature {i}", author=author, committer=author)
        repo.git.checkout("main")
        repo.git.merge("--no-ff", "-m", "merge feature", "feature")
        repo.git.checkout("-b", "other", "main~2")
        for i in range(2):
            repo.index.commit(f"other {i}", author=author, committer=author)
        repo.git.checkout("main")
        return repo

    def test_pages_cover_history_newest_first_without_gaps_or_overlap(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._branchy_repo(path, author)

            full = get_graph(path, limit=1000)
            self.assertFalse(full.has_more)
            self.assertIsNone(full.next_cursor)

            first = get_graph(path, limit=5)
            self.assertTrue(first.has_more)
            self.assertEqual([c.hash for c in first.commits], [c.hash for c in full.commits[-5:]])
            self.assertEqual(first.next_cursor, first.commits[0].hash)
            self.assertEqual(first.current_branch, "main")
            self.assertEqual(first.refs_signature, full.refs_signature)

            collected = list(first.commits)
            page = first
            while page.has_more:
                page = get_graph(path, limit=5, before=page.next_cursor)
                # Later pages carry commits only; repo-wide status stays with page one.
                self.assertIsNone(page.current_branch)
                collected = page.commits + collected
            self.assertEqual([c.hash for c in collected], [c.hash for c in full.commits])
            # Ownership must not depend on which page a commit lands on.
            self.assertEqual([(c.hash, c.branch) for c in collected], [(c.hash, c.branch) for c in full.commits])

    def test_unknown_page_cursor_reports_changed_history(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._branchy_repo(path, author)
            get_graph(path, limit=5)
            with self.assertRaises(HistoryChangedError):
                get_graph(path, limit=5, before="0" * 40)

    def test_later_page_still_works_after_cache_miss(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._branchy_repo(path, author)
            first = get_graph(path, limit=5)
            git_data._history_cache.clear()
            second = get_graph(path, limit=5, before=first.next_cursor)
            self.assertEqual(len(second.commits), 5)

    def test_history_cache_is_invalidated_by_new_commit(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._branchy_repo(path, author)
            before = get_graph(path, limit=1000)
            new_commit = repo.index.commit("later", author=author, committer=author)
            after = get_graph(path, limit=1000)
            self.assertEqual(len(after.commits), len(before.commits) + 1)
            self.assertEqual(after.commits[-1].hash, new_commit.hexsha)
            self.assertIn(new_commit.hexsha, get_commit_hashes(path))

    def test_commit_hashes_cover_every_page(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._branchy_repo(path, author)
            full = get_graph(path, limit=1000)
            self.assertEqual(get_commit_hashes(path), {c.hash for c in full.commits})

    def test_root_commit_has_no_parents_and_metadata_is_filled(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._branchy_repo(path, author)
            root = get_graph(path, limit=1000).commits[0]
            self.assertEqual(root.parents, [])
            self.assertEqual(root.subject, "root")
            self.assertEqual(root.author.name, "Test User")
            self.assertEqual(root.author.email, "test@example.com")
            self.assertEqual(root.short_hash, root.hash[:7])

    def test_repo_without_commits_yields_empty_graph(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            self._init_repo(path, author)
            (path / "a.txt").write_text("a\n", encoding="utf-8")
            graph = get_graph(path)
            self.assertEqual(graph.commits, [])
            self.assertEqual(graph.branches, [])
            self.assertIsNone(graph.head_commit)
            self.assertEqual([(f.path, f.status) for f in graph.uncommitted_files], [("a.txt", "untracked")])

    def test_status_reports_staged_unstaged_renamed_and_untracked(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)
            for name in ("staged.txt", "both.txt", "gone.txt", "old name.txt", "plain.txt"):
                (path / name).write_text("base\n", encoding="utf-8")
            (path / "gone.txt").write_text("gone\n", encoding="utf-8")
            repo.index.add(["staged.txt", "both.txt", "gone.txt", "old name.txt", "plain.txt"])
            repo.index.commit("base", author=author, committer=author)

            (path / "staged.txt").write_text("x\n", encoding="utf-8")
            (path / "both.txt").write_text("x\n", encoding="utf-8")
            repo.git.add("staged.txt", "both.txt")
            (path / "both.txt").write_text("y\n", encoding="utf-8")
            (path / "gone.txt").unlink()
            repo.git.mv("old name.txt", "new name.txt")
            (path / "brand new.txt").write_text("n\n", encoding="utf-8")
            (path / "dir").mkdir()
            (path / "dir" / "a.txt").write_text("a\n", encoding="utf-8")

            with patch("git_juggler.git_data.config.load_excluded_paths", return_value=[]):
                status = get_repo_status(path)

            self.assertEqual(
                {f.path: f.status for f in status.uncommitted_files},
                {
                    "staged.txt": "modified",
                    "both.txt": "modified",
                    "gone.txt": "deleted",
                    "new name.txt": "renamed",
                    "brand new.txt": "untracked",
                    "dir/a.txt": "untracked",
                },
            )
            self.assertTrue(status.is_dirty)
            self.assertEqual(
                {f.path: (f.additions, f.deletions) for f in status.uncommitted_files},
                {
                    "staged.txt": (1, 1),
                    "both.txt": (1, 1),
                    "gone.txt": (0, 1),
                    "new name.txt": (0, 0),
                    "brand new.txt": (1, 0),
                    "dir/a.txt": (1, 0),
                },
            )

    def test_line_counts_are_unknown_for_binary_files(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = self._init_repo(path, author)
            (path / "blob.bin").write_bytes(b"\x00\x01")
            repo.index.add(["blob.bin"])
            repo.index.commit("base", author=author, committer=author)
            (path / "blob.bin").write_bytes(b"\x00\x02")
            (path / "new.bin").write_bytes(b"\x00\x03")

            with patch("git_juggler.git_data.config.load_excluded_paths", return_value=[]):
                status = get_repo_status(path)

            self.assertEqual(
                {f.path: (f.additions, f.deletions) for f in status.uncommitted_files},
                {"blob.bin": (None, None), "new.bin": (None, None)},
            )

    def test_upstream_is_reported_for_tracked_branch(self) -> None:
        author = Actor("Test User", "test@example.com")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "repo"
            remote_path = Path(directory) / "remote.git"
            repo = self._init_repo(path, author)
            Repo.init(remote_path, bare=True)
            (path / "a.txt").write_text("a\n", encoding="utf-8")
            repo.index.add(["a.txt"])
            pushed = repo.index.commit("initial", author=author, committer=author)
            branch = repo.active_branch.name
            repo.create_remote("origin", str(remote_path))
            repo.git.push("-u", "origin", branch)
            repo.index.commit("local", author=author, committer=author)

            status = get_repo_status(path)
            self.assertEqual(status.upstream_commit, pushed.hexsha)
            self.assertEqual(status.upstream_remote, "origin")
            self.assertEqual(status.upstream_branch, branch)
            self.assertEqual(status.current_branch, branch)


if __name__ == "__main__":
    unittest.main()

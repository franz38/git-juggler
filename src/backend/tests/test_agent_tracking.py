from __future__ import annotations

import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from git_juggler.agents.tracking.git_resolver import GitResolver


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


class GitResolverEfficiencyTest(unittest.TestCase):
    def _counting_resolver(self, ttl_seconds: float, clock) -> tuple[GitResolver, list[list[str]]]:
        calls: list[list[str]] = []
        resolver = GitResolver(ttl_seconds=ttl_seconds, clock=clock)
        original = resolver.runner.run

        def run(args):
            calls.append(list(args))
            return original(args)

        resolver.runner.run = run  # type: ignore[method-assign]
        return resolver, calls

    def _repo(self, path: Path) -> None:
        path.mkdir(parents=True)
        for args in (("init",), ("config", "user.name", "T"), ("config", "user.email", "t@e.c")):
            subprocess.run(["git", *args], cwd=path, check=True, capture_output=True)
        (path / "a.txt").write_text("x\n", encoding="utf-8")
        subprocess.run(["git", "add", "a.txt"], cwd=path, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "i"], cwd=path, check=True, capture_output=True)

    def _git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def test_everyday_checkouts_resolve_without_spawning_git(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            (repo / "sub").mkdir()
            self._git(repo, "worktree", "add", "-b", "feature/x", str(Path(directory) / "wt"))
            resolver, calls = self._counting_resolver(3.0, lambda: 0.0)

            for path in (repo / "a.txt", repo / "sub", Path(directory) / "wt" / "a.txt"):
                self.assertIsNotNone(resolver.resolve_path(path), path)
            self.assertEqual(calls, [])

    def test_head_is_read_again_so_a_new_commit_shows_up(self) -> None:
        now = [0.0]
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            resolver, calls = self._counting_resolver(3.0, lambda: now[0])
            first = resolver.resolve_directory(repo)

            (repo / "a.txt").write_text("y\n", encoding="utf-8")
            self._git(repo, "commit", "-am", "second")
            second_commit = self._git(repo, "rev-parse", "HEAD")
            now[0] = 0.1  # the same pass: HEAD isn't read twice
            self.assertEqual(resolver.resolve_directory(repo), first)
            now[0] = 1.0
            info = resolver.resolve_directory(repo)

            assert first is not None and info is not None
            self.assertNotEqual(first.commit, second_commit)
            self.assertEqual(info.commit, second_commit)
            self.assertEqual(calls, [])

    def test_non_git_path_needs_no_git(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            deep = Path(directory) / "a" / "b" / "c"
            deep.mkdir(parents=True)
            resolver, calls = self._counting_resolver(3.0, lambda: 0.0)

            self.assertIsNone(resolver.resolve_path(deep))
            self.assertEqual(calls, [])

    def test_missing_directory_steps_up_to_existing_one(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            resolver, calls = self._counting_resolver(3.0, lambda: 0.0)

            info = resolver.resolve_path(repo / "deleted" / "dir" / "f.txt")

            self.assertIsNotNone(info)
            self.assertEqual(calls, [])

    def test_unhandled_layout_asks_git_once_per_ttl(self) -> None:
        now = [0.0]
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            resolver, calls = self._counting_resolver(3.0, lambda: now[0])

            # Inside .git: git's own rules apply (it answers "not a work tree").
            self.assertIsNone(resolver.resolve_path(repo / ".git" / "hooks"))
            self.assertIsNone(resolver.resolve_path(repo / ".git" / "hooks"))
            self.assertEqual(len(calls), 1)
            now[0] = 3.5
            resolver.resolve_path(repo / ".git" / "hooks")
            self.assertEqual(len(calls), 2)


class FileReadsMatchGitTest(unittest.TestCase):
    """The file readers must give exactly what `git rev-parse` gives."""

    def _git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def _repo(self, path: Path, *init_args: str) -> None:
        path.mkdir(parents=True)
        self._git(path, "init", "-b", "main", *init_args)
        self._git(path, "config", "user.name", "T")
        self._git(path, "config", "user.email", "t@e.c")
        (path / "a.txt").write_text("x\n", encoding="utf-8")
        self._git(path, "add", "a.txt")
        self._git(path, "commit", "-m", "i")

    def _assert_same(self, directory: Path, expect_git_spawns: int = 0) -> None:
        resolver = GitResolver()
        spawns: list[list[str]] = []
        original = resolver.runner.run
        resolver.runner.run = lambda args: (spawns.append(list(args)), original(args))[1]  # type: ignore[method-assign]
        from_files = resolver.resolve_directory(directory)
        self.assertEqual(len(spawns), expect_git_spawns, directory)
        from_git = GitResolver()._resolve_with_git(directory.resolve())
        self.assertEqual(from_files, from_git, directory)

    def test_everyday_layouts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo with spaces"
            self._repo(repo)
            (repo / "sub" / "deeper").mkdir(parents=True)
            self._git(repo, "worktree", "add", "-b", "feature/slash", str(root / "wt"))
            self._git(repo, "worktree", "add", "--detach", str(root / "detached"))
            for path in (repo, repo / "sub" / "deeper", root / "wt", root / "detached"):
                self._assert_same(path)

    def test_branch_only_in_packed_refs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            self._git(repo, "pack-refs", "--all")
            self.assertFalse((repo / ".git" / "refs" / "heads" / "main").exists())
            self._assert_same(repo)

    def test_sha256_repository(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo, "--object-format=sha256")
            self._assert_same(repo)

    def test_submodule_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._repo(root / "lib")
            self._repo(root / "app")
            self._git(root / "app", "-c", "protocol.file.allow=always", "submodule", "add", str(root / "lib"), "lib")
            self.assertTrue((root / "app" / "lib" / ".git").is_file())
            self._assert_same(root / "app" / "lib")

    def test_no_commits_yet_and_not_a_repo(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "empty").mkdir()
            self._git(root / "empty", "init")
            (root / "plain").mkdir()
            self._assert_same(root / "empty")
            self._assert_same(root / "plain")

    def test_symbolic_branch_ref_and_inside_git_dir_ask_git(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            self._assert_same(repo / ".git" / "refs", expect_git_spawns=1)
            self._git(repo, "symbolic-ref", "refs/heads/alias", "refs/heads/main")
            self._git(repo, "symbolic-ref", "HEAD", "refs/heads/alias")
            self._assert_same(repo, expect_git_spawns=1)

    def test_tag_named_like_the_branch_gives_the_branch_name(self) -> None:
        # The one intended difference: `--abbrev-ref` disambiguates to
        # "heads/main"; the branch is "main", as the repo list shows it too.
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._repo(repo)
            self._git(repo, "tag", "main")

            from_files = GitResolver().resolve_directory(repo)
            from_git = GitResolver()._resolve_with_git(repo.resolve())

            assert from_files is not None and from_git is not None
            self.assertEqual((from_files.branch, from_git.branch), ("main", "heads/main"))
            self.assertEqual(replace(from_files, branch="heads/main"), from_git)

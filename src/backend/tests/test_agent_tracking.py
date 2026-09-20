from __future__ import annotations

import subprocess
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from git_juggler.agent_tracking.agent_process_discovery import AgentProcessDiscovery, parse_pgrep_output
from git_juggler.agent_tracking.agent_repository_tracker import AgentRepositoryTracker
from git_juggler.agent_tracking.git_resolver import GitResolver
from git_juggler.agent_tracking.linux_process_inspector import LinuxProcessInspector, parse_proc_cmdline, parse_proc_cmdline_args, parse_proc_stat_ppid
from git_juggler.agent_tracking.mac_process_inspector import parse_lsof_cwd, parse_lsof_file_paths, parse_ps_snapshot
from git_juggler.agent_tracking.process_info import ProcessInfo


class FakeInspector:
    def __init__(self, processes: list[ProcessInfo]) -> None:
        self.processes = {process.pid: process for process in processes}

    def get_process(self, pid: int) -> ProcessInfo | None:
        return self.processes.get(pid)

    def get_children(self, pid: int) -> list[ProcessInfo]:
        return [process for process in self.processes.values() if process.parent_pid == pid]

    def get_descendants(self, pid: int) -> list[ProcessInfo]:
        descendants: list[ProcessInfo] = []
        stack = self.get_children(pid)
        while stack:
            process = stack.pop()
            descendants.append(process)
            stack.extend(self.get_children(process.pid))
        return descendants


@dataclass(frozen=True)
class FakeCompletedProcess:
    stdout: str
    returncode: int = 0


class FakeRunner:
    def __init__(self, outputs: dict[str, FakeCompletedProcess]) -> None:
        self.outputs = outputs

    def run(self, args: list[str]) -> FakeCompletedProcess:
        return self.outputs.get(args[-1], FakeCompletedProcess("", 1))


class AgentTrackingParserTest(unittest.TestCase):
    def test_parses_pgrep_output(self) -> None:
        candidates = parse_pgrep_output("123 claude --dangerously-skip-permissions\nnot-a-pid nope\n456\n", "claude")

        self.assertEqual([candidate.pid for candidate in candidates], [123, 456])
        self.assertEqual(candidates[0].command_line, "claude --dangerously-skip-permissions")
        self.assertEqual(candidates[1].command_line, "claude")
        self.assertEqual(candidates[0].matched_pattern, "claude")

    def test_agent_discovery_deduplicates_patterns_and_finds_opencode(self) -> None:
        discovery = AgentProcessDiscovery(
            patterns=("claude", "Claude", "opencode"),
            runner=FakeRunner(
                {
                    "claude": FakeCompletedProcess("123 claude code\n"),
                    "Claude": FakeCompletedProcess("123 claude code\n456 Claude Helper\n"),
                    "opencode": FakeCompletedProcess("789 opencode run\n"),
                }
            ),
        )

        self.assertEqual([candidate.pid for candidate in discovery.discover()], [123, 456, 789])

    def test_parses_linux_proc_stat_with_spaces_in_comm(self) -> None:
        self.assertEqual(parse_proc_stat_ppid("1234 (agent helper) S 99 1 2 3"), 99)

    def test_parses_linux_proc_cmdline(self) -> None:
        self.assertEqual(parse_proc_cmdline(b"python3\0-m\0agent\0"), "python3 -m agent")
        self.assertEqual(parse_proc_cmdline_args(b"git\0-C\0/tmp/repo with spaces\0status\0"), ["git", "-C", "/tmp/repo with spaces", "status"])
        self.assertIsNone(parse_proc_cmdline(b""))

    def test_linux_inspector_tolerates_missing_proc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            inspector = LinuxProcessInspector(Path(directory))
            self.assertIsNone(inspector.get_process(12345))
            self.assertEqual(inspector.get_descendants(12345), [])

    def test_parses_macos_ps_snapshot(self) -> None:
        processes = parse_ps_snapshot("  10     1 /bin/zsh\n  11    10 /usr/bin/git\nmalformed\n")
        self.assertEqual(processes[10].parent_pid, 1)
        self.assertEqual(processes[10].executable, "/bin/zsh")
        self.assertEqual(processes[11].parent_pid, 10)

    def test_parses_macos_lsof_field_output(self) -> None:
        self.assertEqual(parse_lsof_cwd("p123\nn/Users/me/code/project\n"), "/Users/me/code/project")
        self.assertIsNone(parse_lsof_cwd("p123\n"))

    def test_parses_macos_lsof_file_paths_excluding_cwd(self) -> None:
        output = "p123\nfcwd\nn/Users/me/code/session\nf12\nn/Users/me/code/worktree/test3.txt\nf13\nn/private/var/log/system.log\n"

        self.assertEqual(
            parse_lsof_file_paths(output),
            ["/Users/me/code/worktree/test3.txt", "/private/var/log/system.log"],
        )


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


class AgentRepositoryTrackerTest(unittest.TestCase):
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

    def test_one_agent_can_use_multiple_repositories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            backend = Path(directory) / "backend"
            frontend = Path(directory) / "frontend"
            self._init_repo(backend)
            self._init_repo(frontend)
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="agent"),
                    ProcessInfo(101, 100, executable="/bin/zsh", cwd=str(backend)),
                    ProcessInfo(102, 100, executable="npm", cwd=str(frontend)),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual({Path(item.worktree_path).name for item in scan.worktrees}, {"backend", "frontend"})
            self.assertEqual(len(scan.processes), 3)

    def test_root_agent_cwd_is_session_directory_not_active_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_repo = Path(directory) / "backend"
            self._init_repo(session_repo)
            inspector = FakeInspector([ProcessInfo(100, 1, executable="opencode", cwd=str(session_repo))])

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual(scan.session_directory, str(session_repo))
            self.assertEqual(scan.worktrees, [])

    def test_descendant_cwd_overrides_session_directory_as_active_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_repo = Path(directory) / "backend"
            active_repo = Path(directory) / "backend-feature"
            self._init_repo(session_repo)
            self._init_repo(active_repo)
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="opencode", cwd=str(session_repo)),
                    ProcessInfo(101, 100, executable="npm", cwd=str(active_repo)),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual(scan.session_directory, str(session_repo))
            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["backend-feature"])
            self.assertEqual(scan.worktrees[0].evidence[0].process_role, "direct-child")

    def test_command_target_path_counts_as_active_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_repo = Path(directory) / "backend"
            active_repo = Path(directory) / "backend-feature"
            self._init_repo(session_repo)
            self._init_repo(active_repo)
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="opencode", cwd=str(session_repo)),
                    ProcessInfo(101, 100, executable="git", cwd=str(session_repo), command_line=f"git -C {active_repo} status"),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["backend-feature"])
            self.assertIn("git-command-path", {evidence.type for evidence in scan.worktrees[0].evidence})

    def test_command_target_path_with_spaces_uses_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_repo = Path(directory) / "backend"
            active_repo = Path(directory) / "backend feature"
            self._init_repo(session_repo)
            self._init_repo(active_repo)
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="opencode", cwd=str(session_repo)),
                    ProcessInfo(101, 100, executable="git", cwd=str(session_repo), command_line=f"git -C {active_repo} status", arguments=["git", "-C", str(active_repo), "status"]),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["backend feature"])

    def test_command_file_path_resolves_to_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_repo = Path(directory) / "backend"
            active_repo = Path(directory) / "backend-feature"
            self._init_repo(session_repo)
            self._init_repo(active_repo)
            target = active_repo / "file.txt"
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="opencode", cwd=str(session_repo)),
                    ProcessInfo(101, 100, executable="cat", cwd=str(session_repo), command_line=f"cat {target}"),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["backend-feature"])

    def test_root_file_access_marks_linked_worktree_active_not_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session_repo = root / "demo-repo"
            linked = root / "demo-repo-abc"
            self._init_repo(session_repo)
            self._git(session_repo, "worktree", "add", "-b", "abc-words", str(linked))
            target = linked / "test3.txt"
            target.write_text("ember\nharbor\nquartz\nmeadow\nsilver\n", encoding="utf-8")
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="claude", cwd=str(session_repo), open_files=[str(target)]),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual(scan.session_directory, str(session_repo))
            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["demo-repo-abc"])
            self.assertIn("file-access", {evidence.type for evidence in scan.worktrees[0].evidence})

    def test_open_ancestor_directories_do_not_count_as_file_access(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session_repo = root / "backend"
            active_repo = session_repo / ".claude" / "worktrees" / "feature"
            self._init_repo(session_repo)
            self._git(session_repo, "worktree", "add", "-b", "feature", str(active_repo))
            inspector = FakeInspector(
                [
                    ProcessInfo(
                        100,
                        1,
                        executable="node",
                        cwd=str(active_repo),
                        open_files=[str(active_repo), str(active_repo.parent), str(session_repo)],
                    ),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["feature"])
            self.assertNotIn("file-access", {evidence.type for evidence in scan.worktrees[0].evidence})

    def test_unrelated_open_files_do_not_hide_child_worktree_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "git-juggler"
            self._init_repo(repo)
            worktree = repo / ".claude" / "worktrees" / "six-features"
            self._git(repo, "worktree", "add", "-b", "worktree-six-features", str(worktree))
            system_file = root / "claude-version"
            system_file.write_text("2.1.276\n", encoding="utf-8")
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="claude bg-pty-host", cwd=str(root / "spare")),
                    ProcessInfo(101, 100, executable="claude bg-spare", cwd=str(worktree), open_files=[str(system_file)]),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual([Path(activity.worktree_path).name for activity in scan.worktrees], ["six-features"])
            self.assertIn("process-cwd", {evidence.type for evidence in scan.worktrees[0].evidence})

    def test_duplicate_processes_are_aggregated_by_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._init_repo(repo)
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="agent"),
                    ProcessInfo(101, 100, executable="zsh", cwd=str(repo)),
                    ProcessInfo(102, 101, executable="git", cwd=str(repo)),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual(len(scan.worktrees), 1)
            activity = scan.worktrees[0]
            self.assertEqual(activity.process_ids, [101, 102])
            self.assertIn("git-process", {evidence.type for evidence in activity.evidence})

    def test_multiple_worktrees_share_repository_id_but_not_activity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            linked = root / "repo-linked"
            self._init_repo(repo)
            self._git(repo, "worktree", "add", "-b", "feature/linked", str(linked))
            inspector = FakeInspector(
                [
                    ProcessInfo(100, 1, executable="agent"),
                    ProcessInfo(101, 100, executable="zsh", cwd=str(repo)),
                    ProcessInfo(102, 100, executable="python3", cwd=str(linked)),
                ]
            )

            scan = AgentRepositoryTracker(process_inspector=inspector).scan(100)

            self.assertEqual(len(scan.worktrees), 2)
            self.assertEqual(len({activity.repository_id for activity in scan.worktrees}), 1)
            self.assertEqual(len({activity.worktree_path for activity in scan.worktrees}), 2)

    def test_retains_recently_active_worktree_when_process_disappears(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            self._init_repo(repo)
            tracker = AgentRepositoryTracker(
                process_inspector=FakeInspector([ProcessInfo(100, 1, executable="agent"), ProcessInfo(101, 100, executable="zsh", cwd=str(repo))]),
                worktree_activity_ttl_ms=30_000,
            )

            first = tracker.scan(100)
            tracker.process_inspector = FakeInspector([ProcessInfo(100, 1, executable="agent")])
            second = tracker.scan(100)

            self.assertEqual(len(first.worktrees), 1)
            self.assertEqual(len(second.worktrees), 1)
            self.assertEqual(first.worktrees[0].worktree_path, second.worktrees[0].worktree_path)

    def test_process_disappearing_during_scan_does_not_fail(self) -> None:
        scan = AgentRepositoryTracker(process_inspector=FakeInspector([])).scan(999)

        self.assertEqual(scan.processes, [])
        self.assertEqual(scan.worktrees, [])


if __name__ == "__main__":
    unittest.main()

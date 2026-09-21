from __future__ import annotations

import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler import agent_hooks
from git_juggler.agent_hook_events import AgentHookEventReader


class AgentHooksTest(unittest.TestCase):
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

    def test_installs_claude_hooks_without_removing_existing_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings_path = root / "settings.json"
            recorder_path = root / "agent-hook-recorder.py"
            event_path = root / "agent-events.jsonl"
            settings_path.write_text(json.dumps({"theme": "dark"}), encoding="utf-8")

            with patch.object(agent_hooks, "CLAUDE_SETTINGS_PATH", settings_path), patch.object(agent_hooks, "RECORDER_PATH", recorder_path), patch.object(agent_hooks, "EVENT_PATH", event_path), patch.object(agent_hooks, "DATA_DIR", root):
                first = agent_hooks.install_claude_hooks()
                second = agent_hooks.install_claude_hooks()

            data = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertTrue(first.installed)
            self.assertTrue(second.installed)
            self.assertEqual(data["theme"], "dark")
            self.assertIn("SessionStart", data["hooks"])
            self.assertEqual(len(data["hooks"]["SessionStart"]), 1)
            self.assertTrue(recorder_path.exists())

    def test_opencode_install_writes_global_plugin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            plugin_path = Path(directory) / "plugins" / "git-juggler.js"
            with patch.object(agent_hooks, "OPENCODE_PLUGIN_PATH", plugin_path):
                status = agent_hooks.install_opencode_hooks()

            self.assertTrue(status.installed)
            self.assertIn("GitJugglerPlugin", plugin_path.read_text(encoding="utf-8"))

    def test_hook_event_resolves_command_target_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            worktree = root / "repo-feature"
            self._init_repo(repo)
            self._git(repo, "worktree", "add", "-b", "feature", str(worktree))
            event_path = root / "events.jsonl"
            event_path.write_text(
                json.dumps(
                    {
                        "provider": "claude",
                        "phase": "PostToolUse",
                        "cwd": str(repo),
                        "pid": 123,
                        "timestamp": int(time.time() * 1000),
                        "raw": {"session_id": "s1", "tool_name": "Bash", "tool_input": {"command": f"cd {worktree} && git status"}},
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            scans = AgentHookEventReader(event_path=event_path).recent_scans()

            self.assertEqual(len(scans), 1)
            self.assertEqual([Path(activity.worktree_path).name for activity in scans[0].worktrees], ["repo-feature"])
            feature = [activity for activity in scans[0].worktrees if Path(activity.worktree_path).name == "repo-feature"][0]
            self.assertEqual(feature.branch, "feature")
            self.assertIn("hook-posttooluse", {evidence.type for evidence in feature.evidence})

    def test_repeated_polls_reuse_result_until_events_file_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"

            def event(session: str) -> str:
                return json.dumps({"provider": "claude", "phase": "SessionStart", "cwd": str(repo), "pid": 1, "timestamp": int(time.time() * 1000), "raw": {"session_id": session}}) + "\n"

            event_path.write_text(event("s1"), encoding="utf-8")
            reader = AgentHookEventReader(event_path=event_path)
            calls: list[str] = []
            original = reader.git_resolver._resolve_uncached
            reader.git_resolver._resolve_uncached = lambda d: (calls.append(str(d)), original(d))[1]  # type: ignore[method-assign]

            first = reader.recent_scans()
            second = reader.recent_scans()
            self.assertEqual(len(first), 1)
            self.assertEqual(len(second), 1)
            self.assertEqual(len(calls), 1)

            with event_path.open("a", encoding="utf-8") as file:
                file.write(event("s2"))
            self.assertEqual(len(reader.recent_scans()), 2)

    def test_missing_events_file_yields_no_scans(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reader = AgentHookEventReader(event_path=Path(directory) / "none.jsonl")
            self.assertEqual(reader.recent_scans(), [])
            self.assertEqual(reader.recent_scans(), [])

    def _write_events(self, path: Path, events: list[dict]) -> None:
        path.write_text("".join(json.dumps(event) + "\n" for event in events), encoding="utf-8")

    def _event(self, repo: Path, phase: str, at_ms: int, session: str = "s1", **extra) -> dict:
        return {"provider": "claude", "phase": phase, "cwd": str(repo), "pid": 1, "timestamp": at_ms, "raw": {"session_id": session}, **extra}

    def test_session_is_active_then_idle_then_gone_on_end_hook(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start)])
            reader = AgentHookEventReader(event_path=event_path)

            active = reader.recent_scans(now=start + 30_000)
            self.assertEqual([(scan.state, [w.state for w in scan.worktrees]) for scan in active], [("active", ["active"])])

            idle = reader.recent_scans(now=start + 10 * 60_000)
            self.assertEqual([(scan.state, [w.state for w in scan.worktrees]) for scan in idle], [("idle", ["idle"])])

            self._write_events(event_path, [self._event(repo, "SessionStart", start), self._event(repo, "SessionEnd", start + 60_000)])
            self.assertEqual(reader.recent_scans(now=start + 10 * 60_000), [])

    def test_idle_session_is_dropped_after_a_day_and_end_is_per_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start, "a"), self._event(repo, "SessionStart", start, "b"), self._event(repo, "SessionEnd", start + 1000, "a")])
            reader = AgentHookEventReader(event_path=event_path)

            self.assertEqual(len(reader.recent_scans(now=start + 3_600_000)), 1)
            self.assertEqual(reader.recent_scans(now=start + 25 * 3_600_000), [])

    def test_session_whose_agent_process_died_is_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start, agent_pid=4242)])
            reader = AgentHookEventReader(event_path=event_path)

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                self.assertEqual(len(reader.recent_scans(now=start + 60_000)), 1)
            with patch("git_juggler.agent_hook_events._pid_alive", return_value=False):
                self.assertEqual(reader.recent_scans(now=start + 60_000), [])

    def test_opencode_plugin_pid_is_used_as_agent_pid_and_deleted_ends_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            events = [{"provider": "opencode", "phase": "SessionStart", "cwd": str(repo), "pid": 999, "timestamp": start, "raw": {"cwd": str(repo)}}]
            self._write_events(event_path, events)
            reader = AgentHookEventReader(event_path=event_path)

            seen: list[int] = []
            with patch("git_juggler.agent_hook_events._pid_alive", side_effect=lambda pid: (seen.append(pid), True)[1]):
                self.assertEqual(len(reader.recent_scans(now=start + 1000)), 1)
            self.assertEqual(seen, [999])

            events.append({"provider": "opencode", "phase": "session.deleted", "cwd": str(repo), "pid": 999, "timestamp": start + 5000, "raw": {"event": {"type": "session.deleted"}}})
            self._write_events(event_path, events)
            self.assertEqual(reader.recent_scans(now=start + 6000), [])

    def test_claude_install_includes_session_end_hook(self) -> None:
        self.assertIn("SessionEnd", agent_hooks._claude_snippet_dict()["hooks"])


if __name__ == "__main__":
    unittest.main()

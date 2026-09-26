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

            scans = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None).recent_scans()

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
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)
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
            reader = AgentHookEventReader(event_path=Path(directory) / "none.jsonl", claude_sessions_dir=None, opencode_db_path=None)
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
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

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
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(len(reader.recent_scans(now=start + 3_600_000)), 1)
            self.assertEqual(reader.recent_scans(now=start + 25 * 3_600_000), [])

    def test_opencode_session_whose_process_died_is_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [{"provider": "opencode", "phase": "SessionStart", "cwd": str(repo), "pid": 4242, "timestamp": start, "raw": {"cwd": str(repo)}}])
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

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
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            seen: list[int] = []
            with patch("git_juggler.agent_hook_events._pid_alive", side_effect=lambda pid: (seen.append(pid), True)[1]):
                self.assertEqual(len(reader.recent_scans(now=start + 1000)), 1)
            self.assertEqual(seen, [999])

            events.append({"provider": "opencode", "phase": "session.deleted", "cwd": str(repo), "pid": 999, "timestamp": start + 5000, "raw": {"event": {"type": "session.deleted"}}})
            self._write_events(event_path, events)
            self.assertEqual(reader.recent_scans(now=start + 6000), [])

    def test_claude_install_includes_session_end_hook(self) -> None:
        self.assertIn("SessionEnd", agent_hooks._claude_snippet_dict()["hooks"])

    def _card(self, directory: Path, pid: int, session_id: str, status: str = "idle", name: str | None = "my session", waiting_for: str | None = None) -> None:
        card = {"pid": pid, "sessionId": session_id, "status": status, "kind": "bg", "name": name, "cwd": "/x"}
        if waiting_for is not None:
            card["waitingFor"] = waiting_for
        (directory / f"{pid}.json").write_text(json.dumps(card), encoding="utf-8")
        (directory / f"{pid}.deadbeef.key").write_text("secret-not-json", encoding="utf-8")

    def test_claude_registry_gives_real_pid_name_status_and_closes_missing_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            sessions = root / "sessions"
            sessions.mkdir()
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start, "open"), self._event(repo, "SessionStart", start, "gone")])
            self._card(sessions, 111, "open", status="busy")
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                # 10 minutes after the last event: the timer alone says idle, but Claude says busy.
                scans = reader.recent_scans(now=start + 10 * 60_000)

            self.assertEqual(len(scans), 1)
            scan = scans[0]
            self.assertEqual((scan.provider, scan.session_id, scan.process_pid, scan.name), ("claude", "open", 111, "my session"))
            self.assertEqual((scan.state, [w.state for w in scan.worktrees]), ("active", ["active"]))

            self._card(sessions, 111, "open", status="idle")
            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                scan = reader.recent_scans(now=start + 30_000)[0]
            self.assertEqual((scan.state, [w.state for w in scan.worktrees]), ("idle", ["idle"]))

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=False):
                self.assertEqual(reader.recent_scans(now=start + 30_000), [])

    def test_claude_waiting_card_is_active_and_reports_what_it_waits_for(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            sessions = root / "sessions"
            sessions.mkdir()
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start, "s1")])
            self._card(sessions, 111, "s1", status="waiting", waiting_for="input needed")
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                scan = reader.recent_scans(now=start + 10 * 60_000)[0]
                self.assertEqual((scan.state, scan.waiting_for), ("active", "input needed"))

                self._card(sessions, 111, "s1", status="waiting")
                self.assertEqual(reader.recent_scans(now=start + 10 * 60_000)[0].waiting_for, "permission prompt")

                self._card(sessions, 111, "s1", status="busy")
                self.assertIsNone(reader.recent_scans(now=start + 10 * 60_000)[0].waiting_for)

    def test_claude_registry_change_invalidates_cached_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            sessions = root / "sessions"
            sessions.mkdir()
            event_path = root / "events.jsonl"
            self._write_events(event_path, [self._event(repo, "SessionStart", int(time.time() * 1000))])
            self._card(sessions, 111, "s1", status="busy")
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                self.assertEqual(reader.recent_scans()[0].state, "active")
                self._card(sessions, 111, "s1", status="idle")
                self.assertEqual(reader.recent_scans()[0].state, "idle")
                (sessions / "111.json").unlink()
                self.assertEqual(reader.recent_scans(), [])

    def test_missing_registry_falls_back_to_hooks_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start)])
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=root / "does-not-exist", claude_projects_dir=None, opencode_db_path=None)

            self.assertEqual(len(reader.recent_scans(now=start + 60_000)), 1)

    # --- New prompt resets what counts as proof of activity -----------------

    def _tool_event(self, cwd: Path, target: Path, at_ms: int, session: str = "s1", phase: str = "PostToolUse") -> dict:
        raw = {"session_id": session, "tool_name": "Bash", "tool_input": {"command": f"cd {target} && git status"}}
        return {"provider": "claude", "phase": phase, "cwd": str(cwd), "pid": 1, "timestamp": at_ms, "raw": raw}

    def _names(self, scan) -> list[str]:
        return sorted(Path(activity.worktree_path).name for activity in scan.worktrees)

    def _two_worktrees(self, root: Path) -> tuple[Path, Path]:
        repo = root / "repo"
        feature = root / "repo-feature"
        self._init_repo(repo)
        self._git(repo, "worktree", "add", "-b", "feature", str(feature))
        return repo, feature

    def test_new_prompt_drops_worktrees_touched_by_earlier_commands(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            events = [self._event(repo, "SessionStart", start), self._tool_event(repo, feature, start + 1000)]
            self._write_events(event_path, events)
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(self._names(reader.recent_scans(now=start + 2000)[0]), ["repo", "repo-feature"])

            # A new prompt: the earlier `cd feature` no longer counts; only the launch worktree does.
            events.append(self._event(repo, "UserPromptSubmit", start + 5000))
            self._write_events(event_path, events)
            scan = reader.recent_scans(now=start + 6000)[0]
            self.assertEqual(self._names(scan), ["repo"])
            self.assertEqual(scan.state, "active")

            # A command for the new prompt brings the other worktree back.
            events.append(self._tool_event(repo, feature, start + 7000))
            self._write_events(event_path, events)
            self.assertEqual(self._names(reader.recent_scans(now=start + 8000)[0]), ["repo", "repo-feature"])

    def test_only_the_latest_prompt_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(
                event_path,
                [
                    self._event(repo, "UserPromptSubmit", start),
                    self._tool_event(repo, feature, start + 1000),
                    self._event(repo, "UserPromptSubmit", start + 2000),
                    self._tool_event(repo, repo, start + 3000),
                ],
            )
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(self._names(reader.recent_scans(now=start + 4000)[0]), ["repo"])

    def test_a_prompt_only_resets_its_own_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(
                event_path,
                [
                    self._tool_event(repo, feature, start, session="a"),
                    self._tool_event(repo, feature, start, session="b"),
                    self._event(repo, "UserPromptSubmit", start + 1000, session="a"),
                ],
            )
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            by_session = {scan.session_id: self._names(scan) for scan in reader.recent_scans(now=start + 2000)}

            self.assertEqual(by_session, {"a": ["repo"], "b": ["repo-feature"]})

    def test_session_directory_still_reports_where_the_session_started(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000
            self._write_events(event_path, [self._event(repo, "SessionStart", start), self._event(feature, "UserPromptSubmit", start + 1000)])
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)

            scan = reader.recent_scans(now=start + 2000)[0]

            self.assertEqual(scan.session_directory, str(repo))

    def test_opencode_prompt_event_resets_activity_too(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            event_path = root / "events.jsonl"
            start = 1_000_000_000_000

            def event(phase: str, at_ms: int, **raw) -> dict:
                return {"provider": "opencode", "phase": phase, "cwd": str(repo), "pid": 999, "timestamp": at_ms, "raw": {"cwd": str(repo), "sessionID": "o1", **raw}}

            events = [event("PreToolUse", start, tool="bash", args={"command": f"cd {feature} && ls"})]
            self._write_events(event_path, events)
            reader = AgentHookEventReader(event_path=event_path, claude_sessions_dir=None, opencode_db_path=None)
            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                self.assertIn("repo-feature", self._names(reader.recent_scans(now=start + 1000)[0]))

                events.append(event("UserPromptSubmit", start + 2000))
                self._write_events(event_path, events)
                self.assertEqual(self._names(reader.recent_scans(now=start + 3000)[0]), ["repo"])

    # --- Recording the prompt hook -----------------------------------------

    def test_claude_install_adds_prompt_hook_once_and_status_requires_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings_path = root / "settings.json"
            recorder_path = root / "agent-hook-recorder.py"
            with patch.object(agent_hooks, "CLAUDE_SETTINGS_PATH", settings_path), patch.object(agent_hooks, "RECORDER_PATH", recorder_path), patch.object(agent_hooks, "EVENT_PATH", root / "e.jsonl"), patch.object(agent_hooks, "DATA_DIR", root):
                # A config installed before the prompt hook existed: all the old phases, no UserPromptSubmit.
                old_hooks = {phase: entries for phase, entries in agent_hooks._claude_snippet_dict()["hooks"].items() if phase != "UserPromptSubmit"}
                settings_path.write_text(json.dumps({"hooks": old_hooks}), encoding="utf-8")
                self.assertFalse(agent_hooks.claude_status().installed)

                agent_hooks.install_claude_hooks()
                agent_hooks.install_claude_hooks()

                data = json.loads(settings_path.read_text(encoding="utf-8"))
                self.assertEqual(len(data["hooks"]["UserPromptSubmit"]), 1)
                self.assertEqual(len(data["hooks"]["SessionStart"]), 1)
                self.assertTrue(agent_hooks.claude_status().installed)

    def test_opencode_plugin_records_new_messages_and_old_plugin_needs_reinstall(self) -> None:
        self.assertIn('"chat.message"', agent_hooks.OPENCODE_PLUGIN)
        self.assertIn("UserPromptSubmit", agent_hooks.OPENCODE_PLUGIN)
        with tempfile.TemporaryDirectory() as directory:
            plugin_path = Path(directory) / "git-juggler.js"
            plugin_path.write_text("export const GitJugglerPlugin = 1 // git-juggler-plugin v2", encoding="utf-8")
            with patch.object(agent_hooks, "OPENCODE_PLUGIN_PATH", plugin_path):
                self.assertFalse(agent_hooks.opencode_status().installed)
                agent_hooks.install_opencode_hooks()
                self.assertTrue(agent_hooks.opencode_status().installed)

    def _run_recorder(self, home: Path, phase: str, payload: dict) -> list[dict]:
        script = home / "recorder.py"
        script.write_text(agent_hooks.RECORDER_SCRIPT, encoding="utf-8")
        subprocess.run(["python3", str(script), "claude", phase], input=json.dumps(payload), text=True, check=True, env={"HOME": str(home), "PATH": "/usr/bin:/bin"})
        events_file = home / ".local" / "share" / "git-juggler" / "agent-events.jsonl"
        return [json.loads(line) for line in events_file.read_text(encoding="utf-8").splitlines()]

    def test_recorder_never_stores_the_prompt_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            events = self._run_recorder(Path(directory), "UserPromptSubmit", {"session_id": "s1", "cwd": "/x", "prompt": "my secret prompt"})

            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["phase"], "UserPromptSubmit")
            self.assertEqual(events[0]["raw"], {"session_id": "s1", "cwd": "/x"})
            self.assertNotIn("secret", json.dumps(events))

    def test_recorder_leaves_other_phases_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            events = self._run_recorder(Path(directory), "PostToolUse", {"session_id": "s1", "prompt": "kept", "tool_name": "Bash"})

            self.assertEqual(events[0]["raw"], {"session_id": "s1", "prompt": "kept", "tool_name": "Bash"})


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler.agents import hooks as agent_hooks
from git_juggler.agents.hook_events import AgentHookEventReader
from hook_event_files import write_session_files


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
            events_dir = root / "agent-sessions"
            self._write_events(
                events_dir,
                [
                    {
                        "provider": "claude",
                        "phase": "PostToolUse",
                        "cwd": str(repo),
                        "timestamp": int(time.time() * 1000),
                        "raw": {"session_id": "s1", "tool_name": "Bash", "tool_input": {"command": f"cd {worktree} && git status"}},
                    }
                ],
            )

            scans = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None).recent_scans()

            self.assertEqual(len(scans), 1)
            self.assertEqual([Path(activity.worktree_path).name for activity in scans[0].worktrees], ["repo-feature"])
            feature = [activity for activity in scans[0].worktrees if Path(activity.worktree_path).name == "repo-feature"][0]
            self.assertEqual(feature.branch, "feature")
            self.assertIn("hook-posttooluse", {evidence.type for evidence in feature.evidence})

    def test_repeated_polls_reuse_result_until_a_session_file_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"

            def event(session: str) -> dict:
                return {"provider": "claude", "phase": "SessionStart", "cwd": str(repo), "timestamp": int(time.time() * 1000), "raw": {"session_id": session}}

            self._write_events(events_dir, [event("s1")])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)
            calls: list[str] = []
            original = reader.git_resolver.resolve_directory
            reader.git_resolver.resolve_directory = lambda d: (calls.append(str(d)), original(d))[1]  # type: ignore[method-assign]

            first = reader.recent_scans()
            second = reader.recent_scans()
            self.assertEqual(len(first), 1)
            self.assertEqual(len(second), 1)
            self.assertEqual(len(calls), 1)

            self._write_events(events_dir, [event("s1"), event("s2")])
            self.assertEqual(len(reader.recent_scans()), 2)

    def test_missing_sessions_dir_yields_no_scans(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reader = AgentHookEventReader(sessions_dir=Path(directory) / "none", claude_sessions_dir=None, opencode_db_path=None)
            self.assertEqual(reader.recent_scans(), [])
            self.assertEqual(reader.recent_scans(), [])

    def _write_events(self, directory: Path, events: list[dict]) -> None:
        write_session_files(directory, events)

    def _event(self, repo: Path, phase: str, at_ms: int, session: str = "s1", **extra) -> dict:
        return {"provider": "claude", "phase": phase, "cwd": str(repo), "timestamp": at_ms, "raw": {"session_id": session}, **extra}

    def test_session_is_active_then_idle_then_gone_on_end_hook(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start)])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            active = reader.recent_scans(now=start + 30_000)
            self.assertEqual([(scan.state, [w.state for w in scan.worktrees]) for scan in active], [("active", ["active"])])

            idle = reader.recent_scans(now=start + 10 * 60_000)
            self.assertEqual([(scan.state, [w.state for w in scan.worktrees]) for scan in idle], [("idle", ["idle"])])

            self._write_events(events_dir, [self._event(repo, "SessionStart", start), self._event(repo, "SessionEnd", start + 60_000)])
            self.assertEqual(reader.recent_scans(now=start + 10 * 60_000), [])

    def test_idle_session_is_dropped_after_a_day_and_end_is_per_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start, "a"), self._event(repo, "SessionStart", start, "b"), self._event(repo, "SessionEnd", start + 1000, "a")])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(len(reader.recent_scans(now=start + 3_600_000)), 1)
            self.assertEqual(reader.recent_scans(now=start + 25 * 3_600_000), [])

    def test_opencode_session_whose_process_died_is_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [{"provider": "opencode", "phase": "SessionStart", "cwd": str(repo), "pid": 4242, "timestamp": start, "raw": {"cwd": str(repo)}}])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                self.assertEqual(len(reader.recent_scans(now=start + 60_000)), 1)
            with patch("git_juggler.agents.hook_events._pid_alive", return_value=False):
                self.assertEqual(reader.recent_scans(now=start + 60_000), [])

    def test_opencode_plugin_pid_is_used_as_agent_pid_and_deleted_ends_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            events = [{"provider": "opencode", "phase": "SessionStart", "cwd": str(repo), "pid": 999, "timestamp": start, "raw": {"cwd": str(repo)}}]
            self._write_events(events_dir, events)
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            seen: list[int] = []
            with patch("git_juggler.agents.hook_events._pid_alive", side_effect=lambda pid: (seen.append(pid), True)[1]):
                self.assertEqual(len(reader.recent_scans(now=start + 1000)), 1)
            self.assertEqual(seen, [999])

            events.append({"provider": "opencode", "phase": "session.deleted", "cwd": str(repo), "pid": 999, "timestamp": start + 5000, "raw": {"event": {"type": "session.deleted"}}})
            self._write_events(events_dir, events)
            self.assertEqual(reader.recent_scans(now=start + 6000), [])

    def test_opencode_child_sessions_are_returned_as_subagents_with_parent_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            db_path = root / "opencode.db"
            start = 1_000_000_000_000
            self._write_events(
                events_dir,
                [
                    {"provider": "opencode", "phase": "UserPromptSubmit", "cwd": str(repo), "pid": 999, "timestamp": start, "raw": {"cwd": str(repo), "sessionID": "parent"}},
                    {"provider": "opencode", "phase": "PostToolUse", "cwd": str(repo), "pid": 999, "timestamp": start + 1000, "raw": {"cwd": str(repo), "sessionID": "child", "tool": "bash", "args": {"command": "git status"}}},
                ],
            )
            connection = sqlite3.connect(db_path)
            try:
                connection.execute("create table session (id text primary key, title text, directory text, version text, agent text, model text, time_created integer, time_updated integer, time_archived integer, parent_id text)")
                connection.execute("create table message (id text primary key, session_id text, data text, time_created integer, time_updated integer)")
                connection.execute("create table part (message_id text, data text, time_created integer)")
                connection.execute("insert into session values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("parent", "Parent task", str(repo), "1.0", "build", '{"id":"gpt-5.5"}', start, start, None, None))
                connection.execute("insert into session values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("child", "Child task", str(repo), "1.0", "review", '{"id":"gpt-5.5"}', start, start + 1000, None, "parent"))
                connection.commit()
            finally:
                connection.close()

            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=db_path)
            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                scans = reader.recent_scans(now=start + 2000)

            by_session = {scan.session_id: scan for scan in scans}
            self.assertEqual(set(by_session), {"parent", "child"})
            self.assertFalse(by_session["parent"].is_subagent)
            self.assertTrue(by_session["child"].is_subagent)
            self.assertEqual(by_session["child"].parent_session_id, "parent")
            self.assertEqual(by_session["child"].parent_title, "Parent task")
            self.assertEqual(by_session["child"].parent_agent, "build")
            self.assertEqual(by_session["child"].parent_provider, "opencode")

    def test_claude_install_includes_session_end_hook(self) -> None:
        self.assertIn("SessionEnd", agent_hooks._claude_snippet_dict()["hooks"])

    def test_claude_hook_matcher_includes_task_tool(self) -> None:
        hooks = agent_hooks._claude_snippet_dict()["hooks"]
        self.assertIn("Task", hooks["PreToolUse"][0]["matcher"])
        self.assertIn("Task", hooks["PostToolUse"][0]["matcher"])

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
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start, "open"), self._event(repo, "SessionStart", start, "gone")])
            self._card(sessions, 111, "open", status="busy")
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                # 10 minutes after the last event: the timer alone says idle, but Claude says busy.
                scans = reader.recent_scans(now=start + 10 * 60_000)

            self.assertEqual(len(scans), 1)
            scan = scans[0]
            self.assertEqual((scan.provider, scan.session_id, scan.process_pid, scan.name), ("claude", "open", 111, "my session"))
            self.assertEqual((scan.state, [w.state for w in scan.worktrees]), ("active", ["active"]))

            self._card(sessions, 111, "open", status="idle")
            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                scan = reader.recent_scans(now=start + 30_000)[0]
            self.assertEqual((scan.state, [w.state for w in scan.worktrees]), ("idle", ["idle"]))

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=False):
                self.assertEqual(reader.recent_scans(now=start + 30_000), [])

    def test_claude_waiting_card_is_active_and_reports_what_it_waits_for(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            sessions = root / "sessions"
            sessions.mkdir()
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start, "s1")])
            self._card(sessions, 111, "s1", status="waiting", waiting_for="input needed")
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
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
            events_dir = root / "agent-sessions"
            self._write_events(events_dir, [self._event(repo, "SessionStart", int(time.time() * 1000))])
            self._card(sessions, 111, "s1", status="busy")
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=sessions, claude_projects_dir=None, opencode_db_path=None)

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
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
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start)])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=root / "does-not-exist", claude_projects_dir=None, opencode_db_path=None)

            self.assertEqual(len(reader.recent_scans(now=start + 60_000)), 1)

    # --- New prompt resets what counts as proof of activity -----------------

    def _tool_event(self, cwd: Path, target: Path, at_ms: int, session: str = "s1", phase: str = "PostToolUse") -> dict:
        raw = {"session_id": session, "tool_name": "Bash", "tool_input": {"command": f"cd {target} && git status"}}
        return {"provider": "claude", "phase": phase, "cwd": str(cwd), "timestamp": at_ms, "raw": raw}

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
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            events = [self._event(repo, "SessionStart", start), self._tool_event(repo, feature, start + 1000)]
            self._write_events(events_dir, events)
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(self._names(reader.recent_scans(now=start + 2000)[0]), ["repo", "repo-feature"])

            # A new prompt: the earlier `cd feature` no longer counts; only the launch worktree does.
            events.append(self._event(repo, "UserPromptSubmit", start + 5000))
            self._write_events(events_dir, events)
            scan = reader.recent_scans(now=start + 6000)[0]
            self.assertEqual(self._names(scan), ["repo"])
            self.assertEqual(scan.state, "active")

            # A command for the new prompt brings the other worktree back.
            events.append(self._tool_event(repo, feature, start + 7000))
            self._write_events(events_dir, events)
            self.assertEqual(self._names(reader.recent_scans(now=start + 8000)[0]), ["repo", "repo-feature"])

    def test_only_the_latest_prompt_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(
                events_dir,
                [
                    self._event(repo, "UserPromptSubmit", start),
                    self._tool_event(repo, feature, start + 1000),
                    self._event(repo, "UserPromptSubmit", start + 2000),
                    self._tool_event(repo, repo, start + 3000),
                ],
            )
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            self.assertEqual(self._names(reader.recent_scans(now=start + 4000)[0]), ["repo"])

    def test_a_prompt_only_resets_its_own_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(
                events_dir,
                [
                    self._tool_event(repo, feature, start, session="a"),
                    self._tool_event(repo, feature, start, session="b"),
                    self._event(repo, "UserPromptSubmit", start + 1000, session="a"),
                ],
            )
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            by_session = {scan.session_id: self._names(scan) for scan in reader.recent_scans(now=start + 2000)}

            self.assertEqual(by_session, {"a": ["repo"], "b": ["repo-feature"]})

    def test_session_directory_still_reports_where_the_session_started(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start), self._event(feature, "UserPromptSubmit", start + 1000)])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            scan = reader.recent_scans(now=start + 2000)[0]

            self.assertEqual(scan.session_directory, str(repo))

    def test_opencode_prompt_event_resets_activity_too(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000

            def event(phase: str, at_ms: int, **raw) -> dict:
                return {"provider": "opencode", "phase": phase, "cwd": str(repo), "pid": 999, "timestamp": at_ms, "raw": {"cwd": str(repo), "sessionID": "o1", **raw}}

            events = [event("PreToolUse", start, tool="bash", args={"command": f"cd {feature} && ls"})]
            self._write_events(events_dir, events)
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)
            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                self.assertIn("repo-feature", self._names(reader.recent_scans(now=start + 1000)[0]))

                events.append(event("UserPromptSubmit", start + 2000))
                self._write_events(events_dir, events)
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

    # --- The recorder: one small file per session --------------------------

    def _session_file(self, home: Path, session: str) -> Path:
        return home / ".local" / "share" / "git-juggler" / "agent-sessions" / f"claude-{session}.jsonl"

    def _run_recorder(self, home: Path, phase: str, payload: dict | str) -> list[dict]:
        script = home / "recorder.py"
        script.write_text(agent_hooks.RECORDER_SCRIPT, encoding="utf-8")
        stdin = payload if isinstance(payload, str) else json.dumps(payload)
        result = subprocess.run([sys.executable, str(script), "claude", phase], input=stdin, text=True, capture_output=True, env={"HOME": str(home), "USERPROFILE": str(home), "PATH": "/usr/bin:/bin"})
        self.assertEqual(result.returncode, 0, result.stderr)
        session = payload.get("session_id", "none") if isinstance(payload, dict) else "none"
        path = self._session_file(home, session)
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    def test_recorder_never_stores_the_prompt_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            events = self._run_recorder(Path(directory), "UserPromptSubmit", {"session_id": "s1", "cwd": "/x", "prompt": "my secret prompt"})

            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["phase"], "UserPromptSubmit")
            self.assertEqual(events[0]["raw"], {"session_id": "s1", "cwd": "/x"})
            self.assertNotIn("secret", json.dumps(events))

    def test_recorder_keeps_only_the_fields_the_reader_uses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            payload = {
                "session_id": "s1",
                "cwd": "/x",
                "transcript_path": "/t.jsonl",
                "tool_name": "Write",
                "tool_input": {"file_path": "/x/a.py", "content": "print('file contents')", "command": "ls"},
                "tool_response": {"filePath": "/x/a.py", "content": "print('file contents')"},
            }
            events = self._run_recorder(Path(directory), "PostToolUse", payload)

            self.assertEqual(events[0]["raw"], {"session_id": "s1", "cwd": "/x", "tool_name": "Write", "tool_input": {"command": "ls", "file_path": "/x/a.py"}})
            self.assertEqual(set(events[0]), {"provider", "phase", "cwd", "timestamp", "raw"})

    def test_recorder_writes_one_file_per_session_and_a_prompt_starts_a_new_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for phase in ("SessionStart", "PreToolUse", "PostToolUse"):
                self._run_recorder(home, phase, {"session_id": "s1", "tool_name": "Bash", "tool_input": {"command": "ls"}})
            self._run_recorder(home, "SessionStart", {"session_id": "s2"})
            self.assertEqual([e["phase"] for e in self._run_recorder(home, "UserPromptSubmit", {"session_id": "s1"})], ["SessionStart", "UserPromptSubmit"])

            self._run_recorder(home, "PreToolUse", {"session_id": "s1", "tool_name": "Bash", "tool_input": {"command": "pwd"}})
            second_turn = self._run_recorder(home, "UserPromptSubmit", {"session_id": "s1"})
            self.assertEqual([e["phase"] for e in second_turn], ["SessionStart", "UserPromptSubmit"])
            self.assertEqual([e["phase"] for e in self._run_recorder(home, "SessionEnd", {"session_id": "s2"})], ["SessionStart", "SessionEnd"])

    def test_recorder_compacts_an_oversized_turn_to_what_the_reader_uses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            path = self._session_file(home, "s1")
            path.parent.mkdir(parents=True)
            padding = "x" * 2000

            def line(phase: str, index: int) -> str:
                return json.dumps({"provider": "claude", "phase": phase, "cwd": "/x", "timestamp": index, "raw": {"session_id": "s1", "command": padding}}) + "\n"

            before_prompt = [line("PreToolUse", i) for i in range(1, 700)]
            after_prompt = [line("PreToolUse", i) for i in range(1000, 1400)]
            path.write_text(line("SessionStart", 0) + "".join(before_prompt) + line("UserPromptSubmit", 900) + "".join(after_prompt), encoding="utf-8")
            self.assertGreater(path.stat().st_size, agent_hooks.COMPACT_BYTES)

            events = self._run_recorder(home, "PreToolUse", {"session_id": "s1"})

            # The first event, then the last SESSION_EVENT_LIMIT since the prompt (which itself fell out of them).
            self.assertEqual(len(events), 1 + agent_hooks.SESSION_EVENT_LIMIT)
            self.assertEqual(events[0]["phase"], "SessionStart")
            self.assertEqual(events[1]["timestamp"], 1400 - agent_hooks.SESSION_EVENT_LIMIT + 1)
            self.assertEqual(events[-1]["raw"], {"session_id": "s1"})

    def test_recorder_never_fails_the_hook(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self._run_recorder(Path(directory), "PreToolUse", "not json"), [])
            unwritable = Path(directory) / "unwritable"
            unwritable.mkdir()
            (unwritable / ".local").write_text("a file where a directory should be", encoding="utf-8")
            self.assertEqual(self._run_recorder(unwritable, "PreToolUse", {"session_id": "s1"}), [])

    # --- The OpenCode plugin writes the same files -------------------------

    @unittest.skipUnless(shutil.which("node"), "node is needed to run the plugin")
    def test_opencode_plugin_writes_slim_per_session_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            plugin = home / "git-juggler.mjs"
            plugin.write_text(agent_hooks.OPENCODE_PLUGIN, encoding="utf-8")
            driver = home / "driver.mjs"
            driver.write_text(
                f"""
import {{ GitJugglerPlugin }} from {json.dumps(plugin.as_uri())}
const hooks = await GitJugglerPlugin({{ directory: "/repo", worktree: "/repo" }})
await hooks.event({{ event: {{ type: "session.created", properties: {{ info: {{ id: "ses_1", title: "secret title", directory: "/repo" }} }} }} }})
await hooks["tool.execute.before"]({{ sessionID: "ses_1", tool: "edit" }}, {{ args: {{ filePath: "/repo/a.ts", oldString: "secret", newString: "secret" }} }})
await hooks["tool.execute.after"]({{ sessionID: "ses_1", tool: "edit" }}, {{ args: {{ filePath: "/repo/a.ts" }}, output: "secret output", metadata: {{}} }})
await hooks["chat.message"]({{ sessionID: "ses_1" }}, {{ message: {{}}, parts: [{{ type: "text", text: "secret prompt" }}] }})
await hooks.event({{ event: {{ type: "session.status", properties: {{ sessionID: "ses_1", status: {{ type: "busy" }} }} }} }})
await hooks["tool.execute.before"]({{ sessionID: "ses_2", tool: "bash" }}, {{ args: {{ command: "ls" }} }})
await hooks.event({{ event: {{ type: "session.deleted", properties: {{ info: {{ id: "ses_2" }} }} }} }})
""",
                encoding="utf-8",
            )
            result = subprocess.run(["node", str(driver)], capture_output=True, text=True, env={"HOME": str(home), "USERPROFILE": str(home), "PATH": os.environ.get("PATH", "")})
            self.assertEqual(result.returncode, 0, result.stderr)

            sessions = home / ".local" / "share" / "git-juggler" / "agent-sessions"
            self.assertEqual(sorted(p.name for p in sessions.iterdir()), ["opencode-ses_1.jsonl", "opencode-ses_2.jsonl"])
            first = [json.loads(line) for line in (sessions / "opencode-ses_1.jsonl").read_text(encoding="utf-8").splitlines()]
            # The tool calls before the prompt are gone; the session's first event stays.
            self.assertEqual([e["phase"] for e in first], ["session.created", "UserPromptSubmit", "session.status"])
            self.assertEqual(first[0]["raw"], {"cwd": "/repo", "worktree": "/repo", "event": {"type": "session.created", "properties": {"info": {"id": "ses_1"}}}})
            self.assertEqual(first[0]["agent_pid"], first[0]["pid"])
            self.assertNotIn("secret", (sessions / "opencode-ses_1.jsonl").read_text(encoding="utf-8"))
            second = [json.loads(line) for line in (sessions / "opencode-ses_2.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([e["phase"] for e in second], ["PreToolUse", "session.deleted"])
            self.assertEqual(second[0]["raw"]["args"], {"command": "ls"})

    # --- Reading the files -------------------------------------------------

    def test_session_directory_is_the_first_event_even_when_older_than_a_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            start = 1_000_000_000_000
            day = 24 * 3_600_000
            self._write_events(events_dir, [self._event(repo, "SessionStart", start), self._event(feature, "UserPromptSubmit", start + day + 1000)])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            scan = reader.recent_scans(now=start + day + 2000)[0]

            self.assertEqual((scan.session_directory, self._names(scan)), (str(repo), ["repo-feature"]))

    def test_only_changed_session_files_are_parsed_again(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            now = int(time.time() * 1000)
            self._write_events(events_dir, [self._event(repo, "SessionStart", now, "a"), self._event(repo, "SessionStart", now, "b")])
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)
            parsed: list[str] = []
            original = reader.session_files._parse
            reader.session_files._parse = lambda line: (parsed.append(line), original(line))[1]  # type: ignore[method-assign]

            self.assertEqual(len(reader.recent_scans()), 2)
            self.assertEqual(len(parsed), 2)
            with (events_dir / "claude-a.jsonl").open("a", encoding="utf-8") as file:
                file.write(json.dumps(self._tool_event(repo, repo, now + 1000, session="a")) + "\n")
            parsed.clear()

            self.assertEqual(len(reader.recent_scans()), 2)
            self.assertEqual(len(parsed), 2)  # only a's two lines

    def test_files_of_ended_and_stale_sessions_are_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            self._init_repo(repo)
            events_dir = root / "agent-sessions"
            now_ms = int(time.time() * 1000)
            self._write_events(
                events_dir,
                [
                    self._event(repo, "SessionStart", now_ms, "live"),
                    self._event(repo, "SessionStart", now_ms, "ended"),
                    self._event(repo, "SessionEnd", now_ms, "ended"),
                    self._event(repo, "SessionStart", now_ms, "stale"),
                ],
            )
            now = time.time()
            os.utime(events_dir / "claude-ended.jsonl", (now - 120, now - 120))
            os.utime(events_dir / "claude-stale.jsonl", (now - 2 * 86_400, now - 2 * 86_400))
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=None, opencode_db_path=None)

            # The first pass hasn't read the files yet, so it only knows what is stale.
            self.assertEqual([scan.session_id for scan in reader.recent_scans()], ["live"])
            self.assertEqual(sorted(p.name for p in events_dir.iterdir()), ["claude-ended.jsonl", "claude-live.jsonl"])

            reader.session_files._last_cleanup = 0
            reader.recent_scans()
            self.assertEqual([p.name for p in events_dir.iterdir()], ["claude-live.jsonl"])

    def test_old_single_log_is_still_read_merged_and_retired_once_stale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, feature = self._two_worktrees(root)
            events_dir = root / "agent-sessions"
            legacy = root / "agent-events.jsonl"
            now = int(time.time() * 1000)
            legacy_events = [
                self._event(repo, "SessionStart", now - 5000, "old"),
                {**self._tool_event(repo, feature, now - 4000, session="old"), "raw": {"session_id": "old", "tool_name": "Bash", "tool_input": {"command": f"cd {feature}"}, "tool_response": {"stdout": "x" * 1000}}},
                self._event(repo, "SessionStart", now - 3000, "moved"),
            ]
            legacy.write_text("".join(json.dumps(event) + "\n" for event in legacy_events), encoding="utf-8")
            # "moved" kept going after its hooks were upgraded.
            self._write_events(events_dir, [self._tool_event(feature, feature, now - 2000, session="moved")])
            reader = AgentHookEventReader(sessions_dir=events_dir, legacy_event_path=legacy, claude_sessions_dir=None, opencode_db_path=None)

            by_session = {scan.session_id: scan for scan in reader.recent_scans()}
            self.assertEqual(set(by_session), {"old", "moved"})
            self.assertEqual(self._names(by_session["old"]), ["repo", "repo-feature"])
            self.assertEqual(by_session["moved"].session_directory, str(repo))
            self.assertNotIn("tool_response", json.dumps([e.raw for e in reader.legacy_log._events]))

            # Appends are read incrementally.
            parsed: list[str] = []
            original = reader.legacy_log._parse
            reader.legacy_log._parse = lambda line: (parsed.append(line), original(line))[1]  # type: ignore[method-assign]
            with legacy.open("a", encoding="utf-8") as file:
                file.write(json.dumps(self._event(repo, "SessionEnd", now - 1000, "old")) + "\n")
            self.assertEqual([scan.session_id for scan in reader.recent_scans()], ["moved"])
            self.assertEqual(len(parsed), 1)

            # Untouched for a day: nothing in it can matter any more, so it goes.
            stale = time.time() - 2 * 86_400
            os.utime(legacy, (stale, stale))
            reader.recent_scans()
            self.assertFalse(legacy.exists())


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler import agent_hooks
from git_juggler.agent_hook_events import AgentHookEventReader
from git_juggler.agent_tracking import text
from git_juggler.agent_tracking.opencode_sessions import BUSY_STALE_MS, db_signature, read_session

NOW = 1_800_000_000_000


def make_db(test: unittest.TestCase, path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    test.addCleanup(connection.close)
    connection.executescript(
        """
        create table session (id text primary key, directory text, title text, version text, agent text, model text,
            time_created integer, time_updated integer, time_archived integer, parent_id text);
        create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
        create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
        """
    )
    return connection


def add_session(connection: sqlite3.Connection, session_id: str = "ses_1", directory: str = "/x", **fields) -> None:
    values = {"title": "Title", "version": "1.2.3", "agent": "build", "model": json.dumps({"id": "gpt-5.5", "providerID": "openai"}), "time_created": NOW - 60_000, "time_updated": NOW - 1000, "time_archived": None, "parent_id": None}
    values.update(fields)
    connection.execute(
        "insert into session values (?,?,?,?,?,?,?,?,?,?)",
        (session_id, directory, values["title"], values["version"], values["agent"], values["model"], values["time_created"], values["time_updated"], values["time_archived"], values["parent_id"]),
    )
    connection.commit()


def add_message(connection: sqlite3.Connection, message_id: str, role: str, at: int, session_id: str = "ses_1", completed: int | None = None, prompt: str | None = None) -> None:
    data: dict = {"role": role, "time": {"created": at}}
    if completed is not None:
        data["time"]["completed"] = completed
    connection.execute("insert into message values (?,?,?,?,?)", (message_id, session_id, at, at, json.dumps(data)))
    if prompt is not None:
        connection.execute("insert into part values (?,?,?,?,?,?)", (f"p_{message_id}", message_id, session_id, at, at, json.dumps({"type": "text", "text": prompt})))
    connection.commit()


class ReadSessionTest(unittest.TestCase):
    def test_details_and_idle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.db"
            connection = make_db(self, path)
            add_session(connection, directory="/work/repo")
            add_message(connection, "m1", "user", NOW - 30_000, prompt="first")
            add_message(connection, "m2", "assistant", NOW - 29_000, completed=NOW - 20_000)
            add_message(connection, "m3", "user", NOW - 10_000, prompt="hello\n   world " + "x" * 2000)
            add_message(connection, "m4", "assistant", NOW - 9_000, completed=NOW - 5_000)

            session = read_session(path, "ses_1", now_ms=NOW)

            assert session is not None
            self.assertEqual((session.title, session.directory, session.version, session.agent, session.model), ("Title", "/work/repo", "1.2.3", "build", "gpt-5.5"))
            self.assertFalse(session.busy)
            self.assertTrue(session.last_prompt.startswith("hello world x"))
            self.assertEqual(len(session.last_prompt), text.LAST_PROMPT_MAX_CHARS)
            self.assertTrue(session.last_prompt.endswith("…"))

    def test_busy_while_the_latest_assistant_turn_is_incomplete_but_not_when_stale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.db"
            connection = make_db(self, path)
            add_session(connection, time_updated=NOW - 1000)
            add_message(connection, "m1", "user", NOW - 5000, prompt="go")
            add_message(connection, "m2", "assistant", NOW - 4000)  # no time.completed: still running

            self.assertTrue(read_session(path, "ses_1", now_ms=NOW).busy)
            # An interrupted turn never completes; nothing written for a long time => not busy.
            self.assertFalse(read_session(path, "ses_1", now_ms=NOW + BUSY_STALE_MS + 10_000).busy)

    def test_flags_and_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.db"
            connection = make_db(self, path)
            add_session(connection, "archived", time_archived=1)
            add_session(connection, "child", parent_id="ses_parent")

            self.assertTrue(read_session(path, "archived").archived)
            self.assertTrue(read_session(path, "child").is_child)
            self.assertIsNone(read_session(path, "missing"))
            self.assertIsNone(read_session(Path(directory) / "nope.db", "archived"))
            self.assertIsNone(read_session(None, "archived"))
            (Path(directory) / "junk.db").write_text("not a database", encoding="utf-8")
            self.assertIsNone(read_session(Path(directory) / "junk.db", "archived"))

    def test_database_is_opened_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.db"
            connection = make_db(self, path)
            add_session(connection)
            before = path.read_bytes()
            read_session(path, "ses_1", now_ms=NOW)
            self.assertEqual(path.read_bytes(), before)

    def test_signature_tracks_the_database_and_is_none_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opencode.db"
            self.assertIsNone(db_signature(path))
            self.assertIsNone(db_signature(None))
            connection = make_db(self, path)
            first = db_signature(path)
            add_session(connection)
            self.assertNotEqual(first, db_signature(path))


class OpenCodeReaderTest(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> None:
        subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)

    def _repo(self, root: Path) -> tuple[Path, Path]:
        repo, worktree = root / "repo", root / "repo-wt"
        repo.mkdir()
        for args in (("init",), ("config", "user.name", "T"), ("config", "user.email", "t@e.c")):
            self._git(repo, *args)
        (repo / "a.txt").write_text("x\n", encoding="utf-8")
        self._git(repo, "add", "a.txt")
        self._git(repo, "commit", "-m", "i")
        self._git(repo, "worktree", "add", "-b", "feature", str(worktree))
        return repo, worktree

    def _events(self, path: Path, cwd: Path, session_id: str | None, phases: tuple[str, ...] = ("PostToolUse",), pid: int = 4242) -> None:
        now = int(time.time() * 1000)
        raw = {"cwd": str(cwd)}
        if session_id:
            raw["sessionID"] = session_id
        path.write_text("".join(json.dumps({"provider": "opencode", "phase": phase, "cwd": str(cwd), "pid": pid, "agent_pid": pid, "timestamp": now, "raw": raw}) + "\n" for phase in phases), encoding="utf-8")

    def _reader(self, root: Path, db: Path | None) -> AgentHookEventReader:
        return AgentHookEventReader(event_path=root / "events.jsonl", claude_sessions_dir=None, claude_projects_dir=None, opencode_db_path=db)

    def test_details_state_home_and_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
            root = Path(directory)
            repo, worktree = self._repo(root)
            db = root / "opencode.db"
            connection = make_db(self, db)
            add_session(connection, directory=str(worktree), time_updated=int(time.time() * 1000))
            add_message(connection, "m1", "user", int(time.time() * 1000) - 5000, prompt="do it")
            add_message(connection, "m2", "assistant", int(time.time() * 1000) - 4000)  # running
            self._events(root / "events.jsonl", repo, "ses_1")
            reader = self._reader(root, db)

            scan = reader.recent_scans()[0]

            self.assertEqual((scan.provider, scan.session_id, scan.process_pid, scan.name), ("opencode", "ses_1", 4242, "Title"))
            self.assertEqual(scan.state, "active")
            details = scan.details
            assert details is not None
            self.assertEqual((details.model, details.agent, details.version, details.last_prompt), ("gpt-5.5", "build", "1.2.3", "do it"))
            self.assertEqual({Path(w.worktree_path).name: w.is_home for w in scan.worktrees}, {"repo": False})

            # The turn completes: OpenCode reports idle, so the scan does too (and the DB change is noticed).
            connection.execute("update message set data = ? where id = 'm2'", (json.dumps({"role": "assistant", "time": {"created": 1, "completed": 2}}),))
            connection.commit()
            self.assertEqual(reader.recent_scans()[0].state, "idle")

            # Deleting the session closes it.
            connection.execute("delete from session where id = 'ses_1'")
            connection.commit()
            self.assertEqual(reader.recent_scans(), [])

    def test_home_is_the_worktree_of_the_session_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
            root = Path(directory)
            repo, worktree = self._repo(root)
            db = root / "opencode.db"
            connection = make_db(self, db)
            add_session(connection, directory=str(worktree))
            events = root / "events.jsonl"
            now = int(time.time() * 1000)
            events.write_text(
                "".join(
                    json.dumps({"provider": "opencode", "phase": "PostToolUse", "cwd": str(cwd), "pid": 4242, "agent_pid": 4242, "timestamp": now, "raw": {"cwd": str(cwd), "sessionID": "ses_1"}}) + "\n"
                    for cwd in (repo, worktree)
                ),
                encoding="utf-8",
            )

            scan = self._reader(root, db).recent_scans()[0]

            self.assertEqual({Path(w.worktree_path).name: w.is_home for w in scan.worktrees}, {"repo": False, "repo-wt": True})

    def test_child_archived_and_sessionless_events_are_skipped_when_the_db_exists(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
            root = Path(directory)
            repo, _ = self._repo(root)
            db = root / "opencode.db"
            connection = make_db(self, db)
            add_session(connection, "child", directory=str(repo), parent_id="ses_parent")
            add_session(connection, "archived", directory=str(repo), time_archived=1)
            reader = self._reader(root, db)

            for session_id in ("child", "archived", None):
                self._events(root / "events.jsonl", repo, session_id, phases=("SessionStart",))
                self.assertEqual(reader.recent_scans(), [], session_id)

    def test_dead_process_is_dropped_and_missing_db_falls_back_to_hooks_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, _ = self._repo(root)
            db = root / "opencode.db"
            add_session(make_db(self, db), directory=str(repo))
            self._events(root / "events.jsonl", repo, "ses_1")

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=False):
                self.assertEqual(self._reader(root, db).recent_scans(), [])
            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                fallback = self._reader(root, root / "missing.db").recent_scans()
            self.assertEqual(len(fallback), 1)
            self.assertIsNone(fallback[0].details)

    def test_session_id_is_read_from_plugin_payloads(self) -> None:
        reader = AgentHookEventReader(event_path=Path("/nonexistent"), claude_sessions_dir=None, claude_projects_dir=None, opencode_db_path=None)
        self.assertEqual(reader._session_id({"sessionID": "a"}), "a")
        self.assertEqual(reader._session_id({"event": {"type": "session.idle", "properties": {"sessionID": "b"}}}), "b")
        self.assertEqual(reader._session_id({"event": {"type": "session.created", "properties": {"info": {"id": "c"}}}}), "c")
        # A message's info.id is not a session id.
        self.assertIsNone(reader._session_id({"event": {"type": "message.updated", "properties": {"info": {"id": "msg"}}}}))


class PluginTest(unittest.TestCase):
    def test_plugin_records_session_id_and_agent_pid_and_is_versioned(self) -> None:
        plugin = agent_hooks.OPENCODE_PLUGIN
        self.assertIn("sessionID: input.sessionID", plugin)
        self.assertIn("agent_pid: process.pid", plugin)
        self.assertIn(agent_hooks.OPENCODE_PLUGIN_MARKER, plugin)

    @unittest.skipUnless(shutil.which("node"), "node is needed to syntax-check the plugin")
    def test_plugin_is_valid_javascript(self) -> None:
        # The template is a Python f-string: an unescaped "\\n" would become a real
        # line break inside a JS string literal and the plugin would never load.
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "git-juggler.mjs"
            path.write_text(agent_hooks.OPENCODE_PLUGIN, encoding="utf-8")
            result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_old_plugin_counts_as_not_installed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "git-juggler.js"
            with patch.object(agent_hooks, "OPENCODE_PLUGIN_PATH", path):
                path.write_text("export const GitJugglerPlugin = async () => ({})", encoding="utf-8")
                self.assertFalse(agent_hooks.opencode_status().installed)
                agent_hooks.install_opencode_hooks()
                self.assertTrue(agent_hooks.opencode_status().installed)


if __name__ == "__main__":
    unittest.main()

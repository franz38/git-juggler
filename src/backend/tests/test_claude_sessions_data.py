from __future__ import annotations

import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler.agents.hook_events import AgentHookEventReader
from git_juggler.agents.tracking import claude_transcripts
from git_juggler.agents.tracking.claude_transcripts import find_transcript, read_transcript_info
from git_juggler.agents.tracking.git_resolver import GitResolver
from hook_event_files import write_session_files


def _lines(*records: dict) -> str:
    return "".join(json.dumps(record) + "\n" for record in records)


class TranscriptInfoTest(unittest.TestCase):
    def test_extracts_newest_values_and_truncates_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "s.jsonl"
            path.write_text(
                _lines(
                    {"type": "ai-title", "aiTitle": "old title"},
                    {"type": "permission-mode", "permissionMode": "normal"},
                    {"type": "assistant", "message": {"model": "model-a"}},
                    {"type": "worktree-state", "worktreeSession": {"worktreePath": "/w/wt", "worktreeName": "wt", "worktreeBranch": "feat"}},
                    {"type": "ai-title", "aiTitle": "new title"},
                    {"type": "permission-mode", "permissionMode": "auto"},
                    {"type": "assistant", "message": {"model": "model-b"}},
                    {"type": "last-prompt", "lastPrompt": "hello\n   world " + "x" * 2000},
                ),
                encoding="utf-8",
            )

            info = read_transcript_info(path)

            self.assertEqual((info.title, info.permission_mode, info.model), ("new title", "auto", "model-b"))
            self.assertEqual((info.worktree_path, info.worktree_name, info.worktree_branch), ("/w/wt", "wt", "feat"))
            self.assertTrue(info.last_prompt.startswith("hello world x"))
            self.assertEqual(len(info.last_prompt), claude_transcripts.LAST_PROMPT_MAX_CHARS)
            self.assertTrue(info.last_prompt.endswith("…"))

    def test_reads_only_head_and_tail_of_a_huge_file_and_survives_cut_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "big.jsonl"
            filler = _lines({"type": "user", "message": {"content": "y" * 1000}}) * 3000  # ~3 MB
            path.write_text(
                _lines({"type": "worktree-state", "worktreeSession": {"worktreePath": "/w/head"}}) + filler + _lines({"type": "ai-title", "aiTitle": "tail title"}),
                encoding="utf-8",
            )

            info = read_transcript_info(path)

            self.assertEqual(info.title, "tail title")
            self.assertEqual(info.worktree_path, "/w/head")

    def test_worktree_exit_record_clears_worktree_and_bad_lines_are_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "s.jsonl"
            path.write_text(
                _lines({"type": "worktree-state", "worktreeSession": {"worktreePath": "/w/wt"}}) + "not json\n" + _lines({"type": "worktree-state", "worktreeSession": None}),
                encoding="utf-8",
            )
            self.assertIsNone(read_transcript_info(path).worktree_path)

    def test_find_transcript_searches_every_project_folder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            projects = Path(directory)
            (projects / "-a-b").mkdir()
            (projects / "-c-d").mkdir()
            target = projects / "-c-d" / "abc.jsonl"
            target.write_text("{}\n", encoding="utf-8")

            self.assertEqual(find_transcript(projects, "abc"), target)
            self.assertIsNone(find_transcript(projects, "missing"))
            self.assertIsNone(find_transcript(None, "abc"))


class SessionDetailsTest(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> None:
        subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)

    def test_details_from_card_and_transcript_and_home_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, worktree = root / "repo", root / "repo-wt"
            repo.mkdir()
            for args in (("init",), ("config", "user.name", "T"), ("config", "user.email", "t@e.c")):
                self._git(repo, *args)
            (repo / "a.txt").write_text("x\n", encoding="utf-8")
            self._git(repo, "add", "a.txt")
            self._git(repo, "commit", "-m", "i")
            self._git(repo, "worktree", "add", "-b", "feature", str(worktree))

            sessions, projects = root / "sessions", root / "projects"
            (projects / "-proj").mkdir(parents=True)
            sessions.mkdir()
            (sessions / "111.json").write_text(
                json.dumps({"pid": 111, "sessionId": "sid", "status": "idle", "kind": "bg", "name": "n", "version": "9.9", "entrypoint": "cli", "startedAt": 1000, "statusUpdatedAt": 2000}),
                encoding="utf-8",
            )
            (projects / "-proj" / "sid.jsonl").write_text(
                _lines({"type": "ai-title", "aiTitle": "T"}, {"type": "worktree-state", "worktreeSession": {"worktreePath": str(worktree), "worktreeName": "repo-wt", "worktreeBranch": "feature"}}),
                encoding="utf-8",
            )
            now = int(time.time() * 1000)
            events_dir = root / "agent-sessions"
            write_session_files(
                events_dir,
                [
                    {"provider": "claude", "phase": "SessionStart", "cwd": str(repo), "timestamp": now, "raw": {"session_id": "sid"}},
                    {"provider": "claude", "phase": "SessionStart", "cwd": str(worktree), "timestamp": now, "raw": {"session_id": "sid"}},
                ],
            )
            reader = AgentHookEventReader(sessions_dir=events_dir, claude_sessions_dir=sessions, claude_projects_dir=projects, opencode_db_path=None)

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                scan = reader.recent_scans()[0]

            details = scan.details
            assert details is not None
            self.assertEqual((details.started_at, details.status_updated_at, details.version, details.kind, details.entrypoint), (1000, 2000, "9.9", "bg", "cli"))
            self.assertEqual((details.title, details.worktree_name, details.worktree_branch), ("T", "repo-wt", "feature"))
            self.assertEqual({Path(w.worktree_path).name: w.is_home for w in scan.worktrees}, {"repo": False, "repo-wt": True})

            # A new turn (transcript grows) is picked up on the next poll.
            with (projects / "-proj" / "sid.jsonl").open("a", encoding="utf-8") as file:
                file.write(_lines({"type": "ai-title", "aiTitle": "T2"}))
            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                self.assertEqual(reader.recent_scans()[0].details.title, "T2")


class IdleSessionHeadPinningTest(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

    def _repo(self, path: Path) -> str:
        path.mkdir()
        for args in (("init",), ("config", "user.name", "T"), ("config", "user.email", "t@e.c")):
            self._git(path, *args)
        (path / "a.txt").write_text("x\n", encoding="utf-8")
        self._git(path, "add", "a.txt")
        self._git(path, "commit", "-m", "i")
        return self._git(path, "rev-parse", "HEAD")

    def _commit(self, path: Path, text: str, message: str) -> str:
        (path / "a.txt").write_text(text, encoding="utf-8")
        self._git(path, "commit", "-am", message)
        return self._git(path, "rev-parse", "HEAD")

    def _card(self, sessions: Path, status: str) -> None:
        sessions.mkdir(exist_ok=True)
        (sessions / "111.json").write_text(
            json.dumps(
                {
                    "pid": 111,
                    "sessionId": "sid",
                    "status": status,
                    "statusUpdatedAt": 2000,
                }
            ),
            encoding="utf-8",
        )

    def test_idle_session_stays_on_last_active_commit_until_active_again(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            first_commit = self._repo(repo)
            sessions = root / "sessions"
            events_dir = root / "agent-sessions"
            resolver_time = [0.0]
            write_session_files(
                events_dir,
                [
                    {
                        "provider": "claude",
                        "phase": "SessionStart",
                        "cwd": str(repo),
                        "timestamp": 1000,
                        "raw": {"session_id": "sid"},
                    }
                ],
            )
            reader = AgentHookEventReader(
                sessions_dir=events_dir,
                git_resolver=GitResolver(clock=lambda: resolver_time[0]),
                claude_sessions_dir=sessions,
                claude_projects_dir=None,
                opencode_db_path=None,
                ttl_ms=1000,
            )

            with patch("git_juggler.agents.hook_events._pid_alive", return_value=True):
                self._card(sessions, "busy")
                active = reader.recent_scans(now=1500)[0].worktrees[0]
                self.assertEqual((active.state, active.commit), ("active", first_commit))

                second_commit = self._commit(repo, "y\n", "second")
                resolver_time[0] = 1.0
                self._card(sessions, "idle")
                idle = reader.recent_scans(now=2500)[0].worktrees[0]
                self.assertEqual((idle.state, idle.commit), ("idle", first_commit))
                self.assertNotEqual(idle.commit, second_commit)

                resolver_time[0] = 2.0
                self._card(sessions, "busy")
                active_again = reader.recent_scans(now=3500)[0].worktrees[0]
                self.assertEqual((active_again.state, active_again.commit), ("active", second_commit))


if __name__ == "__main__":
    unittest.main()

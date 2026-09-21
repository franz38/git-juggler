from __future__ import annotations

import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler.agent_hook_events import AgentHookEventReader
from git_juggler.agent_tracking import claude_transcripts
from git_juggler.agent_tracking.claude_transcripts import find_transcript, read_transcript_info


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
            events = root / "events.jsonl"
            events.write_text(
                _lines(
                    {"provider": "claude", "phase": "SessionStart", "cwd": str(repo), "pid": 1, "timestamp": now, "raw": {"session_id": "sid"}},
                    {"provider": "claude", "phase": "SessionStart", "cwd": str(worktree), "pid": 1, "timestamp": now, "raw": {"session_id": "sid"}},
                ),
                encoding="utf-8",
            )
            reader = AgentHookEventReader(event_path=events, claude_sessions_dir=sessions, claude_projects_dir=projects)

            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                scan = reader.recent_scans()[0]

            details = scan.details
            assert details is not None
            self.assertEqual((details.started_at, details.status_updated_at, details.version, details.kind, details.entrypoint), (1000, 2000, "9.9", "bg", "cli"))
            self.assertEqual((details.title, details.worktree_name, details.worktree_branch), ("T", "repo-wt", "feature"))
            self.assertEqual({Path(w.worktree_path).name: w.is_home for w in scan.worktrees}, {"repo": False, "repo-wt": True})

            # A new turn (transcript grows) is picked up on the next poll.
            with (projects / "-proj" / "sid.jsonl").open("a", encoding="utf-8") as file:
                file.write(_lines({"type": "ai-title", "aiTitle": "T2"}))
            with patch("git_juggler.agent_hook_events._pid_alive", return_value=True):
                self.assertEqual(reader.recent_scans()[0].details.title, "T2")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .text import LAST_PROMPT_MAX_CHARS, shorten_prompt


CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

TAIL_BYTES = 512 * 1024
HEAD_BYTES = 64 * 1024


@dataclass(frozen=True)
class TranscriptInfo:
    title: str | None = None
    model: str | None = None
    permission_mode: str | None = None
    last_prompt: str | None = None
    worktree_path: str | None = None
    worktree_name: str | None = None
    worktree_branch: str | None = None


def find_transcript(projects_dir: Path | None, session_id: str) -> Path | None:
    """`projects/<encoded-cwd>/<sessionId>.jsonl`. The folder is derived from
    the session's starting cwd but can differ (relocated sessions), so search
    every project folder instead of re-deriving the name."""
    if projects_dir is None:
        return None
    try:
        with os.scandir(projects_dir) as entries:
            for entry in entries:
                candidate = Path(entry.path) / f"{session_id}.jsonl"
                if entry.is_dir() and candidate.is_file():
                    return candidate
    except OSError:
        return None
    return None


def transcript_signature(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _read_chunk(path: Path, tail: bool, size: int) -> list[str]:
    try:
        with path.open("rb") as file:
            length = os.fstat(file.fileno()).st_size
            if tail:
                offset = max(0, length - size)
                file.seek(offset)
                lines = file.read(size).decode("utf-8", errors="replace").splitlines()
                return lines[1:] if offset > 0 else lines  # first line may be cut mid-record
            lines = file.read(size).decode("utf-8", errors="replace").splitlines()
            return lines[:-1] if length > size else lines  # last line may be cut
    except OSError:
        return []


def read_transcript_info(path: Path) -> TranscriptInfo:
    """Newest-wins summary of a session transcript.

    Transcripts reach tens of MB, so only the head and tail are read. Title,
    model, mode and last prompt are re-written throughout a session, so the
    tail has them; the worktree record is written near the start, so the head
    is scanned too (tail last, so newer records win)."""
    title = model = permission_mode = last_prompt = None
    worktree: dict | None = None
    for line in _read_chunk(path, tail=False, size=HEAD_BYTES) + _read_chunk(path, tail=True, size=TAIL_BYTES):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        kind = record.get("type")
        if kind == "ai-title" and isinstance(record.get("aiTitle"), str):
            title = record["aiTitle"]
        elif kind == "permission-mode" and isinstance(record.get("permissionMode"), str):
            permission_mode = record["permissionMode"]
        elif kind == "last-prompt" and isinstance(record.get("lastPrompt"), str):
            last_prompt = shorten_prompt(record["lastPrompt"])
        elif kind == "worktree-state":
            state = record.get("worktreeSession")
            worktree = state if isinstance(state, dict) else None
        elif kind == "assistant":
            message = record.get("message")
            if isinstance(message, dict) and isinstance(message.get("model"), str):
                model = message["model"]

    def text(key: str) -> str | None:
        value = worktree.get(key) if worktree else None
        return value if isinstance(value, str) else None

    return TranscriptInfo(
        title=title,
        model=model,
        permission_mode=permission_mode,
        last_prompt=last_prompt,
        worktree_path=text("worktreePath"),
        worktree_name=text("worktreeName"),
        worktree_branch=text("worktreeBranch"),
    )

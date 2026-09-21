from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


CLAUDE_SESSIONS_DIR = Path.home() / ".claude" / "sessions"


@dataclass(frozen=True)
class ClaudeSession:
    session_id: str
    pid: int
    status: str | None
    kind: str | None
    name: str | None
    cwd: str | None


def registry_signature(directory: Path | None) -> tuple[tuple[str, int], ...] | None:
    """Cheap change marker for the registry (file names + mtimes).

    None means there is no registry (directory missing or disabled), which
    callers treat differently from an empty one."""
    if directory is None:
        return None
    try:
        with os.scandir(directory) as entries:
            return tuple(sorted((entry.name, entry.stat().st_mtime_ns) for entry in entries if entry.name.endswith(".json")))
    except OSError:
        return None


def read_registry(directory: Path | None) -> dict[str, ClaudeSession] | None:
    """Claude Code writes one `<pid>.json` per running process into
    ~/.claude/sessions and removes it on exit. Keyed here by session id.
    Only the .json cards are read (never the sibling .key files)."""
    if directory is None:
        return None
    try:
        names = [entry for entry in os.listdir(directory) if entry.endswith(".json")]
    except OSError:
        return None
    sessions: dict[str, ClaudeSession] = {}
    for name in names:
        try:
            data = json.loads((directory / name).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        session_id, pid = data.get("sessionId"), data.get("pid")
        if not isinstance(session_id, str) or not isinstance(pid, int):
            continue
        sessions[session_id] = ClaudeSession(
            session_id=session_id,
            pid=pid,
            status=data.get("status") if isinstance(data.get("status"), str) else None,
            kind=data.get("kind") if isinstance(data.get("kind"), str) else None,
            name=data.get("name") if isinstance(data.get("name"), str) else None,
            cwd=data.get("cwd") if isinstance(data.get("cwd"), str) else None,
        )
    return sessions

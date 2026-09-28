from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from .text import shorten_prompt


OPENCODE_DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"

# An assistant turn with no completion time is "busy", unless nothing has been
# written for this long (an interrupted or crashed turn never completes).
BUSY_STALE_MS = 120_000


@dataclass(frozen=True)
class OpenCodeSession:
    session_id: str
    title: str | None
    directory: str | None
    version: str | None
    agent: str | None
    model: str | None
    time_created: int | None
    time_updated: int | None
    archived: bool
    parent_id: str | None
    busy: bool
    last_prompt: str | None

    @property
    def is_child(self) -> bool:
        return self.parent_id is not None


def db_signature(path: Path | None) -> tuple | None:
    """Change marker for the DB (OpenCode uses WAL, so the -wal file moves first).
    None means there is no DB (missing or disabled)."""
    if path is None:
        return None
    parts = []
    for candidate in (path, path.with_name(path.name + "-wal")):
        try:
            stat = candidate.stat()
        except OSError:
            if candidate == path:
                return None
            parts.append(None)
            continue
        parts.append((stat.st_mtime_ns, stat.st_size))
    return tuple(parts)


def _model_name(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if isinstance(data, dict):
        value = data.get("id") or data.get("modelID")
        return value if isinstance(value, str) else None
    return raw


def read_session(path: Path | None, session_id: str, now_ms: int | None = None) -> OpenCodeSession | None:
    """Read one session by id from OpenCode's SQLite DB.

    Read-only (`mode=ro`), only indexed per-session lookups, and every failure
    (missing DB, locked, schema change) yields None so callers fall back to
    hooks-only behaviour. Never touches auth.json or any other file."""
    if path is None:
        return None
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=0.5)
    except sqlite3.Error:
        return None
    try:
        row = connection.execute(
            "select title, directory, version, agent, model, time_created, time_updated, time_archived, parent_id from session where id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        title, directory, version, agent, model, time_created, time_updated, time_archived, parent_id = row

        latest_assistant = connection.execute(
            "select json_extract(data, '$.time.completed'), time_updated from message"
            " where session_id = ? and json_extract(data, '$.role') = 'assistant' order by time_created desc limit 1",
            (session_id,),
        ).fetchone()
        busy = False
        if latest_assistant is not None and latest_assistant[0] is None:
            last_write = max((value for value in (latest_assistant[1], time_updated) if isinstance(value, int)), default=0)
            busy = now - last_write <= BUSY_STALE_MS

        last_prompt = None
        user_message = connection.execute(
            "select id from message where session_id = ? and json_extract(data, '$.role') = 'user' order by time_created desc limit 1",
            (session_id,),
        ).fetchone()
        if user_message is not None:
            texts = connection.execute(
                "select json_extract(data, '$.text') from part where message_id = ? and json_extract(data, '$.type') = 'text' order by time_created",
                (user_message[0],),
            ).fetchall()
            last_prompt = shorten_prompt(" ".join(text for (text,) in texts if isinstance(text, str)))

        return OpenCodeSession(
            session_id=session_id,
            title=title if isinstance(title, str) else None,
            directory=directory if isinstance(directory, str) else None,
            version=version if isinstance(version, str) else None,
            agent=agent if isinstance(agent, str) else None,
            model=_model_name(model),
            time_created=time_created if isinstance(time_created, int) else None,
            time_updated=time_updated if isinstance(time_updated, int) else None,
            archived=time_archived is not None,
            parent_id=parent_id if isinstance(parent_id, str) else None,
            busy=busy,
            last_prompt=last_prompt,
        )
    except sqlite3.Error:
        return None
    finally:
        connection.close()

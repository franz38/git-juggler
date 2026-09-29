from __future__ import annotations

import json
from pathlib import Path


def _session_name(event: dict) -> str:
    raw = event.get("raw") or {}
    properties = (raw.get("event") or {}).get("properties") or {}
    session = raw.get("session_id") or raw.get("sessionID") or properties.get("sessionID") or (properties.get("info") or {}).get("id")
    return f"{event['provider']}-{session or 'pid-' + str(event.get('agent_pid') or event.get('pid'))}"


def write_session_files(directory: Path, events: list[dict]) -> None:
    """Replaces `directory`'s contents with `events` laid out the way the hooks
    write them: one file per session, events in order."""
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("*.jsonl"):
        old.unlink()
    by_session: dict[str, list[dict]] = {}
    for event in events:
        by_session.setdefault(_session_name(event), []).append(event)
    for name, session_events in by_session.items():
        (directory / f"{name}.jsonl").write_text("".join(json.dumps(event) + "\n" for event in session_events), encoding="utf-8")

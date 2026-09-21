from __future__ import annotations

import hashlib
import json
import re
import os
import shlex
import sys
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .agent_hooks import EVENT_PATH
from .agent_tracking.activity_models import ActivityEvidence, AgentRepositoryScan, AgentWorktreeActivity, SessionDetails
from .agent_tracking.claude_sessions import CLAUDE_SESSIONS_DIR, ClaudeSession, read_registry, registry_signature
from .agent_tracking.claude_transcripts import CLAUDE_PROJECTS_DIR, TranscriptInfo, find_transcript, read_transcript_info, transcript_signature
from .agent_tracking.git_resolver import GitResolver, GitWorktreeInfo
from .agent_tracking.opencode_sessions import OPENCODE_DB_PATH, OpenCodeSession, db_signature, read_session


HOOK_ACTIVITY_TTL_MS = 120_000
HOOK_EVENT_LIMIT = 5000
SESSION_EVENT_LIMIT = 300
IDLE_SESSION_MAX_MS = 24 * 60 * 60 * 1000
END_PHASES = {"sessionend", "session.deleted"}
HOOK_SCORE = 30


@dataclass(frozen=True)
class HookEvent:
    provider: str
    phase: str
    session_id: str | None
    cwd: str | None
    pid: int | None
    agent_pid: int | None
    timestamp: int
    raw: dict[str, Any]


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        # os.kill(pid, 0) would terminate the process there.
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    return True


class AgentHookEventReader:
    def __init__(self, event_path: Path = EVENT_PATH, git_resolver: GitResolver | None = None, ttl_ms: int = HOOK_ACTIVITY_TTL_MS, claude_sessions_dir: Path | None = CLAUDE_SESSIONS_DIR, claude_projects_dir: Path | None = CLAUDE_PROJECTS_DIR, opencode_db_path: Path | None = OPENCODE_DB_PATH) -> None:
        self.event_path = event_path
        # None disables the Claude session registry (hooks-only behaviour).
        self.claude_sessions_dir = claude_sessions_dir
        self.claude_projects_dir = claude_projects_dir
        self.opencode_db_path = opencode_db_path
        self._opencode_cache: dict[str, tuple[tuple, OpenCodeSession | None]] = {}
        self._transcript_paths: dict[str, Path] = {}
        self._transcript_cache: dict[Path, tuple[tuple[int, int], TranscriptInfo]] = {}
        self.git_resolver = git_resolver or GitResolver()
        self.ttl_ms = ttl_ms
        self._lock = threading.Lock()
        self._cached_signature: tuple | None = None
        self._cached_scans: list[AgentRepositoryScan] = []
        self._cached_valid_until = 0

    def recent_scans(self, now: int | None = None) -> list[AgentRepositoryScan]:
        """One scan per open agent session.

        A worktree is "active" while its latest event is within the TTL and
        "idle" afterwards; the session disappears on its end hook (or when
        its process is gone). For OpenCode, its database supplies the row (a
        missing or archived one means closed), busy/idle and the details. For Claude, ~/.claude/sessions is authoritative
        when present: a session with no card there is closed, the card's pid
        is the real process, and its busy/idle status overrides the timer.

        The endpoint is polled every second, so the result is reused while the
        events file and the registry are unchanged and nothing could have aged
        out or moved branch/commit (git resolver TTL). An explicit `now`
        always recomputes.
        """
        observed_at = now or int(time.time() * 1000)
        signature = (self._file_signature(), registry_signature(self.claude_sessions_dir), self._transcripts_signature(), db_signature(self.opencode_db_path))
        with self._lock:
            if now is None and signature == self._cached_signature and observed_at < self._cached_valid_until:
                return [replace(scan, scanned_at=observed_at) for scan in self._cached_scans]
            scans, next_change = self._compute_scans(observed_at)
            resolver_ttl_ms = int(self.git_resolver.ttl_seconds * 1000)
            self._cached_signature = signature
            self._cached_scans = scans
            self._cached_valid_until = min(observed_at + resolver_ttl_ms, next_change) if next_change is not None else observed_at + resolver_ttl_ms
            return list(scans)

    def _transcripts_signature(self) -> tuple:
        return tuple(sorted((str(path), transcript_signature(path)) for path in self._transcript_paths.values()))

    def _transcript_info(self, session_id: str) -> TranscriptInfo | None:
        path = self._transcript_paths.get(session_id)
        if path is None or not path.exists():
            path = find_transcript(self.claude_projects_dir, session_id)
            if path is None:
                self._transcript_paths.pop(session_id, None)
                return None
            self._transcript_paths[session_id] = path
        signature = transcript_signature(path)
        if signature is None:
            return None
        cached = self._transcript_cache.get(path)
        if cached is None or cached[0] != signature:
            cached = (signature, read_transcript_info(path))
            self._transcript_cache[path] = cached
        return cached[1]

    def _file_signature(self) -> tuple[int, int] | None:
        try:
            stat = self.event_path.stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _compute_scans(self, observed_at: int) -> tuple[list[AgentRepositoryScan], int | None]:
        """Returns the scans plus the time the next active->idle flip happens."""
        sessions: dict[tuple[str, str], list[HookEvent]] = {}
        for event in self._read_events():
            if observed_at - event.timestamp <= IDLE_SESSION_MAX_MS:
                sessions.setdefault(self._session_key(event), []).append(event)

        registry = read_registry(self.claude_sessions_dir)
        opencode_signature = db_signature(self.opencode_db_path)
        scans: list[AgentRepositoryScan] = []
        next_change: int | None = None
        for session_key, session_events in sessions.items():
            # A session is open until its end hook fires (or its process dies),
            # however long it has been quiet.
            if session_events[-1].phase.lower() in END_PHASES:
                continue
            provider = session_key[0]
            session_id = session_events[-1].session_id
            card: ClaudeSession | None = None
            opencode_session: OpenCodeSession | None = None
            busy: bool | None = None  # what the agent itself reports, when it does
            if provider == "claude" and registry is not None and session_id:
                card = registry.get(session_id)
                if card is None or not _pid_alive(card.pid):
                    continue
                process_pid: int | None = card.pid
                busy = card.status == "busy" if card.status in ("busy", "idle") else None
            else:
                process_pid = next((event.agent_pid for event in reversed(session_events) if event.agent_pid is not None), None)
                if process_pid is not None and not _pid_alive(process_pid):
                    continue
                if provider == "opencode" and opencode_signature is not None:
                    if not session_id:
                        continue  # the plugin's start event: an instance, not yet a session
                    opencode_session = self._opencode_session(session_id, opencode_signature)
                    # Deleted, archived, or a sub-agent's session (its parent is what the user sees).
                    if opencode_session is None or opencode_session.archived or opencode_session.is_child:
                        continue
                    busy = opencode_session.busy

            activities: dict[str, AgentWorktreeActivity] = {}
            for event in session_events[-SESSION_EVENT_LIMIT:]:
                for path in self._candidate_paths(event):
                    worktree = self.git_resolver.resolve_path(path)
                    if worktree is None:
                        continue
                    activity = activities.get(worktree.worktree_path)
                    if activity is None:
                        activity = self._new_activity(worktree, event.timestamp)
                        activities[worktree.worktree_path] = activity
                    if event.pid is not None and event.pid not in activity.process_ids:
                        activity.process_ids.append(event.pid)
                    activity.last_seen = max(activity.last_seen, event.timestamp)
                    activity.last_activity = max(activity.last_activity, event.timestamp)
                    activity.activity_score += HOOK_SCORE
                    activity.evidence.append(
                        ActivityEvidence(
                            type=f"hook-{event.phase.lower()}",
                            pid=event.pid,
                            cwd=event.cwd,
                            path=str(path),
                            command=self._command(event),
                            process_role="hook",
                            tool=self._tool(event),
                            score=HOOK_SCORE,
                        )
                    )
            if not activities:
                continue

            for activity in activities.values():
                if observed_at - activity.last_activity <= self.ttl_ms:
                    activity.state = "active"
                    flip_at = activity.last_activity + self.ttl_ms + 1
                    next_change = flip_at if next_change is None else min(next_change, flip_at)
                else:
                    activity.state = "idle"
            if busy is False:
                for activity in activities.values():
                    activity.state = "idle"
            elif busy is True:
                # Working right now: the most recently touched worktree is where.
                max(activities.values(), key=lambda item: item.last_activity).state = "active"
            details: SessionDetails | None = None
            if card is not None and session_id:
                details = self._session_details(card, session_id)
            elif opencode_session is not None:
                details = self._opencode_details(opencode_session)
            if details is not None and details.worktree_path:
                # The worktree the session itself declares (Claude's worktree-state record).
                declared = self.git_resolver.resolve_path(details.worktree_path)
                for activity in activities.values():
                    activity.is_home = declared is not None and activity.worktree_path == declared.worktree_path
            scans.append(
                AgentRepositoryScan(
                    agent_pid=self._synthetic_pid(session_key),
                    session_directory=session_events[0].cwd,
                    worktrees=sorted(activities.values(), key=lambda item: item.worktree_path),
                    scanned_at=observed_at,
                    state="active" if any(item.state == "active" for item in activities.values()) else "idle",
                    provider=provider,
                    session_id=session_id,
                    process_pid=process_pid,
                    name=card.name if card is not None else (opencode_session.title if opencode_session is not None else None),
                    details=details,
                )
            )
        return scans, next_change

    def _agent_pid(self, data: dict[str, Any]) -> int | None:
        # The OpenCode plugin runs inside the agent process, so its pid is the agent's.
        pid = data.get("pid")
        return pid if data.get("provider") == "opencode" and isinstance(pid, int) else None

    def _session_details(self, card: ClaudeSession, session_id: str) -> SessionDetails:
        transcript = self._transcript_info(session_id) or TranscriptInfo()
        return SessionDetails(
            started_at=card.started_at,
            status_updated_at=card.status_updated_at,
            version=card.version,
            kind=card.kind,
            entrypoint=card.entrypoint,
            title=transcript.title,
            model=transcript.model,
            permission_mode=transcript.permission_mode,
            last_prompt=transcript.last_prompt,
            worktree_path=transcript.worktree_path,
            worktree_name=transcript.worktree_name,
            worktree_branch=transcript.worktree_branch,
        )

    def _opencode_session(self, session_id: str, signature: tuple) -> OpenCodeSession | None:
        cached = self._opencode_cache.get(session_id)
        if cached is None or cached[0] != signature:
            cached = (signature, read_session(self.opencode_db_path, session_id))
            self._opencode_cache[session_id] = cached
        return cached[1]

    def _opencode_details(self, session: OpenCodeSession) -> SessionDetails:
        return SessionDetails(
            started_at=session.time_created,
            status_updated_at=session.time_updated,
            version=session.version,
            title=session.title,
            model=session.model,
            agent=session.agent,
            last_prompt=session.last_prompt,
            # The directory the session runs in; its worktree becomes the "home" one.
            worktree_path=session.directory,
            worktree_name=Path(session.directory).name if session.directory else None,
        )

    def _session_key(self, event: HookEvent) -> tuple[str, str]:
        if event.session_id:
            return (event.provider, event.session_id)
        if event.agent_pid is not None:
            return (event.provider, f"pid:{event.agent_pid}")
        return (event.provider, f"cwd:{event.cwd or 'unknown'}")

    def _read_events(self) -> list[HookEvent]:
        if not self.event_path.exists():
            return []
        try:
            lines = self.event_path.read_text(encoding="utf-8", errors="replace").splitlines()[-HOOK_EVENT_LIMIT:]
        except OSError:
            return []
        events: list[HookEvent] = []
        for line in lines:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(data, dict):
                continue
            raw = data.get("raw") if isinstance(data.get("raw"), dict) else {}
            timestamp = data.get("timestamp")
            if not isinstance(timestamp, int):
                continue
            events.append(
                HookEvent(
                    provider=str(data.get("provider") or "unknown"),
                    phase=str(data.get("phase") or "unknown"),
                    session_id=self._session_id(raw),
                    cwd=data.get("cwd") if isinstance(data.get("cwd"), str) else self._raw_string(raw, "cwd"),
                    pid=data.get("pid") if isinstance(data.get("pid"), int) else None,
                    agent_pid=self._agent_pid(data),
                    timestamp=timestamp,
                    raw=raw,
                )
            )
        return events

    def _candidate_paths(self, event: HookEvent) -> list[Path]:
        paths: list[Path] = []
        for raw_path in self._raw_paths(event.raw):
            paths.append(self._resolve_path(raw_path, event.cwd))
        command = self._command(event)
        if command:
            paths.extend(self._paths_from_command(command, event.cwd))
        if event.cwd and (not paths or event.phase.lower() == "sessionstart"):
            paths.append(Path(event.cwd).expanduser())
        unique: list[Path] = []
        seen: set[str] = set()
        for path in paths:
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if not resolved.exists():
                continue
            key = str(resolved)
            if key in seen:
                continue
            seen.add(key)
            unique.append(resolved)
        return unique

    def _paths_from_command(self, command: str, cwd: str | None) -> list[Path]:
        paths: list[Path] = []
        try:
            args = shlex.split(command)
        except ValueError:
            args = []
        for index, arg in enumerate(args[:-1]):
            if arg in {"cd", "-C", "--prefix"}:
                paths.append(self._resolve_path(args[index + 1], cwd))
        for match in re.finditer(r"(?:^|\s)(/[^\s;&|]+)", command):
            paths.append(Path(match.group(1)).expanduser())
        return paths

    def _resolve_path(self, raw_path: str, cwd: str | None) -> Path:
        path = Path(raw_path).expanduser()
        if not path.is_absolute() and cwd:
            path = Path(cwd).expanduser() / path
        return path

    def _raw_paths(self, raw: dict[str, Any]) -> list[str]:
        paths: list[str] = []

        def visit(value: Any, key: str = "") -> None:
            if isinstance(value, dict):
                for child_key, child_value in value.items():
                    visit(child_value, str(child_key))
            elif isinstance(value, list):
                for child in value:
                    visit(child, key)
            elif isinstance(value, str) and key.lower() in {"path", "filepath", "file_path", "old_string", "new_string"}:
                if "/" in value or value.startswith("."):
                    paths.append(value)

        visit(raw)
        for key in ("worktree", "directory", "cwd"):
            value = raw.get(key)
            if isinstance(value, str):
                paths.append(value)
        return paths

    def _command(self, event: HookEvent) -> str | None:
        for container in (event.raw, event.raw.get("tool_input") if isinstance(event.raw.get("tool_input"), dict) else {}, event.raw.get("args") if isinstance(event.raw.get("args"), dict) else {}):
            command = container.get("command") if isinstance(container, dict) else None
            if isinstance(command, str):
                return command
        return None

    def _tool(self, event: HookEvent) -> str | None:
        for key in ("tool_name", "tool"):
            value = event.raw.get(key)
            if isinstance(value, str):
                return value
        return None

    def _session_id(self, raw: dict[str, Any]) -> str | None:
        for key in ("session_id", "sessionId", "sessionID"):
            value = raw.get(key)
            if isinstance(value, str):
                return value
        event = raw.get("event")
        if isinstance(event, dict):
            session = event.get("sessionID") or event.get("session_id") or event.get("sessionId")
            if isinstance(session, str):
                return session
            # OpenCode session.* events: {type, properties: {sessionID | info: {id}}}
            properties = event.get("properties")
            if isinstance(properties, dict):
                session = properties.get("sessionID")
                if not isinstance(session, str) and isinstance(event.get("type"), str) and event["type"].startswith("session."):
                    info = properties.get("info")
                    session = info.get("id") if isinstance(info, dict) else None
                if isinstance(session, str):
                    return session
        return None

    def _raw_string(self, raw: dict[str, Any], key: str) -> str | None:
        value = raw.get(key)
        return value if isinstance(value, str) else None

    def _new_activity(self, worktree: GitWorktreeInfo, observed_at: int) -> AgentWorktreeActivity:
        return AgentWorktreeActivity(
            repository_id=worktree.repository_id,
            worktree_path=worktree.worktree_path,
            branch=worktree.branch,
            commit=worktree.commit,
            process_ids=[],
            first_seen=observed_at,
            last_seen=observed_at,
            last_activity=observed_at,
        )

    def _synthetic_pid(self, session_key: tuple[str, str]) -> int:
        digest = hashlib.sha1(":".join(session_key).encode()).hexdigest()[:8]
        return -int(digest, 16)

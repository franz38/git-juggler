from __future__ import annotations

import hashlib
import json
import re
import shlex
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .agent_hooks import EVENT_PATH
from .agent_tracking.agent_repository_tracker import ActivityEvidence, AgentRepositoryScan, AgentWorktreeActivity
from .agent_tracking.git_resolver import GitResolver, GitWorktreeInfo


HOOK_ACTIVITY_TTL_MS = 120_000
HOOK_EVENT_LIMIT = 500
HOOK_SCORE = 30


@dataclass(frozen=True)
class HookEvent:
    provider: str
    phase: str
    session_id: str | None
    cwd: str | None
    pid: int | None
    timestamp: int
    raw: dict[str, Any]


class AgentHookEventReader:
    def __init__(self, event_path: Path = EVENT_PATH, git_resolver: GitResolver | None = None, ttl_ms: int = HOOK_ACTIVITY_TTL_MS) -> None:
        self.event_path = event_path
        self.git_resolver = git_resolver or GitResolver()
        self.ttl_ms = ttl_ms

    def recent_scans(self, now: int | None = None) -> list[AgentRepositoryScan]:
        observed_at = now or int(time.time() * 1000)
        self.git_resolver.clear_cache()
        events = [event for event in self._read_events() if observed_at - event.timestamp <= self.ttl_ms]
        by_session: dict[tuple[str, str], dict[str, AgentWorktreeActivity]] = {}
        session_dirs: dict[tuple[str, str], str | None] = {}
        pids: dict[tuple[str, str], int] = {}

        for event in events:
            session_key = (event.provider, event.session_id or f"pid:{event.pid or 'unknown'}")
            session_dirs.setdefault(session_key, event.cwd)
            pids[session_key] = self._synthetic_pid(session_key)
            for path in self._candidate_paths(event):
                worktree = self.git_resolver.resolve_path(path)
                if worktree is None:
                    continue
                activity = by_session.setdefault(session_key, {}).get(worktree.worktree_path)
                if activity is None:
                    activity = self._new_activity(worktree, event.timestamp)
                    by_session[session_key][worktree.worktree_path] = activity
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

        scans: list[AgentRepositoryScan] = []
        for session_key, activities in by_session.items():
            provider, session = session_key
            scans.append(
                AgentRepositoryScan(
                    agent_pid=pids[session_key],
                    session_directory=session_dirs.get(session_key),
                    processes=[],
                    worktrees=sorted(activities.values(), key=lambda item: item.worktree_path),
                    scanned_at=observed_at,
                )
            )
        return scans

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
        for key in ("session_id", "sessionId"):
            value = raw.get(key)
            if isinstance(value, str):
                return value
        event = raw.get("event")
        if isinstance(event, dict):
            session = event.get("sessionID") or event.get("session_id") or event.get("sessionId")
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

from __future__ import annotations

import time
from dataclasses import dataclass, field
from collections.abc import Sequence

from .agent_activity_adapter import AgentActivityAdapter
from .create_process_inspector import create_process_inspector
from .git_resolver import GitResolver, GitWorktreeInfo
from .process_info import ProcessInfo
from .process_inspector import ProcessInspector
from .worktree_evidence import WorktreeEvidence, command_path_evidence, cwd_evidence, file_access_evidence, session_directory_evidence


WORKTREE_ACTIVITY_TTL_MS = 30_000
MIN_ACTIVE_WORKTREE_SCORE = 3


@dataclass(frozen=True)
class ActivityEvidence:
    type: str
    pid: int | None = None
    cwd: str | None = None
    path: str | None = None
    executable: str | None = None
    command: str | None = None
    process_role: str | None = None
    tool: str | None = None
    score: int = 0


@dataclass
class AgentWorktreeActivity:
    repository_id: str
    worktree_path: str
    branch: str | None
    commit: str
    process_ids: list[int]
    first_seen: int
    last_seen: int
    last_activity: int
    evidence: list[ActivityEvidence] = field(default_factory=list)
    activity_score: int = 0


@dataclass(frozen=True)
class AgentRepositoryScan:
    agent_pid: int
    session_directory: str | None
    processes: list[ProcessInfo]
    worktrees: list[AgentWorktreeActivity]
    scanned_at: int


class AgentRepositoryTracker:
    def __init__(
        self,
        process_inspector: ProcessInspector | None = None,
        git_resolver: GitResolver | None = None,
        adapters: Sequence[AgentActivityAdapter] = (),
        worktree_activity_ttl_ms: int = WORKTREE_ACTIVITY_TTL_MS,
    ) -> None:
        self.process_inspector = process_inspector or create_process_inspector()
        self.git_resolver = git_resolver or GitResolver()
        self.adapters = tuple(adapters)
        self.worktree_activity_ttl_ms = worktree_activity_ttl_ms
        self._activities: dict[str, AgentWorktreeActivity] = {}
        self._scan_running = False

    def scan(self, agent_pid: int) -> AgentRepositoryScan:
        if self._scan_running:
            now = int(time.time() * 1000)
            return AgentRepositoryScan(agent_pid=agent_pid, session_directory=None, processes=[], worktrees=self._retained(now), scanned_at=now)

        self._scan_running = True
        try:
            return self._scan(agent_pid)
        finally:
            self._scan_running = False

    def _scan(self, agent_pid: int) -> AgentRepositoryScan:
        scanned_at = int(time.time() * 1000)
        self.git_resolver.clear_cache()

        root = self.process_inspector.get_process(agent_pid)
        descendants = self.process_inspector.get_descendants(agent_pid) if root is not None else []
        processes = ([root] if root is not None else []) + descendants
        child_depths = self._child_depths(agent_pid, descendants)
        session_directory = self._session_directory(root) if root is not None else None

        current = self._collect_current_activities(agent_pid, processes, child_depths, scanned_at)
        for key, activity in current.items():
            existing = self._activities.get(key)
            if existing is not None:
                activity.first_seen = existing.first_seen
            self._activities[key] = activity

        self._expire(scanned_at)
        return AgentRepositoryScan(
            agent_pid=agent_pid,
            session_directory=session_directory,
            processes=processes,
            worktrees=sorted(self._activities.values(), key=lambda item: item.worktree_path),
            scanned_at=scanned_at,
        )

    def _collect_current_activities(self, root_pid: int, processes: list[ProcessInfo], child_depths: dict[int, int], observed_at: int) -> dict[str, AgentWorktreeActivity]:
        activities: dict[str, AgentWorktreeActivity] = {}
        for process in processes:
            for evidence in self._path_evidence_for_process(process, root_pid, child_depths):
                worktree = self.git_resolver.resolve_path(evidence.path)
                if worktree is None:
                    continue
                activity = activities.get(worktree.worktree_path)
                if activity is None:
                    activity = self._new_activity(worktree, observed_at)
                    activities[worktree.worktree_path] = activity
                if process.pid not in activity.process_ids and evidence.pid is not None:
                    activity.process_ids.append(process.pid)
                self._add_evidence(activity, evidence)
                activity.last_seen = observed_at
                if evidence.score >= MIN_ACTIVE_WORKTREE_SCORE:
                    activity.last_activity = observed_at

        active = {key: activity for key, activity in activities.items() if activity.activity_score >= MIN_ACTIVE_WORKTREE_SCORE}
        for activity in active.values():
            activity.process_ids.sort()
        return active

    def _path_evidence_for_process(self, process: ProcessInfo, root_pid: int, child_depths: dict[int, int]) -> list[WorktreeEvidence]:
        evidence: list[WorktreeEvidence] = []
        command_evidence = command_path_evidence(process, root_pid, child_depths)
        file_evidence = file_access_evidence(process, root_pid, child_depths)
        if process.pid == root_pid:
            session_evidence = session_directory_evidence(process)
            if session_evidence is not None:
                evidence.append(session_evidence)
        process_cwd_evidence = cwd_evidence(process, root_pid, child_depths)
        if process_cwd_evidence is not None and not command_evidence:
            evidence.append(process_cwd_evidence)
        evidence.extend(command_evidence)
        evidence.extend(file_evidence)
        for adapter in self._supported_adapters(process):
            evidence.extend(adapter.get_activity_evidence(process))
        return evidence

    def _session_directory(self, process: ProcessInfo) -> str | None:
        for adapter in self._supported_adapters(process):
            session_directory = adapter.get_session_directory(process)
            if session_directory:
                return session_directory
        return process.cwd

    def _supported_adapters(self, process: ProcessInfo) -> list[AgentActivityAdapter]:
        return [adapter for adapter in self.adapters if adapter.supports(process)]

    def _child_depths(self, root_pid: int, descendants: list[ProcessInfo]) -> dict[int, int]:
        by_pid = {process.pid: process for process in descendants}
        depths: dict[int, int] = {}
        for process in descendants:
            depth = 1
            cursor = process
            seen: set[int] = set()
            while cursor.parent_pid is not None and cursor.parent_pid != root_pid and cursor.parent_pid in by_pid and cursor.parent_pid not in seen:
                seen.add(cursor.parent_pid)
                depth += 1
                cursor = by_pid[cursor.parent_pid]
            depths[process.pid] = depth
        return depths

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

    def _add_evidence(self, activity: AgentWorktreeActivity, evidence: WorktreeEvidence) -> None:
        activity.evidence.append(
            ActivityEvidence(
                type=evidence.type,
                pid=evidence.pid,
                cwd=evidence.path if evidence.type.endswith("cwd") else None,
                path=evidence.path,
                executable=evidence.executable,
                command=evidence.command,
                process_role=evidence.process_role,
                tool=evidence.tool,
                score=evidence.score,
            )
        )
        activity.activity_score += evidence.score

    def _expire(self, now: int) -> None:
        expired = [key for key, activity in self._activities.items() if now - activity.last_activity > self.worktree_activity_ttl_ms]
        for key in expired:
            del self._activities[key]

    def _retained(self, now: int) -> list[AgentWorktreeActivity]:
        self._expire(now)
        return sorted(self._activities.values(), key=lambda item: item.worktree_path)

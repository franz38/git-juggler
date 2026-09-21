from __future__ import annotations

from dataclasses import dataclass, field


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
    state: str = "active"


@dataclass(frozen=True)
class AgentRepositoryScan:
    agent_pid: int
    session_directory: str | None
    worktrees: list[AgentWorktreeActivity]
    scanned_at: int
    state: str = "active"
    provider: str = ""
    session_id: str | None = None
    process_pid: int | None = None
    name: str | None = None

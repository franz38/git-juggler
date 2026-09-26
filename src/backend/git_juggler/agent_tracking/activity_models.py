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
    is_home: bool = False


@dataclass(frozen=True)
class SessionDetails:
    started_at: int | None = None
    status_updated_at: int | None = None
    version: str | None = None
    kind: str | None = None
    entrypoint: str | None = None
    title: str | None = None
    model: str | None = None
    permission_mode: str | None = None
    agent: str | None = None
    last_prompt: str | None = None
    worktree_path: str | None = None
    worktree_name: str | None = None
    worktree_branch: str | None = None


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
    details: SessionDetails | None = None
    # What the agent is blocked on ("permission prompt", "input needed"), or None.
    waiting_for: str | None = None

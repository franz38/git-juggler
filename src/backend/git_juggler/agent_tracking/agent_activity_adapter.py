from __future__ import annotations

from typing import Protocol

from .process_info import ProcessInfo
from .worktree_evidence import WorktreeEvidence


class AgentActivityAdapter(Protocol):
    def supports(self, process: ProcessInfo) -> bool:
        ...

    def get_session_directory(self, process: ProcessInfo) -> str | None:
        ...

    def get_activity_evidence(self, process: ProcessInfo) -> list[WorktreeEvidence]:
        ...

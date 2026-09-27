from __future__ import annotations

from fastapi import APIRouter

from ..agent_hook_events import AgentHookEventReader
from ..agent_hooks import hooks_status, install_claude_hooks, install_opencode_hooks
from ..agent_tracking.activity_models import AgentRepositoryScan
from ..schemas import (
    AgentActivityResponse,
    AgentHookProviderStatusResponse,
    AgentHooksResponse,
    AgentRepositoryScanResponse,
)


router = APIRouter()
hook_event_reader = AgentHookEventReader()


def _agent_scan_response(scan: AgentRepositoryScan) -> AgentRepositoryScanResponse:
    return AgentRepositoryScanResponse(
        agent_pid=scan.agent_pid,
        session_directory=scan.session_directory,
        worktrees=[
            {
                "repository_id": activity.repository_id,
                "worktree_path": activity.worktree_path,
                "branch": activity.branch,
                "commit": activity.commit,
                "process_ids": activity.process_ids,
                "first_seen": activity.first_seen,
                "last_seen": activity.last_seen,
                "last_activity": activity.last_activity,
                "evidence": [evidence.__dict__ for evidence in activity.evidence],
                "activity_score": activity.activity_score,
                "state": activity.state,
                "is_home": activity.is_home,
            }
            for activity in scan.worktrees
        ],
        scanned_at=scan.scanned_at,
        state=scan.state,
        provider=scan.provider,
        session_id=scan.session_id,
        process_pid=scan.process_pid,
        name=scan.name,
        details=scan.details.__dict__ if scan.details is not None else None,
        waiting_for=scan.waiting_for,
    )


def _hook_status_response(status) -> AgentHookProviderStatusResponse:
    return AgentHookProviderStatusResponse(**status.__dict__)


@router.get("/api/agents/activity", response_model=AgentActivityResponse)
def api_agent_activity() -> AgentActivityResponse:
    hook_scans = hook_event_reader.recent_scans()
    scans = [_agent_scan_response(scan) for scan in hook_scans]
    scanned_at = max((scan.scanned_at for scan in scans), default=0)
    return AgentActivityResponse(
        agents=[
            {
                "pid": scan.agent_pid,
                "command_line": "hook activity",
                "matched_pattern": "hook",
            }
            for scan in hook_scans
        ],
        scans=scans,
        scanned_at=scanned_at,
    )


@router.get("/api/agents/hooks", response_model=AgentHooksResponse)
def api_agent_hooks() -> AgentHooksResponse:
    statuses = hooks_status()
    return AgentHooksResponse(
        claude=_hook_status_response(statuses["claude"]),
        opencode=_hook_status_response(statuses["opencode"]),
    )


@router.post(
    "/api/agents/hooks/claude/install",
    response_model=AgentHookProviderStatusResponse,
)
def api_install_claude_hooks() -> AgentHookProviderStatusResponse:
    return _hook_status_response(install_claude_hooks())


@router.post(
    "/api/agents/hooks/opencode/install",
    response_model=AgentHookProviderStatusResponse,
)
def api_install_opencode_hooks() -> AgentHookProviderStatusResponse:
    return _hook_status_response(install_opencode_hooks())

import type { AgentRepositoryScan } from "../../api/types";

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// When the session last did something: its most recent worktree activity (ms).
export function sessionLastActivity(scan: AgentRepositoryScan): number {
  return scan.worktrees.reduce((latest, worktree) => Math.max(latest, worktree.last_activity), 0);
}

// Active sessions first; then whoever has been idle for the least time
// (i.e. the most recent activity) comes first, for both groups.
export function compareSessions(a: AgentRepositoryScan, b: AgentRepositoryScan): number {
  if (a.state !== b.state) return a.state === "active" ? -1 : 1;
  return sessionLastActivity(b) - sessionLastActivity(a);
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

export function sessionTitle(scan: AgentRepositoryScan): string {
  return scan.details?.title ?? scan.name ?? scan.session_id?.slice(0, 8) ?? `session ${Math.abs(scan.agent_pid)}`;
}

// "claude · pid 84730 · c6a9aaf5"
export function sessionIdentity(scan: AgentRepositoryScan): string {
  return [
    scan.provider || "agent",
    scan.process_pid !== null ? `pid ${scan.process_pid}` : null,
    scan.session_id ? scan.session_id.slice(0, 8) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// "claude-sonnet-5 · auto · bg · started 2h ago · idle for 14m · v2.1.278"
// (OpenCode: "gpt-5.5 · build · started 2h ago · idle for 14m · v1.18.31")
export function sessionDetailsLine(scan: AgentRepositoryScan): string {
  const details = scan.details;
  if (!details) return "";
  return [
    details.model,
    details.agent,
    details.permission_mode,
    details.kind,
    details.started_at ? `started ${formatAge(details.started_at)} ago` : null,
    details.status_updated_at ? `${scan.state} for ${formatAge(details.status_updated_at)}` : null,
    details.version ? `v${details.version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

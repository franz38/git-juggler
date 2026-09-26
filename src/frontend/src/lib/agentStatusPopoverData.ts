import type { AgentRepositoryScan, AgentWorktreeActivity } from "../api/types.ts";
import type { AgentRepo, AgentSession, AgentState } from "../components/Agents/AgentStatusPopover.tsx";

const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", opencode: "opencode" };

/** Elapsed time for the popover's timer: "48s", "2m 14s", "3h 5m", "19h", "3d". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  if (h < 10) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// "20:04:11", or "just now" within the last few seconds.
function formatLastAt(ms: number, now: number): string {
  if (now - ms < 5000) return "just now";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pathBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function agentState(scan: AgentRepositoryScan): AgentState {
  if (scan.waiting_for) return "waiting";
  return scan.state === "active" ? "working" : "idle";
}

/** The worktree's most recent tool call (the hooks record Bash/Edit/Read/… with their target). */
export function lastTool(activity: AgentWorktreeActivity): { name: string; command: string } | undefined {
  for (let i = activity.evidence.length - 1; i >= 0; i--) {
    const evidence = activity.evidence[i];
    const target = evidence.command ?? evidence.path;
    if (evidence.tool && target) return { name: evidence.tool, command: target.replace(/\s+/g, " ").trim() };
  }
  return undefined;
}

/**
 * Maps one agent session (and its worktrees on the hovered commit, most recent
 * first) onto the popover's AgentSession. `showWorktrees` false (the "show
 * worktrees" setting) leaves out the Repository section altogether.
 */
export function toAgentSession(scan: AgentRepositoryScan, activities: AgentWorktreeActivity[], now: number, showWorktrees: boolean): AgentSession {
  const details = scan.details;
  const state = agentState(scan);
  const lastActivity = Math.max(0, ...scan.worktrees.map((w) => w.last_activity));
  // Claude's card stamps every busy/idle/waiting flip, so this is when the current state began.
  // OpenCode's is the session's last update instead, so the working timer reads "since update".
  const since = details?.status_updated_at ?? lastActivity;
  const startedAgo = details?.started_at ? `started ${formatElapsed(now - details.started_at).split(" ")[0]} ago` : null;
  const timerLabel =
    state === "idle" ? ["idle", startedAgo].filter(Boolean).join(" · ")
    : state === "waiting" ? "waiting"
    : scan.provider === "claude" ? "this turn" : "since update";

  const shown = showWorktrees ? activities : [];
  const repos: AgentRepo[] = shown.map((activity) => ({
    name: pathBasename(activity.worktree_path),
    branch: activity.branch ?? "detached",
    commit: activity.commit.slice(0, 8),
    home: shown.length > 1 && activity.is_home,
    lastAt: activity.last_activity ? formatLastAt(activity.last_activity, now) : undefined,
    tool: lastTool(activity),
  }));

  // The call it is blocked on is the latest one the hooks saw (PreToolUse fires before the prompt).
  const pending = activities.length ? lastTool(activities[0]) : undefined;
  const permission =
    state !== "waiting" ? undefined
    : scan.waiting_for === "permission prompt" ? { title: "Waiting for permission", tool: pending?.name, command: pending?.command }
    : { title: "Waiting for your input" };

  return {
    title: details?.title ?? scan.name ?? scan.session_id?.slice(0, 8) ?? `session ${Math.abs(scan.agent_pid)}`,
    agent: AGENT_LABEL[scan.provider] ?? (scan.provider || "agent"),
    state,
    model: details?.model ?? undefined,
    mode: [details?.permission_mode, details?.agent, details?.kind].filter(Boolean).join(" · ") || undefined,
    pid: scan.process_pid ?? undefined,
    version: details?.version ?? undefined,
    sessionId: scan.session_id?.slice(0, 8),
    timer: formatElapsed(now - since),
    timerLabel,
    lastPrompt: details?.last_prompt ?? undefined,
    repos,
    permission,
  };
}

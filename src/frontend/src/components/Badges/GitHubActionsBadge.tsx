import { For } from "solid-js";
import type { GitHubActionsRunInfo, GitHubActionsRunStatus } from "../../api/types";
import { formatDate } from "../../lib/formatDate";

const statusPriority: Record<GitHubActionsRunStatus, number> = {
  failure: 0,
  action_required: 1,
  running: 2,
  cancelled: 3,
  unknown: 4,
  neutral: 5,
  skipped: 6,
  success: 7,
};

const statusColor: Record<GitHubActionsRunStatus, string> = {
  success: "var(--success)",
  failure: "var(--danger)",
  running: "var(--accent)",
  cancelled: "var(--text-dim)",
  skipped: "var(--text-dim)",
  action_required: "var(--warning)",
  neutral: "var(--text-dim)",
  unknown: "var(--text-dim)",
};

function pickRun(runs: GitHubActionsRunInfo[]): GitHubActionsRunInfo {
  return [...runs].sort((a, b) => statusPriority[a.status] - statusPriority[b.status])[0];
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0.2a8 8 0 0 0-2.5 15.6c0.4 0.1 0.5-0.2 0.5-0.4v-1.4c-2.1 0.5-2.6-0.9-2.6-0.9-0.3-0.8-0.8-1-0.8-1-0.7-0.5 0.1-0.5 0.1-0.5 0.8 0.1 1.2 0.8 1.2 0.8 0.7 1.2 1.9 0.9 2.3 0.7 0.1-0.5 0.3-0.9 0.5-1.1-1.7-0.2-3.5-0.9-3.5-3.9 0-0.9 0.3-1.6 0.8-2.1-0.1-0.2-0.4-1 0.1-2.1 0 0 0.7-0.2 2.2 0.8A7.5 7.5 0 0 1 8 4.9c0.7 0 1.3 0.1 1.9 0.3 1.5-1 2.2-0.8 2.2-0.8 0.4 1.1 0.2 1.9 0.1 2.1 0.5 0.6 0.8 1.3 0.8 2.1 0 3-1.8 3.6-3.5 3.8 0.3 0.2 0.5 0.7 0.5 1.4v2c0 0.2 0.1 0.5 0.5 0.4A8 8 0 0 0 8 0.2z"
      />
    </svg>
  );
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "n/a";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

export function GitHubActionsBadge(props: { runs: GitHubActionsRunInfo[] }) {
  const run = () => pickRun(props.runs);
  const color = () => statusColor[run().status];
  const statusMark = () => {
    if (run().status === "success") return "✓";
    if (run().status === "failure") return "×";
    if (run().status === "running") return "●";
    if (run().status === "action_required") return "!";
    return "○";
  };

  const openRun = (event: MouseEvent) => {
    event.stopPropagation();
    const url = run().url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <span
      class="github-actions-badge"
      onClick={openRun}
    >
      <span class="github-actions-icon">
        <GitHubIcon />
      </span>
      <span class="github-actions-status" style={{ color: color() }}>
        {statusMark()}
      </span>
      <span class="github-actions-tooltip">
        <span class="github-actions-summary">{props.runs.length} workflow run{props.runs.length === 1 ? "" : "s"}</span>
        <For each={props.runs}>
          {(item) => (
            <span class="github-actions-run">
              <span class="github-actions-run-title">
                {item.workflow_name} #{item.run_number}
              </span>
              <span>Status: {item.status}</span>
              <span>Branch: {item.branch ?? "n/a"}</span>
              <span>Event: {item.event ?? "n/a"}</span>
              <span>Updated: {item.updated_at ? formatDate(item.updated_at) : "n/a"}</span>
              <span>Duration: {formatDuration(item.duration_ms)}</span>
            </span>
          )}
        </For>
      </span>
    </span>
  );
}

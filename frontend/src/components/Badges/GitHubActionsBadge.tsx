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
  success: "#36b37e",
  failure: "#ff5630",
  running: "#4c9aff",
  cancelled: "#8b949e",
  skipped: "#8b949e",
  action_required: "#ffab00",
  neutral: "#8b949e",
  unknown: "#8b949e",
};

function pickRun(runs: GitHubActionsRunInfo[]): GitHubActionsRunInfo {
  return [...runs].sort((a, b) => statusPriority[a.status] - statusPriority[b.status])[0];
}

function statusGlyph(status: GitHubActionsRunStatus): string {
  if (status === "success") return "✓";
  if (status === "failure") return "×";
  if (status === "running") return "●";
  if (status === "action_required") return "!";
  return "○";
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

  const openRun = (event: MouseEvent) => {
    event.stopPropagation();
    const url = run().url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <span
      class="github-actions-badge"
      style={{ "background-color": `${color()}26`, color: color(), "border-color": color() }}
      onClick={openRun}
    >
      <span class="github-actions-glyph">{statusGlyph(run().status)}</span>
      <span class="github-actions-count">{props.runs.length}</span>
      <span class="github-actions-tooltip">
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

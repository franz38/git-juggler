import { For } from "solid-js";
import type { CiRunInfo, CiRunStatus } from "../../api/types";
import { formatDate } from "../../lib/formatDate";

const statusPriority: Record<CiRunStatus, number> = {
  failure: 0,
  action_required: 1,
  unstable: 2,
  running: 3,
  cancelled: 4,
  aborted: 5,
  unknown: 6,
  neutral: 7,
  skipped: 8,
  success: 9,
};

const statusColor: Record<CiRunStatus, string> = {
  success: "#36b37e",
  failure: "#ff5630",
  running: "#4c9aff",
  cancelled: "#8b949e",
  skipped: "#8b949e",
  action_required: "#ffab00",
  unstable: "#ffab00",
  aborted: "#8b949e",
  neutral: "#8b949e",
  unknown: "#8b949e",
};

function pickRun(runs: CiRunInfo[]): CiRunInfo {
  return [...runs].sort((a, b) => statusPriority[a.status] - statusPriority[b.status])[0];
}

function GitHubIcon() {
  return (
    <svg viewBox="-0.5 -0.5 17 17" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0.2a8 8 0 0 0-2.5 15.6c0.4 0.1 0.5-0.2 0.5-0.4v-1.4c-2.1 0.5-2.6-0.9-2.6-0.9-0.3-0.8-0.8-1-0.8-1-0.7-0.5 0.1-0.5 0.1-0.5 0.8 0.1 1.2 0.8 1.2 0.8 0.7 1.2 1.9 0.9 2.3 0.7 0.1-0.5 0.3-0.9 0.5-1.1-1.7-0.2-3.5-0.9-3.5-3.9 0-0.9 0.3-1.6 0.8-2.1-0.1-0.2-0.4-1 0.1-2.1 0 0 0.7-0.2 2.2 0.8A7.5 7.5 0 0 1 8 4.9c0.7 0 1.3 0.1 1.9 0.3 1.5-1 2.2-0.8 2.2-0.8 0.4 1.1 0.2 1.9 0.1 2.1 0.5 0.6 0.8 1.3 0.8 2.1 0 3-1.8 3.6-3.5 3.8 0.3 0.2 0.5 0.7 0.5 1.4v2c0 0.2 0.1 0.5 0.5 0.4A8 8 0 0 0 8 0.2z"
      />
    </svg>
  );
}

function ProviderIcon(props: { run: CiRunInfo }) {
  if (props.run.provider === "github_actions") return <GitHubIcon />;
  return <span class="ci-provider-text">J</span>;
}

function providerName(provider: CiRunInfo["provider"]): string {
  if (provider === "github_actions") return "GitHub Actions";
  if (provider === "jenkins") return "Jenkins";
  return provider;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "n/a";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

export function CiRunBadge(props: { runs: CiRunInfo[] }) {
  const run = () => pickRun(props.runs);
  const color = () => statusColor[run().status];
  const statusMark = () => {
    if (run().status === "success") return "✓";
    if (run().status === "failure") return "×";
    if (run().status === "running") return "●";
    if (run().status === "action_required" || run().status === "unstable") return "!";
    return "○";
  };

  const openRun = (event: MouseEvent) => {
    event.stopPropagation();
    const url = run().url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <span class="ci-run-badge" onClick={openRun}>
      <span class="ci-run-icon">
        <ProviderIcon run={run()} />
      </span>
      <span class="ci-run-status" style={{ color: color() }}>
        {statusMark()}
      </span>
      <span class="ci-run-tooltip">
        <span class="ci-run-summary">{props.runs.length} CI run{props.runs.length === 1 ? "" : "s"}</span>
        <For each={props.runs}>
          {(item) => (
            <span class="ci-run-item">
              <span class="ci-run-title">
                {providerName(item.provider)}: {item.name} #{item.number}
              </span>
              <span>Status: {item.status}</span>
              <span>Branch: {item.branch ?? "n/a"}</span>
              <span>Event: {item.event ?? "n/a"}</span>
              <span>Updated: {item.updated_at ? formatDate(item.updated_at) : item.created_at ? formatDate(item.created_at) : "n/a"}</span>
              <span>Duration: {formatDuration(item.duration_ms)}</span>
            </span>
          )}
        </For>
      </span>
    </span>
  );
}

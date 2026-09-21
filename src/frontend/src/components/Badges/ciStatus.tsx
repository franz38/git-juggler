import type { CiRunInfo, CiRunStatus, CiStageStatus } from "../../api/types";

// Shared by the commit CI badge and the Pipelines tab.

export const statusPriority: Record<CiRunStatus, number> = {
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

export const statusColor: Record<CiStageStatus, string> = {
  success: "var(--success)",
  failure: "var(--danger)",
  running: "var(--accent)",
  cancelled: "var(--text-dim)",
  skipped: "var(--text-dim)",
  action_required: "var(--warning)",
  unstable: "var(--warning)",
  aborted: "var(--text-dim)",
  neutral: "var(--text-dim)",
  unknown: "var(--text-dim)",
  pending: "var(--text-dim)",
};

export function statusMark(status: CiStageStatus): string {
  if (status === "success") return "✓";
  if (status === "failure") return "×";
  if (status === "running") return "●";
  if (status === "action_required" || status === "unstable") return "!";
  return "○";
}

/** A stage that is done (whatever the outcome): nothing left to run. */
export function isStageFinished(status: CiStageStatus): boolean {
  return status !== "running" && status !== "pending" && status !== "action_required";
}

export function GitHubIcon() {
  return (
    <svg viewBox="-0.5 -0.5 17 17" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0.2a8 8 0 0 0-2.5 15.6c0.4 0.1 0.5-0.2 0.5-0.4v-1.4c-2.1 0.5-2.6-0.9-2.6-0.9-0.3-0.8-0.8-1-0.8-1-0.7-0.5 0.1-0.5 0.1-0.5 0.8 0.1 1.2 0.8 1.2 0.8 0.7 1.2 1.9 0.9 2.3 0.7 0.1-0.5 0.3-0.9 0.5-1.1-1.7-0.2-3.5-0.9-3.5-3.9 0-0.9 0.3-1.6 0.8-2.1-0.1-0.2-0.4-1 0.1-2.1 0 0 0.7-0.2 2.2 0.8A7.5 7.5 0 0 1 8 4.9c0.7 0 1.3 0.1 1.9 0.3 1.5-1 2.2-0.8 2.2-0.8 0.4 1.1 0.2 1.9 0.1 2.1 0.5 0.6 0.8 1.3 0.8 2.1 0 3-1.8 3.6-3.5 3.8 0.3 0.2 0.5 0.7 0.5 1.4v2c0 0.2 0.1 0.5 0.5 0.4A8 8 0 0 0 8 0.2z"
      />
    </svg>
  );
}

export function ProviderIcon(props: { run: CiRunInfo }) {
  if (props.run.provider === "github_actions") return <GitHubIcon />;
  return <span class="ci-provider-text">J</span>;
}

export function providerName(provider: CiRunInfo["provider"]): string {
  if (provider === "github_actions") return "GitHub Actions";
  if (provider === "jenkins") return "Jenkins";
  return provider;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "n/a";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

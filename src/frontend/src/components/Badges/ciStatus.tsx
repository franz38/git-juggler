import type { CiRunInfo, CiRunStatus, CiStageStatus } from "../../api/types";
import { GitHubIcon, JenkinsIcon } from "../icons";

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

export function ProviderIcon(props: { run: CiRunInfo; size?: number }) {
  if (props.run.provider === "github_actions") return <GitHubIcon size={props.size} />;
  return <JenkinsIcon size={props.size} />;
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

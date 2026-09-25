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

// The GitHub mark (github-logo.svg), filled with the current text colour so it
// follows the theme.
export function GitHubIcon(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 13} height={props.size ?? 13} aria-hidden="true">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
      />
    </svg>
  );
}

// The Jenkins butler (a full-colour picture, readable on any theme).
export function JenkinsIcon(props: { size?: number }) {
  return <img class="ci-provider-logo" src="/ci-logos/jenkins.webp" alt="" width={props.size ?? 13} height={props.size ?? 13} />;
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

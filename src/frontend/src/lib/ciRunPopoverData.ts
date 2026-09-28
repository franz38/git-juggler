import type { CiRunInfo, CiStage, CiStageStatus } from "../api/types.ts";
import type { CIJob, CIRun, CIStep, RunStatus, StepStatus } from "../components/CIRunPopover.tsx";
import { formatDate } from "./formatDate.ts";

// Maps our CI data (a CiRunInfo plus its stages, as the backend serves them for
// GitHub Actions and Jenkins) to the CIRun the CI run popover renders.
//
// What the popover can show but our data doesn't carry is left out: there is
// no `expectedSec` (no durations from a previous run, so no ghost bars), and
// the failure banner's message only says how long the failing step ran (the
// providers' APIs we read don't expose the error text).

/** The popover knows three run states: waiting runs count as running, every unsuccessful ending as failed. */
export function runStatus(status: CiStageStatus): RunStatus {
  if (status === "success" || status === "neutral") return "success";
  if (status === "running" || status === "action_required" || status === "pending") return "running";
  return "failure";
}

export function stepStatus(status: CiStageStatus): StepStatus {
  switch (status) {
    case "success":
    case "neutral":
      return "success";
    case "running":
    case "action_required":
      return "running";
    case "pending":
    case "unknown":
      return "queued";
    case "skipped":
      return "skipped";
    default:
      return "failure";
  }
}

const parse = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** Seconds a stage has run: its recorded duration, or the time since it started while still going. */
function durationSec(stage: CiStage, now: number): number {
  if (stage.duration_ms !== null) return stage.duration_ms / 1000;
  const started = parse(stage.started_at);
  return stage.status === "running" && started !== null ? Math.max(0, now - started) / 1000 : 0;
}

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

export function toCIRun(info: CiRunInfo, stages: CiStage[] | null | undefined, now: number = Date.now()): CIRun {
  const list = stages ?? [];
  // Job offsets count from the first job's start (queue time before it isn't part of the timeline).
  const starts = list.map((stage) => parse(stage.started_at)).filter((ms): ms is number => ms !== null);
  const origin = starts.length ? Math.min(...starts) : null;

  const jobs: CIJob[] = list.map((stage) => {
    const started = parse(stage.started_at);
    const steps: CIStep[] = (stage.steps ?? []).map((step) => ({ name: step.name, status: stepStatus(step.status), durationSec: durationSec(step, now) }));
    return {
      name: stage.name,
      status: stepStatus(stage.status),
      startSec: origin !== null && started !== null ? (started - origin) / 1000 : 0,
      durationSec: durationSec(stage, now),
      steps,
    };
  });

  const status = runStatus(info.status);
  const updated = info.updated_at ?? info.created_at;
  const run: CIRun = {
    title: `${info.name} #${info.number}`,
    url: info.url || undefined,
    archived: info.archived || undefined,
    provider: info.provider === "jenkins" ? "jenkins" : "github",
    status,
    branch: info.branch ?? "n/a",
    event: info.event ?? "n/a",
    updatedLabel: updated ? formatDate(updated) : "n/a",
    updatedTitle: updated ?? undefined,
    jobs,
  };

  if (status === "failure") {
    const job = jobs.find((j) => j.status === "failure");
    const step = job?.steps.find((s) => s.status === "failure");
    if (job) {
      const failed = step ?? job;
      run.failure = { job: job.name, step: step?.name ?? job.name, message: `${step ? "Step" : "Job"} failed after ${fmt(failed.durationSec)}` };
    }
  }
  return run;
}

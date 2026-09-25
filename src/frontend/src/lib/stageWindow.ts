// Helpers for the commit hover graph: which stage is the "current" one, and how
// long a running one has been going.

interface StageLike {
  status: string;
}

/**
 * The stage the graph centres on: the first running stage; else the first
 * failed one (so a failure is never hidden behind later stages); else the first
 * pending one (a run between stages, or one that hasn't started); else the last.
 */
export function currentStageIndex(stages: StageLike[]): number {
  if (stages.length === 0) return -1;
  for (const status of ["running", "failure", "pending"]) {
    const index = stages.findIndex((stage) => stage.status === status);
    if (index >= 0) return index;
  }
  return stages.length - 1;
}

/** Milliseconds a running stage has been going; null when not running or unknown. */
export function elapsedMs(status: string, startedAt: string | null, now: number): number | null {
  if (status !== "running" || !startedAt) return null;
  const started = Date.parse(startedAt);
  return Number.isNaN(started) ? null : Math.max(0, now - started);
}

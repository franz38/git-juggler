// Which stages of a pipeline the commit hover graph shows: a window of up to
// WINDOW_SIZE stages around the "current" one (n-1, n, n+1, n+2).

export const WINDOW_SIZE = 4;

interface StageLike {
  status: string;
}

/**
 * The stage the window centres on: the first running stage; else the first
 * failed one (so a failure is never scrolled out of view); else the first
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

export interface StageWindow {
  start: number;
  end: number; // exclusive
  hiddenBefore: number;
  hiddenAfter: number;
}

/** Up to WINDOW_SIZE stages starting one before `current`, shifted to stay full at the ends. */
export function windowStages(total: number, current: number): StageWindow {
  if (total <= WINDOW_SIZE) return { start: 0, end: total, hiddenBefore: 0, hiddenAfter: 0 };
  let start = Math.max(0, current - 1);
  const end = Math.min(total, start + WINDOW_SIZE);
  start = Math.max(0, end - WINDOW_SIZE);
  return { start, end, hiddenBefore: start, hiddenAfter: total - end };
}

/** Milliseconds a running stage has been going; null when not running or unknown. */
export function elapsedMs(status: string, startedAt: string | null, now: number): number | null {
  if (status !== "running" || !startedAt) return null;
  const started = Date.parse(startedAt);
  return Number.isNaN(started) ? null : Math.max(0, now - started);
}

import type { CiRunInfo } from "../api/types";

type RunsByCommit = Record<string, CiRunInfo[]>;

const sameRun = (a: CiRunInfo, b: CiRunInfo) => a.provider === b.provider && a.run_id === b.run_id;

/** Poll reference of a run (`<provider>:<run_id>`), the form the poll endpoint takes. */
export function runRef(run: CiRunInfo): string | null {
  return run.run_id ? `${run.provider}:${run.run_id}` : null;
}

/** References of the runs still going: the ones worth polling individually. */
export function runningRefs(runs: RunsByCommit): string[] {
  const refs: string[] = [];
  for (const list of Object.values(runs)) {
    for (const run of list) {
      const ref = run.status === "running" ? runRef(run) : null;
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

export interface MergeResult {
  next: RunsByCommit;
  /** Runs that were running and now report a final status. */
  finished: CiRunInfo[];
}

/**
 * Folds polled runs into the per-commit run lists: a run already known
 * (same provider and run id) is replaced in place, a new one is appended to its
 * commit. Runs with no commit sha can't be attached to a row and are skipped.
 * Untouched commits keep their array identity.
 */
export function mergePolledRuns(current: RunsByCommit, polled: CiRunInfo[]): MergeResult {
  const next: RunsByCommit = { ...current };
  const finished: CiRunInfo[] = [];

  for (const run of polled) {
    if (!run.head_sha) continue;
    const list = next[run.head_sha] ?? [];
    const index = list.findIndex((known) => sameRun(known, run));
    if (index >= 0) {
      if (list[index].status === "running" && run.status !== "running") finished.push(run);
      next[run.head_sha] = list.map((known, i) => (i === index ? run : known));
    } else {
      next[run.head_sha] = [...list, run];
    }
  }
  return { next, finished };
}

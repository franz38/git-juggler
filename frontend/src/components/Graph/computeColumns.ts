import type { CommitSummary } from "../../api/types";

export interface LaneInfo {
  column: number;
}

interface BranchInterval {
  name: string;
  start: number;
  end: number;
}

/**
 * Assigns each commit's owning branch a column (lane):
 *  - the checked-out branch (for this repo path) is pinned to column 0
 *  - every other branch that's checked out in *some* worktree of the repo
 *    (`checkedOutBranches`, which includes `currentBranch`) gets its own
 *    permanent column too — it's "live", so it shouldn't visually merge
 *    into a lane some unrelated branch might reuse later
 *  - every other (not-checked-out-anywhere) branch is packed into the
 *    smallest column whose previous occupant's commit range doesn't overlap
 *    its own, so branches that never coexist in time can share an x
 *    position (classic interval-partitioning / "meeting rooms" greedy
 *    algorithm), keeping the graph compact instead of giving every branch a
 *    permanent, unique column.
 */
export function computeColumns(
  chronological: CommitSummary[],
  currentBranch: string | null,
  checkedOutBranches: string[] = [],
): Map<string, LaneInfo> {
  const indexByHash = new Map(chronological.map((commit, index) => [commit.hash, index]));
  const intervalByBranch = new Map<string, BranchInterval>();
  chronological.forEach((c, index) => {
    const parentIndex = c.refs.stashes.length > 0 && c.parents[0] ? indexByHash.get(c.parents[0]) : undefined;
    const start = parentIndex === undefined ? index : Math.min(index, parentIndex);
    const end = parentIndex === undefined ? index : Math.max(index, parentIndex);
    const existing = intervalByBranch.get(c.branch);
    if (existing) {
      existing.start = Math.min(existing.start, start);
      existing.end = Math.max(existing.end, end);
    } else {
      intervalByBranch.set(c.branch, { name: c.branch, start, end });
    }
  });

  const intervals = [...intervalByBranch.values()];
  const current = currentBranch ? intervals.find((b) => b.name === currentBranch) : undefined;
  const checkedOutSet = new Set(checkedOutBranches);
  const otherCheckedOut = intervals
    .filter((b) => b !== current && checkedOutSet.has(b.name))
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const rest = intervals
    .filter((b) => b !== current && !checkedOutSet.has(b.name))
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

  const columnEnds: number[] = [];
  const columnByBranch = new Map<string, number>();

  // A pinned column is never reused by anything else — mark its "end"
  // unreachably far so the packing check below (`columnEnds[col] <
  // branch.start`) can never match it.
  function placePinned(branch: BranchInterval, column?: number): void {
    const col = column ?? columnEnds.length;
    columnEnds[col] = Infinity;
    columnByBranch.set(branch.name, col);
  }

  function placePacked(branch: BranchInterval): void {
    for (let col = 0; col < columnEnds.length; col++) {
      if (columnEnds[col] < branch.start) {
        columnEnds[col] = branch.end;
        columnByBranch.set(branch.name, col);
        return;
      }
    }
    columnEnds.push(branch.end);
    columnByBranch.set(branch.name, columnEnds.length - 1);
  }

  if (current) placePinned(current, 0);
  for (const branch of otherCheckedOut) placePinned(branch);
  for (const branch of rest) placePacked(branch);

  const lanes = new Map<string, LaneInfo>();
  for (const c of chronological) {
    lanes.set(c.hash, { column: columnByBranch.get(c.branch) ?? 0 });
  }
  return lanes;
}

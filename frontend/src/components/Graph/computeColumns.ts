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
 *  - the checked-out branch is pinned to column 0 (drawn leftmost)
 *  - every other branch is packed into the smallest column whose previous
 *    occupant's commit range doesn't overlap its own, so branches that
 *    never coexist in time can share an x position (classic interval-
 *    partitioning / "meeting rooms" greedy algorithm), keeping the graph
 *    compact instead of giving every branch a permanent, unique column.
 */
export function computeColumns(chronological: CommitSummary[], currentBranch: string | null): Map<string, LaneInfo> {
  const intervalByBranch = new Map<string, BranchInterval>();
  chronological.forEach((c, index) => {
    const existing = intervalByBranch.get(c.branch);
    if (existing) {
      existing.end = index;
    } else {
      intervalByBranch.set(c.branch, { name: c.branch, start: index, end: index });
    }
  });

  const intervals = [...intervalByBranch.values()];
  const current = currentBranch ? intervals.find((b) => b.name === currentBranch) : undefined;
  const rest = intervals.filter((b) => b !== current).sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

  const columnEnds: number[] = [];
  const columnByBranch = new Map<string, number>();

  function place(branch: BranchInterval, pinnedColumn?: number): void {
    if (pinnedColumn !== undefined) {
      columnEnds[pinnedColumn] = branch.end;
      columnByBranch.set(branch.name, pinnedColumn);
      return;
    }
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

  if (current) place(current, 0);
  for (const branch of rest) place(branch);

  const lanes = new Map<string, LaneInfo>();
  for (const c of chronological) {
    lanes.set(c.hash, { column: columnByBranch.get(c.branch) ?? 0 });
  }
  return lanes;
}

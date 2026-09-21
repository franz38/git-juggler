import type { CommitSummary } from "../../api/types";

export interface LaneInfo {
  column: number;
}

/**
 * The rows a branch's lane is actually drawn across, as indices into the
 * chronological (oldest-first) commit list.
 */
export interface BranchSpan {
  name: string;
  /** Oldest row the lane touches (the fork point, once its jog is included). */
  start: number;
  /** Newest row the lane touches (the merge commit that absorbed it, if any). */
  end: number;
  /** Row of the branch's own newest commit; how "recent" the branch is. */
  tip: number;
}

/**
 * Computes, per branch, the vertical range its lane is drawn over. That is
 * wider than the range of its own commits, because of how edges are drawn
 * (see GraphPanel):
 *  - a first-parent edge runs down the *child's* lane all the way to the
 *    parent's row, so a branch's lane reaches down to its fork point;
 *  - a merge edge jogs sideways out of the merge commit and then runs down the
 *    *parent's* lane, so a merged branch's lane reaches up to the merge row.
 * Two branches can only share a column when these ranges don't overlap.
 */
export function computeBranchSpans(chronological: CommitSummary[]): Map<string, BranchSpan> {
  const indexByHash = new Map(chronological.map((commit, index) => [commit.hash, index]));
  const spans = new Map<string, BranchSpan>();

  chronological.forEach((c, index) => {
    const existing = spans.get(c.branch);
    if (existing) {
      existing.start = Math.min(existing.start, index);
      existing.end = Math.max(existing.end, index);
      existing.tip = Math.max(existing.tip, index);
    } else {
      spans.set(c.branch, { name: c.branch, start: index, end: index, tip: index });
    }
  });

  const extend = (name: string, index: number) => {
    const span = spans.get(name)!;
    span.start = Math.min(span.start, index);
    span.end = Math.max(span.end, index);
  };

  chronological.forEach((c, index) => {
    c.parents.forEach((parentHash, parentIdx) => {
      const parentIndex = indexByHash.get(parentHash);
      if (parentIndex === undefined) return; // parent outside the loaded history
      if (parentIdx === 0) {
        extend(c.branch, parentIndex);
      } else {
        extend(chronological[parentIndex].branch, index);
      }
    });
  });

  return spans;
}

/**
 * Assigns each commit's owning branch a column (lane):
 *  - the checked-out branch is pinned to column 0 (the leftmost), and that
 *    column is reserved for it alone;
 *  - every other branch is placed newest-first (by the row of its most recent
 *    commit), each into the leftmost column where it doesn't overlap any
 *    branch already there. Branches whose drawn ranges never overlap therefore
 *    share a lane, and the most recently active branches sit closest to the
 *    checked-out one.
 */
export function computeColumns(
  chronological: CommitSummary[],
  currentBranch: string | null,
): Map<string, LaneInfo> {
  const spans = computeBranchSpans(chronological);
  const current = currentBranch ? spans.get(currentBranch) : undefined;

  const others = [...spans.values()]
    .filter((span) => span !== current)
    .sort((a, b) => b.tip - a.tip || a.name.localeCompare(b.name));

  // columns[i] lists the branches placed in column i; column 0 is reserved
  // (left empty here) when there is a checked-out branch.
  const columns: BranchSpan[][] = current ? [[]] : [];
  const columnByBranch = new Map<string, number>();
  if (current) columnByBranch.set(current.name, 0);

  for (const branch of others) {
    let column = current ? 1 : 0;
    while (column < columns.length && columns[column].some((o) => o.end >= branch.start && branch.end >= o.start)) {
      column++;
    }
    if (column === columns.length) columns.push([]);
    columns[column].push(branch);
    columnByBranch.set(branch.name, column);
  }

  const lanes = new Map<string, LaneInfo>();
  for (const c of chronological) {
    lanes.set(c.hash, { column: columnByBranch.get(c.branch) ?? 0 });
  }
  return lanes;
}

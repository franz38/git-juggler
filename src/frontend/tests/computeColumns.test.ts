import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommitSummary } from "../src/api/types.ts";
import { computeBranchSpans, computeColumns } from "../src/components/Graph/computeColumns.ts";

// Compact fixture: "hash:branch:parent1,parent2" in oldest-first order.
function graph(...rows: string[]): CommitSummary[] {
  return rows.map((row) => {
    const [hash, branch, parents = ""] = row.split(":");
    return {
      hash,
      branch,
      parents: parents ? parents.split(",") : [],
      refs: { branches: [], remote_branches: [], tags: [], stashes: [] },
    } as unknown as CommitSummary;
  });
}

function columns(commits: CommitSummary[], current: string | null): Record<string, number> {
  const lanes = computeColumns(commits, current);
  const out: Record<string, number> = {};
  for (const c of commits) out[c.branch] = lanes.get(c.hash)!.column;
  return out;
}

test("the checked-out branch is always column 0, even if it started late", () => {
  const commits = graph("m1:main", "f1:feat:m1", "f2:feat:f1", "m2:main:m1");
  assert.deepEqual(columns(commits, "feat"), { feat: 0, main: 1 });
  assert.deepEqual(columns(commits, "main"), { main: 0, feat: 1 });
});

test("branches whose ranges never overlap share a lane", () => {
  const commits = graph(
    "m1:main",
    "a1:A:m1",
    "a2:A:a1",
    "m2:main:m1",
    "m3:main:m2",
    "b1:B:m3",
    "b2:B:b1",
    "m4:main:m3",
  );
  assert.deepEqual(columns(commits, "main"), { main: 0, A: 1, B: 1 });
});

test("overlapping branches get separate lanes, most recent nearest the checked-out one", () => {
  const commits = graph(
    "m1:main",
    "z1:Z:m1",
    "y1:Y:m1",
    "x1:X:m1",
    "z2:Z:z1",
    "y2:Y:y1",
    "x2:X:x1",
  );
  // X's tip is the newest, then Y, then Z.
  assert.deepEqual(columns(commits, "main"), { main: 0, X: 1, Y: 2, Z: 3 });
});

test("recency, not start order, decides who gets the leftmost free lane", () => {
  // P starts first but its tip is older than Q's; both overlap.
  const commits = graph("m1:main", "p1:P:m1", "q1:Q:m1", "p2:P:p1", "q2:Q:q1", "q3:Q:q2");
  assert.deepEqual(columns(commits, "main"), { main: 0, Q: 1, P: 2 });
});

test("a merged branch keeps its lane until the merge commit, so later branches can't reuse it early", () => {
  // A ends at a2 (row 2) but is merged into main at row 7. B forks at row 4,
  // inside A's drawn range, so they must not share a lane.
  const commits = graph(
    "m1:main",
    "a1:A:m1",
    "a2:A:a1",
    "m2:main:m1",
    "m3:main:m2",
    "b1:B:m3",
    "b2:B:b1",
    "m4:main:m3,a2",
  );
  const spans = computeBranchSpans(commits);
  assert.equal(spans.get("A")!.end, 7);
  const cols = columns(commits, "main");
  assert.notEqual(cols.A, cols.B);
  assert.deepEqual(cols, { main: 0, B: 1, A: 2 });
});

test("a branch's lane extends down to its fork point", () => {
  const commits = graph("m1:main", "m2:main:m1", "m3:main:m2", "f1:feat:m1");
  assert.equal(computeBranchSpans(commits).get("feat")!.start, 0);
});

test("without a checked-out branch, packing starts at column 0", () => {
  const commits = graph("a1:A", "a2:A:a1", "b1:B", "b2:B:b1");
  assert.deepEqual(columns(commits, null), { A: 0, B: 0 });
  // Unknown current branch behaves the same.
  assert.deepEqual(columns(commits, "gone"), { A: 0, B: 0 });
});

test("column 0 stays reserved for the checked-out branch even where it is idle", () => {
  // main only spans rows 0-1; a later branch must still not take column 0.
  const commits = graph("m1:main", "m2:main:m1", "x1:X", "x2:X:x1");
  assert.deepEqual(columns(commits, "main"), { main: 0, X: 1 });
});

test("parents outside the loaded history are ignored", () => {
  const commits = graph("a1:A:missing", "a2:A:a1,alsomissing");
  assert.deepEqual(columns(commits, "A"), { A: 0 });
});

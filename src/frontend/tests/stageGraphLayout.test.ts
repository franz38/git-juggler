import { test } from "node:test";
import assert from "node:assert/strict";
import type { CiStage } from "../src/api/types.ts";
import { layoutStageGraph } from "../src/lib/stageGraphLayout.ts";

const stage = (name: string, status: CiStage["status"], steps: CiStage[] | null = null): CiStage => ({
  name,
  status,
  started_at: null,
  duration_ms: null,
  steps,
});

const steps = (...names: string[]) => names.map((name) => stage(name, "success"));
const kinds = (input: Parameters<typeof layoutStageGraph>[0]) => layoutStageGraph(input).items.map((item) => item.kind);

test("chain: completed summary, current job, its steps, next job, missing summary", () => {
  const stages = [stage("a", "success"), stage("b", "success"), stage("c", "running", steps("s1", "s2", "s3")), stage("d", "pending"), stage("e", "pending"), stage("f", "pending")];
  const layout = layoutStageGraph({ stages });
  assert.deepEqual(layout.items.map((item) => item.kind), ["summary", "job", "step", "step", "step", "job", "summary"]);
  const [done, , , , , , missing] = layout.items;
  assert.equal(done.kind === "summary" && done.count, 2);
  assert.equal(missing.kind === "summary" && missing.count, 2);
});

test("summary captions carry the number, singular for one", () => {
  const two = layoutStageGraph({ stages: [stage("a", "success"), stage("b", "success"), stage("c", "running"), stage("d", "pending"), stage("e", "pending"), stage("f", "pending")] });
  const captions = (layout: typeof two) => layout.items.flatMap((item) => (item.kind === "summary" ? [item.caption] : []));
  assert.deepEqual(captions(two), ["2 jobs completed", "2 jobs missing"]);
  const one = layoutStageGraph({ stages: [stage("a", "success"), stage("b", "running"), stage("c", "pending"), stage("d", "pending")] });
  assert.deepEqual(captions(one), ["1 job completed", "1 job missing"]);
});

test("a connector leading into something not started stays gray", () => {
  // current job running (green) with every step done: the line into the pending next job is gray
  const done = layoutStageGraph({ stages: [stage("a", "running", steps("s1", "s2")), stage("b", "pending"), stage("c", "pending")] });
  assert.deepEqual(done.links.map((l) => l.status), ["success", "success", "pending", "pending"]);
  // a pending step: the line into it is gray, the finished ones stay green
  const mixed = layoutStageGraph({ stages: [stage("a", "running", [stage("s1", "success"), stage("s2", "pending")]), stage("b", "pending")] });
  assert.deepEqual(mixed.links.map((l) => l.status), ["success", "pending", "pending"]);
  // End: gray until the run succeeded
  const end = (runStatus: string) => layoutStageGraph({ stages: [stage("a", "success")], runStatus }).links.at(-1)?.status;
  assert.equal(end("failure"), "pending");
  assert.equal(end("success"), "success");
});

test("no summaries when nothing is completed or missing", () => {
  assert.deepEqual(kinds({ stages: [stage("a", "running"), stage("b", "pending")] }), ["job", "job"]);
});

test("everything is linked, edge to edge, left to right", () => {
  const layout = layoutStageGraph({ stages: [stage("a", "success"), stage("b", "running", steps("s1", "s2")), stage("c", "pending")] });
  assert.equal(layout.links.length, layout.items.length - 1);
  for (const link of layout.links) assert.ok(link.x2 > link.x1);
  layout.items.slice(1).forEach((item, i) => assert.ok(item.x > layout.items[i].x));
});

test("the connector leaving a running current job is green, like the job", () => {
  const layout = layoutStageGraph({ stages: [stage("a", "running", steps("s1")), stage("b", "pending")] });
  assert.equal(layout.links[0].status, "success");
  // a failed job keeps its red connector into a step that ran, but the one into a job that never started is gray
  const failed = layoutStageGraph({ stages: [stage("a", "failure", [stage("s1", "failure")]), stage("b", "pending")] });
  assert.deepEqual(failed.links.map((l) => l.status), ["failure", "pending"]);
});

test("a job without steps joins directly to the next job", () => {
  assert.deepEqual(kinds({ stages: [stage("a", "running"), stage("b", "pending")] }), ["job", "job"]);
});

test("the last job is followed by End, lit only when the run succeeded", () => {
  const stages = [stage("a", "success"), stage("b", "success")];
  for (const [runStatus, lit] of [["success", true], ["failure", false], [undefined, false]] as const) {
    const items = layoutStageGraph({ stages, runStatus }).items;
    const end = items.at(-1);
    assert.equal(end?.kind, "end");
    assert.equal(end?.kind === "end" && end.lit, lit);
  }
});

test("hovering a step widens its slot and pushes what follows to the right", () => {
  const stages = [stage("a", "running", steps("short", "a-rather-long-step-name", "last")), stage("b", "pending")];
  const rest = layoutStageGraph({ stages });
  const hovered = layoutStageGraph({ stages, hoveredStep: 1 });
  assert.ok(hovered.width > rest.width);
  const [, , stepBefore, stepHovered, stepAfter, nextJob] = [undefined, ...hovered.items];
  assert.equal(stepBefore?.x, rest.items[1].x);
  assert.equal(stepHovered?.kind === "step" && stepHovered.hovered, true);
  assert.ok((stepAfter?.x ?? 0) > rest.items[3].x);
  assert.ok((nextJob?.x ?? 0) > rest.items[4].x);
});

test("no stages, no graph", () => {
  const layout = layoutStageGraph({ stages: [] });
  assert.deepEqual([layout.items.length, layout.links.length, layout.width], [0, 0, 0]);
});

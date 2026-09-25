import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStageIndex, elapsedMs } from "../src/lib/stageWindow.ts";

const stages = (...statuses: string[]) => statuses.map((status) => ({ status }));

test("current stage prefers running, then failure, then pending, then last", () => {
  assert.equal(currentStageIndex(stages("success", "running", "pending")), 1);
  assert.equal(currentStageIndex(stages("success", "failure", "pending")), 1);
  assert.equal(currentStageIndex(stages("success", "success", "pending")), 2);
  assert.equal(currentStageIndex(stages("pending", "pending")), 0);
  assert.equal(currentStageIndex(stages("success", "success", "cancelled")), 2);
  assert.equal(currentStageIndex([]), -1);
});

test("elapsed time only for running stages with a start", () => {
  const start = "2026-01-01T00:00:00Z";
  const now = Date.parse(start) + 5000;
  assert.equal(elapsedMs("running", start, now), 5000);
  assert.equal(elapsedMs("success", start, now), null);
  assert.equal(elapsedMs("running", null, now), null);
});

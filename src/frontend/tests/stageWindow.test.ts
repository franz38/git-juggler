import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStageIndex, elapsedMs, windowStages } from "../src/lib/stageWindow.ts";

const stages = (...statuses: string[]) => statuses.map((status) => ({ status }));

test("current stage prefers running, then failure, then pending, then last", () => {
  assert.equal(currentStageIndex(stages("success", "running", "pending")), 1);
  assert.equal(currentStageIndex(stages("success", "failure", "pending")), 1);
  assert.equal(currentStageIndex(stages("success", "success", "pending")), 2);
  assert.equal(currentStageIndex(stages("pending", "pending")), 0);
  assert.equal(currentStageIndex(stages("success", "success", "cancelled")), 2);
  assert.equal(currentStageIndex([]), -1);
});

test("shows every stage when there are four or fewer", () => {
  assert.deepEqual(windowStages(3, 1), { start: 0, end: 3, hiddenBefore: 0, hiddenAfter: 0 });
  assert.deepEqual(windowStages(4, 3), { start: 0, end: 4, hiddenBefore: 0, hiddenAfter: 0 });
});

test("window is n-1..n+2, shifted to stay full at the edges", () => {
  assert.deepEqual(windowStages(8, 4), { start: 3, end: 7, hiddenBefore: 3, hiddenAfter: 1 });
  assert.deepEqual(windowStages(8, 0), { start: 0, end: 4, hiddenBefore: 0, hiddenAfter: 4 });
  assert.deepEqual(windowStages(8, 7), { start: 4, end: 8, hiddenBefore: 4, hiddenAfter: 0 });
});

test("elapsed time only for running stages with a start", () => {
  const start = "2026-01-01T00:00:00Z";
  const now = Date.parse(start) + 5000;
  assert.equal(elapsedMs("running", start, now), 5000);
  assert.equal(elapsedMs("success", start, now), null);
  assert.equal(elapsedMs("running", null, now), null);
});

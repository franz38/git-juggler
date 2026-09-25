import { test } from "node:test";
import assert from "node:assert/strict";
import type { CiRunInfo, CiStage } from "../src/api/types.ts";
import { runStatus, stepStatus, toCIRun } from "../src/lib/ciRunPopoverData.ts";

const info = (over: Partial<CiRunInfo> = {}): CiRunInfo => ({
  provider: "github_actions",
  status: "success",
  name: "Build",
  number: 13,
  url: "https://example.test/run/13",
  branch: "main",
  event: "push",
  created_at: "2026-09-25T08:00:00Z",
  updated_at: "2026-09-25T08:04:00Z",
  duration_ms: 66000,
  run_id: "1",
  head_sha: null,
  stages: null,
  ...over,
});

const stage = (name: string, status: CiStage["status"], started_at: string | null, duration_ms: number | null, steps: CiStage[] | null = null): CiStage => ({
  name,
  status,
  started_at,
  duration_ms,
  steps,
});

test("statuses fold into the popover's run and step states", () => {
  assert.deepEqual(["success", "neutral", "running", "action_required", "failure", "cancelled", "aborted"].map((s) => runStatus(s as CiStage["status"])), [
    "success",
    "success",
    "running",
    "running",
    "failure",
    "failure",
    "failure",
  ]);
  assert.deepEqual(["pending", "skipped", "unstable", "running"].map((s) => stepStatus(s as CiStage["status"])), ["queued", "skipped", "failure", "running"]);
});

test("run fields and job offsets from the first job's start", () => {
  const run = toCIRun(info(), [
    stage("validate", "success", "2026-09-25T08:00:10Z", 3000, [stage("Set up job", "success", "2026-09-25T08:00:10Z", 1000)]),
    stage("build", "success", "2026-09-25T08:00:13Z", 34000),
  ]);
  assert.equal(run.title, "Build #13");
  assert.equal(run.provider, "github");
  assert.equal(run.status, "success");
  assert.deepEqual(
    run.jobs.map((j) => [j.name, j.startSec, j.durationSec, j.steps.length]),
    [
      ["validate", 0, 3, 1],
      ["build", 3, 34, 0],
    ],
  );
  assert.equal(run.failure, undefined);
});

test("a running job's duration is the time since it started", () => {
  const now = Date.parse("2026-09-25T08:01:00Z");
  const run = toCIRun(info({ status: "running" }), [stage("build", "running", "2026-09-25T08:00:30Z", null), stage("publish", "pending", null, null)], now);
  assert.equal(run.status, "running");
  assert.deepEqual(
    run.jobs.map((j) => [j.status, j.durationSec]),
    [
      ["running", 30],
      ["queued", 0],
    ],
  );
});

test("a failed run names its failing job and step", () => {
  const run = toCIRun(info({ status: "failure" }), [
    stage("build", "failure", "2026-09-25T08:00:00Z", 20000, [stage("Checkout", "success", null, 2000), stage("Test", "failure", null, 12000)]),
  ]);
  assert.deepEqual(run.failure, { job: "build", step: "Test", message: "Step failed after 12s" });
});

test("stages not loaded yet: the run with no jobs", () => {
  const run = toCIRun(info({ provider: "jenkins", branch: null, url: "" }), undefined);
  assert.deepEqual([run.provider, run.branch, run.url, run.jobs.length], ["jenkins", "n/a", undefined, 0]);
});

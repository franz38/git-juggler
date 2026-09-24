import { test } from "node:test";
import assert from "node:assert/strict";
import type { CiRunInfo } from "../src/api/types.ts";
import { mergePolledRuns, runningRefs } from "../src/lib/ciPoll.ts";

const run = (runId: string, status: CiRunInfo["status"], headSha: string | null = "abc", provider: CiRunInfo["provider"] = "github_actions"): CiRunInfo => ({
  provider,
  status,
  name: "CI",
  number: 1,
  url: "u",
  branch: null,
  event: null,
  created_at: null,
  updated_at: null,
  duration_ms: null,
  run_id: runId,
  head_sha: headSha,
  stages: null,
});

test("a known run is replaced in place and reported when it finishes", () => {
  const current = { abc: [run("1", "running"), run("2", "success")], other: [run("9", "success", "other")] };
  const { next, finished } = mergePolledRuns(current, [run("1", "failure")]);
  assert.deepEqual(next.abc.map((r) => [r.run_id, r.status]), [["1", "failure"], ["2", "success"]]);
  assert.deepEqual(finished.map((r) => r.run_id), ["1"]);
  assert.equal(next.other, current.other);
});

test("a run that is still running is not reported as finished", () => {
  const { finished } = mergePolledRuns({ abc: [run("1", "running")] }, [run("1", "running")]);
  assert.equal(finished.length, 0);
});

test("a newly discovered run is appended to its commit, creating the entry if needed", () => {
  const { next, finished } = mergePolledRuns({ abc: [run("1", "success")] }, [run("2", "running"), run("3", "running", "new")]);
  assert.deepEqual(next.abc.map((r) => r.run_id), ["1", "2"]);
  assert.deepEqual(next.new.map((r) => r.run_id), ["3"]);
  assert.equal(finished.length, 0);
});

test("the same run id from another provider is a different run", () => {
  const { next } = mergePolledRuns({ abc: [run("1", "running")] }, [run("1", "running", "abc", "jenkins")]);
  assert.equal(next.abc.length, 2);
});

test("runs without a commit sha are skipped", () => {
  const { next } = mergePolledRuns({}, [run("1", "running", null)]);
  assert.deepEqual(next, {});
});

test("only running runs are polled, as provider:run_id refs", () => {
  const runs = { a: [run("1", "running"), run("2", "success")], b: [run("http://j/job/x/3/", "running", "b", "jenkins")] };
  assert.deepEqual(runningRefs(runs), ["github_actions:1", "jenkins:http://j/job/x/3/"]);
});

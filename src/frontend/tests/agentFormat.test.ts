import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRepositoryScan } from "../src/api/types.ts";
import { compareSessions, sessionLastActivity } from "../src/components/Agents/agentFormat.ts";

function scan(id: string, state: "active" | "idle", ...lastActivities: number[]): AgentRepositoryScan {
  return {
    session_id: id,
    state,
    worktrees: lastActivities.map((last_activity) => ({ last_activity })),
  } as unknown as AgentRepositoryScan;
}

const order = (...scans: AgentRepositoryScan[]) => scans.sort(compareSessions).map((s) => s.session_id);

test("a session's last activity is its newest worktree activity", () => {
  assert.equal(sessionLastActivity(scan("a", "idle", 5, 90, 20)), 90);
  assert.equal(sessionLastActivity(scan("b", "idle")), 0);
});

test("active sessions come first, then idle ones", () => {
  assert.deepEqual(order(scan("idle-new", "idle", 900), scan("active-old", "active", 10)), ["active-old", "idle-new"]);
});

test("within a group, the session idle for the least time is first", () => {
  assert.deepEqual(
    order(scan("i-old", "idle", 100), scan("i-new", "idle", 500), scan("a-old", "active", 50), scan("a-new", "active", 400)),
    ["a-new", "a-old", "i-new", "i-old"],
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentActivityEvidence, AgentRepositoryScan, AgentWorktreeActivity } from "../src/api/types.ts";
import { formatElapsed, toAgentSession } from "../src/lib/agentStatusPopoverData.ts";

const NOW = 1_790_000_000_000;

const evidence = (tool: string | null, command: string | null, path: string | null = null): AgentActivityEvidence => ({
  type: "hook-pretooluse", pid: 1, cwd: null, path, executable: null, command, process_role: "hook", tool, score: 1,
});

const activity = (over: Partial<AgentWorktreeActivity> = {}): AgentWorktreeActivity => ({
  repository_id: "r",
  worktree_path: "/Users/me/git-juggler",
  branch: "main",
  commit: "dfb27df07b3f6be8c4",
  process_ids: [],
  first_seen: NOW - 60_000,
  last_seen: NOW - 1000,
  last_activity: NOW - 1000,
  evidence: [evidence("Bash", "npm   test"), evidence(null, null, "/x")],
  activity_score: 1,
  state: "active",
  is_home: true,
  ...over,
});

const scan = (over: Partial<AgentRepositoryScan> = {}): AgentRepositoryScan => ({
  agent_pid: -5,
  session_directory: null,
  worktrees: [activity()],
  scanned_at: NOW,
  state: "active",
  provider: "claude",
  session_id: "edd464bd-aaaa",
  process_pid: 15502,
  name: "card name",
  details: {
    started_at: NOW - 21 * 3_600_000, status_updated_at: NOW - 134_000, version: "2.1.282", kind: "bg", entrypoint: null,
    title: "ci hover panel", model: "claude-opus-5-5", permission_mode: "auto", agent: null, last_prompt: "use #fff",
    worktree_path: null, worktree_name: null, worktree_branch: null,
  },
  waiting_for: null,
  is_subagent: false,
  parent_session_id: null,
  parent_title: null,
  parent_agent: null,
  parent_provider: null,
  ...over,
});

test("formatElapsed", () => {
  assert.equal(formatElapsed(48_000), "48s");
  assert.equal(formatElapsed(134_000), "2m 14s");
  assert.equal(formatElapsed(3 * 3_600_000 + 5 * 60_000), "3h 5m");
  assert.equal(formatElapsed(19 * 3_600_000), "19h");
  assert.equal(formatElapsed(72 * 3_600_000), "3d");
});

test("a working Claude session", () => {
  const s = toAgentSession(scan(), [activity()], NOW, true);
  assert.equal(s.title, "ci hover panel");
  assert.equal(s.agent, "Claude Code");
  assert.equal(s.state, "working");
  assert.equal(s.mode, "auto · bg");
  assert.equal(s.sessionId, "edd464bd");
  assert.equal(s.timer, "2m 14s");
  assert.equal(s.timerLabel, "this turn");
  assert.equal(s.permission, undefined);
  assert.deepEqual(s.repos, [{ name: "git-juggler", branch: "main", commit: "dfb27df0", home: false, lastAt: "just now", tool: { name: "Bash", command: "npm test" } }]);
});

test("an idle session says when it started", () => {
  const s = toAgentSession(scan({ state: "idle" }), [activity()], NOW, true);
  assert.equal(s.state, "idle");
  assert.equal(s.timerLabel, "idle · started 21h ago");
});

test("waiting on a permission prompt shows the pending tool call", () => {
  const s = toAgentSession(scan({ waiting_for: "permission prompt" }), [activity()], NOW, true);
  assert.equal(s.state, "waiting");
  assert.equal(s.timerLabel, "waiting");
  assert.deepEqual(s.permission, { title: "Waiting for permission", tool: "Bash", command: "npm test" });
});

test("waiting on a question has no tool call", () => {
  const s = toAgentSession(scan({ waiting_for: "input needed" }), [activity()], NOW, true);
  assert.deepEqual(s.permission, { title: "Waiting for your input" });
});

test("several worktrees are all listed with home marked; none with the setting off", () => {
  const other = activity({ worktree_path: "C:\\wt\\feature", branch: null, is_home: false });
  assert.deepEqual(toAgentSession(scan(), [activity(), other], NOW, true).repos.map((r) => [r.name, r.branch, r.home]), [["git-juggler", "main", true], ["feature", "detached", false]]);
  const hidden = toAgentSession(scan({ waiting_for: "permission prompt" }), [activity(), other], NOW, false);
  assert.deepEqual(hidden.repos, []);
  // The pending tool call still shows in the waiting box.
  assert.equal(hidden.permission?.command, "npm test");
});

test("a subagent popover keeps parent context", () => {
  const s = toAgentSession(scan({ is_subagent: true, parent_session_id: "parent-1234", parent_title: "Parent task" }), [activity()], NOW, true);
  assert.equal(s.isSubagent, true);
  assert.equal(s.parentLabel, "subagent of Parent task");
});

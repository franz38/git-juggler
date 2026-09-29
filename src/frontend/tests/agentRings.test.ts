import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRepositoryScan, AgentWorktreeActivity } from "../src/api/types.ts";
import { RING_WAIT_MS, agentCommitsMissingFromGraph, placeAgentRings, type RingPlacement } from "../src/lib/agentRings.ts";

const NOW = 1_790_000_000_000;

const activity = (commit: string, over: Partial<AgentWorktreeActivity> = {}): AgentWorktreeActivity => ({
  repository_id: "repo",
  worktree_path: "/w/main",
  branch: "main",
  commit,
  process_ids: [],
  first_seen: NOW,
  last_seen: NOW,
  last_activity: NOW,
  evidence: [],
  activity_score: 1,
  state: "active",
  is_home: true,
  ...over,
});

const scan = (worktrees: AgentWorktreeActivity[], agent_pid = -1): AgentRepositoryScan => ({
  agent_pid,
  session_directory: null,
  worktrees,
  scanned_at: NOW,
  state: "active",
  provider: "claude",
  session_id: String(agent_pid),
  process_pid: null,
  name: null,
  details: null,
  waiting_for: null,
  is_subagent: false,
  parent_session_id: null,
  parent_title: null,
  parent_agent: null,
  parent_provider: null,
});

const graph = (...hashes: string[]) => (hash: string) => hashes.includes(hash);
const hashes = (byHash: Map<string, unknown[]>) => Object.fromEntries([...byHash].map(([hash, rings]) => [hash, rings.length]));

test("a ring goes on its worktree's HEAD, only in the matching repository", () => {
  const scans = [scan([activity("a"), activity("x", { repository_id: "other" })])];
  const { byHash } = placeAgentRings(scans, "repo", graph("a", "x"), new Map(), NOW);
  assert.deepEqual(hashes(byHash), { a: 1 });
});

test("after a commit the ring waits on its previous commit until the graph has the new one", () => {
  const first = placeAgentRings([scan([activity("a")])], "repo", graph("a"), new Map(), NOW);

  // The agent committed "b": activity knows it, the graph doesn't yet.
  const waiting = placeAgentRings([scan([activity("b")])], "repo", graph("a"), first.placements, NOW + 1000);
  assert.deepEqual(hashes(waiting.byHash), { a: 1 });
  assert.equal(waiting.byHash.get("a")?.[0].activity.commit, "b");

  // The graph reloaded: the ring moves.
  const moved = placeAgentRings([scan([activity("b")])], "repo", graph("a", "b"), waiting.placements, NOW + 3000);
  assert.deepEqual(hashes(moved.byHash), { b: 1 });
});

test("a ring stops waiting after RING_WAIT_MS", () => {
  let placements: Map<string, RingPlacement> = placeAgentRings([scan([activity("a")])], "repo", graph("a"), new Map(), NOW).placements;
  placements = placeAgentRings([scan([activity("b")])], "repo", graph("a"), placements, NOW + 1000).placements;
  const stillWaiting = placeAgentRings([scan([activity("b")])], "repo", graph("a"), placements, NOW + RING_WAIT_MS);
  assert.deepEqual(hashes(stillWaiting.byHash), { a: 1 });

  const gone = placeAgentRings([scan([activity("b")])], "repo", graph("a"), stillWaiting.placements, NOW + 1000 + RING_WAIT_MS);
  assert.deepEqual(hashes(gone.byHash), {});
  assert.equal(gone.placements.size, 0);
});

test("rings are tracked per session and worktree", () => {
  const scans = [scan([activity("a"), activity("c", { worktree_path: "/w/feature" })], -1), scan([activity("a")], -2)];
  const first = placeAgentRings(scans, "repo", graph("a", "c"), new Map(), NOW);
  assert.deepEqual(hashes(first.byHash), { a: 2, c: 1 });

  // Only session -1's feature worktree moved to a commit the graph lacks.
  const next = [scan([activity("a"), activity("d", { worktree_path: "/w/feature" })], -1), scan([activity("a")], -2)];
  assert.deepEqual(hashes(placeAgentRings(next, "repo", graph("a", "c"), first.placements, NOW + 1000).byHash), { a: 2, c: 1 });
});

test("a ring with no earlier placement isn't invented", () => {
  const { byHash } = placeAgentRings([scan([activity("b")])], "repo", graph("a"), new Map(), NOW);
  assert.deepEqual(hashes(byHash), {});
});

test("missing HEADs are the reported commits the graph lacks, per repository", () => {
  const scans = [scan([activity("a"), activity("b"), activity("z", { repository_id: "other" })]), scan([activity("b")], -2)];
  assert.deepEqual([...agentCommitsMissingFromGraph(scans, "repo", graph("a"))], ["b"]);
  assert.deepEqual([...agentCommitsMissingFromGraph(scans, "repo", graph("a", "b"))], []);
});

import type { AgentRepositoryScan, AgentWorktreeActivity } from "../api/types.ts";

export interface AgentRing {
  scan: AgentRepositoryScan;
  activity: AgentWorktreeActivity;
}

/** Where one session's ring for one worktree was drawn, carried from one render to the next. */
export interface RingPlacement {
  hash: string;
  /** Since when the worktree's HEAD has been missing from the graph; null while the ring is on it. */
  waitingSince: number | null;
}

/**
 * How long a ring stays on its previous commit waiting for the graph to load
 * the agent's new HEAD. A reload is requested as soon as the HEAD is seen
 * (see agentCommitsMissingFromGraph), so this only bounds the rare HEAD a
 * reload never brings in (older than the loaded pages, a detached commit):
 * then the ring goes rather than pointing at a stale commit indefinitely.
 */
export const RING_WAIT_MS = 60_000;

function ringKey(scan: AgentRepositoryScan, activity: AgentWorktreeActivity): string {
  return `${scan.agent_pid}|${activity.worktree_path}`;
}

/**
 * Which commit each agent ring is drawn on in one repository's graph: the
 * active worktree's HEAD, or the HEAD it had when an idle session stopped.
 * Right after an agent commits, the activity poll reports the new HEAD before
 * the graph has reloaded with it; until it has, the ring stays on the commit it
 * was last drawn on (`previous`) instead of disappearing.
 * Returns the rings by commit, and the placements to pass back as `previous`.
 */
export function placeAgentRings(
  scans: AgentRepositoryScan[],
  repositoryId: string,
  hasCommit: (hash: string) => boolean,
  previous: ReadonlyMap<string, RingPlacement>,
  now: number,
): { byHash: Map<string, AgentRing[]>; placements: Map<string, RingPlacement> } {
  const byHash = new Map<string, AgentRing[]>();
  const placements = new Map<string, RingPlacement>();
  for (const scan of scans) {
    for (const activity of scan.worktrees) {
      if (activity.repository_id !== repositoryId) continue;
      const key = ringKey(scan, activity);
      let placement: RingPlacement | null = null;
      if (hasCommit(activity.commit)) {
        placement = { hash: activity.commit, waitingSince: null };
      } else {
        const last = previous.get(key);
        const waitingSince = last?.waitingSince ?? now;
        if (last && hasCommit(last.hash) && now - waitingSince < RING_WAIT_MS) placement = { hash: last.hash, waitingSince };
      }
      if (!placement) continue;
      placements.set(key, placement);
      const rings = byHash.get(placement.hash) ?? [];
      rings.push({ scan, activity });
      byHash.set(placement.hash, rings);
    }
  }
  return { byHash, placements };
}

/** HEADs agents report in a repository that its loaded graph doesn't contain (yet). */
export function agentCommitsMissingFromGraph(scans: AgentRepositoryScan[], repositoryId: string, hasCommit: (hash: string) => boolean): Set<string> {
  const missing = new Set<string>();
  for (const scan of scans) {
    for (const activity of scan.worktrees) {
      if (activity.repository_id === repositoryId && !hasCommit(activity.commit)) missing.add(activity.commit);
    }
  }
  return missing;
}

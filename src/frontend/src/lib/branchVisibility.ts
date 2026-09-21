import type { CommitSummary } from "../api/types";

// Local branch names present in the loaded history, sorted.
export function branchNames(commits: CommitSummary[]): string[] {
  const names = new Set<string>();
  for (const commit of commits) {
    for (const name of commit.refs.branches) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Start of the given local day (from an <input type="date"> value), or null
// when the field is empty or not a valid date.
export function startOfDayMs(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Which commits a branch filter keeps, or null when no filter is active.
//
// A branch counts when it is checked (or when nothing is checked) and, if a
// date is set, its tip commit is on or after that date, i.e. the branch has
// commits since then. Everything reachable from a kept branch's tip stays, so
// the shown history is connected; the rest of the graph (other branches,
// stashes, commits only reachable from remote refs) is hidden.
export function visibleCommitHashes(commits: CommitSummary[], selected: string[], sinceMs: number | null): Set<string> | null {
  if (selected.length === 0 && sinceMs === null) return null;
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const stack: string[] = [];
  for (const commit of commits) {
    if (commit.refs.branches.length === 0) continue;
    if (selected.length > 0 && !commit.refs.branches.some((name) => selected.includes(name))) continue;
    if (sinceMs !== null && Date.parse(commit.committed_date) < sinceMs) continue;
    stack.push(commit.hash);
  }
  const visible = new Set<string>();
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (visible.has(hash)) continue;
    const commit = byHash.get(hash);
    if (!commit) continue;
    visible.add(hash);
    stack.push(...commit.parents);
  }
  return visible;
}

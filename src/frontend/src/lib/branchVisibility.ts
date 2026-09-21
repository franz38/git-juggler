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
// The filters combine with AND, per branch: a branch is shown only if it is
// checked (or nothing is checked) AND, when a date is set, its tip commit is
// on or after that day (i.e. it has commits since then). A branch that fails
// any filter is not shown at all, even when a branch that passes is built on
// top of it.
//
// A shown branch contributes the commits it owns (`commit.branch`) plus its
// tip commit, so a branch whose tip is owned by another branch (e.g. merged)
// still appears, with its label. Stashes and other branches are hidden.
export function visibleCommitHashes(commits: CommitSummary[], selected: string[], sinceMs: number | null): Set<string> | null {
  if (selected.length === 0 && sinceMs === null) return null;
  const shownBranches = new Set<string>();
  const tips: string[] = [];
  for (const commit of commits) {
    const recentEnough = sinceMs === null || Date.parse(commit.committed_date) >= sinceMs;
    if (!recentEnough) continue;
    for (const name of commit.refs.branches) {
      if (selected.length > 0 && !selected.includes(name)) continue;
      shownBranches.add(name);
      tips.push(commit.hash);
    }
  }
  const visible = new Set(tips);
  for (const commit of commits) {
    if (shownBranches.has(commit.branch)) visible.add(commit.hash);
  }
  return visible;
}

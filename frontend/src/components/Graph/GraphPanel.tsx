import { For, createMemo } from "solid-js";
import {
  COLLAPSED_ROW_HEIGHT,
  activeRepo,
  currentBranch,
  fetchingRepos,
  filteredCommits,
  githubActionsRuns,
  headCommit,
  isDirty,
  openContextMenu,
  pushingRepos,
  rowLayout,
  toggleExpand,
  uncommittedRowHeight,
  upstreamCommit,
} from "../../state/store";
import { colorForBranch, TAG_COLOR } from "./branchColor";
import { computeColumns } from "./computeColumns";

const LANE_MARGIN = 20;
const LANE_WIDTH = 24;
const DOT_RADIUS = 6;
const CORNER_RADIUS = 8;
const GHOST_ROW_HEIGHT = COLLAPSED_ROW_HEIGHT;
const GHOST_RADIUS = 5;
const DIRTY_COLOR = "#8993A4";
const CI_ACTIVE_COLOR = "#4c9aff";

interface Edge {
  key: string;
  d: string;
  color: string;
  isPushing: boolean;
}

// Straight down the child's lane, then a slightly rounded elbow into a
// horizontal jog to the parent's lane — used for the first-parent edge,
// which continues (or starts) a lane rather than merging one in.
function verticalFirstPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1},${y1} L ${x2},${y2}`;
  const radius = Math.min(CORNER_RADIUS, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
  const sign = x2 > x1 ? 1 : -1;
  return `M ${x1},${y1} L ${x1},${y2 - radius} Q ${x1},${y2} ${x1 + sign * radius},${y2} L ${x2},${y2}`;
}

// Jogs sideways out of the merge commit first, then travels down the other
// branch's lane to meet it — the conventional look for a merge's incoming
// edge (as opposed to the lane it continues, see `verticalFirstPath`).
function horizontalFirstPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1},${y1} L ${x2},${y2}`;
  const radius = Math.min(CORNER_RADIUS, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
  const sign = x2 > x1 ? 1 : -1;
  return `M ${x1},${y1} L ${x2 - sign * radius},${y1} Q ${x2},${y1} ${x2},${y1 + radius} L ${x2},${y2}`;
}

export function GraphPanel() {
  const chronological = createMemo(() => filteredCommits());
  const lanes = createMemo(() => computeColumns(chronological(), currentBranch()));
  const commitByHash = createMemo(() => new Map(chronological().map((c) => [c.hash, c])));
  const runningActionsByHash = createMemo(() => {
    const hashes = new Set<string>();
    for (const [hash, runs] of Object.entries(githubActionsRuns())) {
      if (runs.some((run) => run.status === "running")) hashes.add(hash);
    }
    return hashes;
  });

  const isFetching = createMemo(() => {
    const repo = activeRepo();
    return repo !== null && fetchingRepos().has(repo);
  });
  const isPushing = createMemo(() => {
    const repo = activeRepo();
    return repo !== null && pushingRepos().has(repo);
  });
  const hasDirtyGhost = createMemo(() => isDirty() && headCommit() !== null);
  const dirtyOffset = createMemo(() => (hasDirtyGhost() ? uncommittedRowHeight() : 0));
  const fetchOffset = createMemo(() => dirtyOffset() + (isFetching() ? GHOST_ROW_HEIGHT : 0));
  const commitOffset = createMemo(() => fetchOffset());
  const fetchGhostY = createMemo(() => dirtyOffset() + GHOST_ROW_HEIGHT / 2);
  const dirtyGhostY = createMemo(() => uncommittedRowHeight() / 2);

  const columnFor = (hash: string) => lanes().get(hash)?.column ?? 0;
  const xForColumn = (column: number) => LANE_MARGIN + column * LANE_WIDTH;
  const xFor = (hash: string) => xForColumn(columnFor(hash));
  const yFor = (hash: string) => {
    const offset = rowLayout().offsetByHash.get(hash) ?? 0;
    return commitOffset() + offset + COLLAPSED_ROW_HEIGHT / 2;
  };

  const pushingEdges = createMemo(() => {
    if (!isPushing()) return new Set<string>();
    const head = headCommit();
    const upstream = upstreamCommit();
    if (!head || !upstream || head === upstream) return new Set<string>();
    const byHash = commitByHash();
    const keys = new Set<string>();
    let cursor: string | undefined = head;
    const seen = new Set<string>();
    while (cursor && cursor !== upstream && !seen.has(cursor)) {
      seen.add(cursor);
      const commit = byHash.get(cursor);
      const parent = commit?.parents[0];
      if (!parent) return new Set<string>();
      keys.add(`${cursor}-${parent}`);
      cursor = parent;
    }
    return cursor === upstream ? keys : new Set<string>();
  });

  // One "ghost" marker per branch tip's lane, sitting in the reserved band
  // above the graph while a fetch is running — we don't know yet whether
  // that branch got new commits, so it's just a placeholder, not tied to a
  // real commit.
  const ghostMarkers = createMemo(() => {
    if (!isFetching()) return [];
    const columnColor = new Map<number, string>();
    const columnTopY = new Map<number, number>();
    for (const c of chronological()) {
      const column = columnFor(c.hash);
      const y = yFor(c.hash);
      const currentTop = columnTopY.get(column);
      if (currentTop === undefined || y < currentTop) columnTopY.set(column, y);
      if (c.refs.branches.length > 0 && !columnColor.has(column)) {
        columnColor.set(column, colorForBranch(c.refs.branches[0]));
      }
    }
    return [...columnColor.entries()].map(([column, color]) => ({
      column,
      color,
      x: xForColumn(column),
      topY: columnTopY.get(column) ?? fetchGhostY(),
    }));
  });

  const edges = createMemo<Edge[]>(() => {
    const byHash = commitByHash();
    const segs: Edge[] = [];
    for (const c of chronological()) {
      c.parents.forEach((parentHash, idx) => {
        const parent = byHash.get(parentHash);
        if (!parent) return; // parent outside the loaded history, ignore
        const x1 = xFor(c.hash);
        const y1 = yFor(c.hash);
        const x2 = xFor(parentHash);
        const y2 = yFor(parentHash);
        const isMergeEdge = idx > 0;
        segs.push({
          key: `${c.hash}-${parentHash}`,
          d: isMergeEdge ? horizontalFirstPath(x1, y1, x2, y2) : verticalFirstPath(x1, y1, x2, y2),
          color: isMergeEdge ? colorForBranch(parent.branch) : colorForBranch(c.branch),
          isPushing: pushingEdges().has(`${c.hash}-${parentHash}`),
        });
      });
    }
    return segs;
  });

  const width = createMemo(() => {
    let max = 0;
    for (const c of chronological()) max = Math.max(max, xFor(c.hash));
    return max + LANE_MARGIN + DOT_RADIUS + 16;
  });

  return (
    <svg class="graph-panel" width={width()} height={commitOffset() + rowLayout().total}>
      {hasDirtyGhost() && headCommit() && (
        <g class="dirty-ghost">
          <line x1={xFor(headCommit()!)} y1={dirtyGhostY()} x2={xFor(headCommit()!)} y2={yFor(headCommit()!)} stroke={DIRTY_COLOR} stroke-width="2" stroke-dasharray="2 3" opacity="0.5" />
          <circle cx={xFor(headCommit()!)} cy={dirtyGhostY()} r={GHOST_RADIUS} fill="var(--panel-bg)" stroke={DIRTY_COLOR} stroke-width="2" stroke-dasharray="3 3" opacity="0.9" />
        </g>
      )}
      <For each={ghostMarkers()}>
        {(ghost) => (
          <g class="ghost-commit">
            <line x1={ghost.x} y1={fetchGhostY()} x2={ghost.x} y2={ghost.topY} stroke={ghost.color} stroke-width="2" stroke-dasharray="2 3" opacity="0.5" />
            <circle cx={ghost.x} cy={fetchGhostY()} r={GHOST_RADIUS} fill="none" stroke={ghost.color} stroke-width="2" stroke-dasharray="3 3" opacity="0.8">
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${ghost.x} ${fetchGhostY()}`}
                to={`360 ${ghost.x} ${fetchGhostY()}`}
                dur="0.9s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        )}
      </For>
      <For each={edges()}>
        {(seg) => (
          <path class={seg.isPushing ? "push-edge" : undefined} d={seg.d} fill="none" stroke={seg.color} stroke-width="2" stroke-linecap="round" />
        )}
      </For>
      <For each={rowLayout().order}>
        {(c) => {
          const isCheckedOut = () => headCommit() === c.hash;
          return (
            <g>
              <circle
                cx={xFor(c.hash)}
                cy={yFor(c.hash)}
                r={DOT_RADIUS}
                fill={isCheckedOut() ? "var(--panel-bg)" : colorForBranch(c.branch)}
                stroke={isCheckedOut() ? colorForBranch(c.branch) : "var(--panel-bg)"}
                stroke-width={isCheckedOut() ? 3 : 2}
                style={{ cursor: "pointer" }}
                onClick={() => toggleExpand(c.hash)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, c.hash);
                }}
              />
              {isPushing() && headCommit() === c.hash && (
                <circle class="push-spinner" cx={xFor(c.hash)} cy={yFor(c.hash)} r={DOT_RADIUS + 4} fill="none" stroke={colorForBranch(c.branch)} stroke-width="2" stroke-dasharray="10 5">
                  <animateTransform attributeName="transform" type="rotate" from={`0 ${xFor(c.hash)} ${yFor(c.hash)}`} to={`360 ${xFor(c.hash)} ${yFor(c.hash)}`} dur="0.85s" repeatCount="indefinite" />
                </circle>
              )}
              {runningActionsByHash().has(c.hash) && (
                <circle class="ci-active-dot" cx={xFor(c.hash) + DOT_RADIUS + 4} cy={yFor(c.hash)} r="2" fill={CI_ACTIVE_COLOR}>
                  <animateTransform attributeName="transform" type="rotate" from={`0 ${xFor(c.hash)} ${yFor(c.hash)}`} to={`360 ${xFor(c.hash)} ${yFor(c.hash)}`} dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}
              {c.refs.tags.length > 0 && <circle cx={xFor(c.hash) + DOT_RADIUS + 2} cy={yFor(c.hash) - DOT_RADIUS} r={3} fill={TAG_COLOR} />}
            </g>
          );
        }}
      </For>
    </svg>
  );
}

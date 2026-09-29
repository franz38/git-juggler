import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useOverlay } from "../../state/overlayStack";
import { scrollToCommit } from "../../lib/scrollToCommit";
import { swallowNextClick } from "../../lib/swallowNextClick";
import {
  branchFilters,
  commitAuthors,
  commitBranches,
  commitFilters,
  commits,
  countBranchFilters,
  countCommitFilters,
  filteredCommits,
  matchingHashes,
  searchQuery,
  setBranchFilters,
  setCommitFilters,
  setSearchQuery,
} from "../../state/store";
import { activeTheme } from "../../state/themes";
import { colorForBranch } from "../Graph/branchColor";
import { BranchFilterPopover, CommitFilterPopover, CommitSearch, FilterButtons, type FilterPanel } from "../GraphToolbar/GraphToolbar";

// Authors have no lane of their own; hash the name into the theme's branch
// palette so the same person keeps the same avatar color.
function authorColor(name: string): string {
  const palette = activeTheme().branchPalette;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

// "3d", "5h", "now" — how long ago a branch last had a commit.
function ageLabel(iso: string): string {
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return minutes < 1 ? "now" : `${Math.floor(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  const days = minutes / (60 * 24);
  if (days < 365) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 365)}y`;
}

export function SearchBox() {
  // Only one of the two popovers (commit filter / branch visibility) is open at a time.
  const [openPanel, setOpenPanel] = createSignal<FilterPanel>(null);
  const togglePanel = (panel: Exclude<FilterPanel, null>) => setOpenPanel((current) => (current === panel ? null : panel));
  let inputRef: HTMLInputElement | undefined;

  // Esc closes the open popover (via the shared overlay stack), and so does a
  // click anywhere outside it. Clicks on the toggle buttons are left to their
  // own handlers so a second click still closes the panel.
  useOverlay("search-popover", () => openPanel() !== null, () => setOpenPanel(null));
  createEffect(() => {
    if (openPanel() === null) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".filter-popover, .filter-button, .multiselect-panel")) return;
      // Closing the popover is all a click on the graph should do: it must not
      // also select the commit underneath.
      if (e.button === 0 && target?.closest(".graph-and-list")) swallowNextClick();
      setOpenPanel(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onPointerDown));
  });

  // ⌘F / Ctrl+F jumps to the commit search instead of the webview's find bar.
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      inputRef?.focus();
      inputRef?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const authors = createMemo(() => commitAuthors().map((name) => ({ name, color: authorColor(name) })));

  const lastActiveByBranch = createMemo(() => {
    const latest = new Map<string, number>();
    for (const commit of commits()) {
      const time = new Date(commit.committed_date).getTime();
      if (time > (latest.get(commit.branch) ?? 0)) latest.set(commit.branch, time);
    }
    return latest;
  });
  const branches = createMemo(() =>
    commitBranches().map((name) => {
      const time = lastActiveByBranch().get(name);
      return { name, color: colorForBranch(name), lastActive: time ? ageLabel(new Date(time).toISOString()) : undefined };
    }),
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const matches = matchingHashes();
    if (matches.size !== 1) return;
    const [hash] = matches;
    scrollToCommit(hash);
  };

  const popoverPosition = { position: "absolute", top: "calc(100% + 6px)", right: "10px", "z-index": 25 } as const;

  return (
    <div class="search-box">
      <CommitSearch
        ref={(el) => (inputRef = el)}
        value={searchQuery()}
        onInput={setSearchQuery}
        onKeyDown={handleKeyDown}
        count={matchingHashes().size}
        placeholder="Search commits…"
        width="240px"
      />
      <FilterButtons open={openPanel()} onToggle={togglePanel} commitCount={countCommitFilters(commitFilters())} branchCount={countBranchFilters(branchFilters())} />
      <Show when={openPanel() === "commit"}>
        <CommitFilterPopover
          style={popoverPosition}
          value={commitFilters()}
          onChange={setCommitFilters}
          authors={authors()}
          matchLabel={`${filteredCommits().length} of ${commits().length} commits`}
          onDone={() => setOpenPanel(null)}
        />
      </Show>
      <Show when={openPanel() === "branch"}>
        <BranchFilterPopover style={popoverPosition} value={branchFilters()} onChange={setBranchFilters} branches={branches()} onDone={() => setOpenPanel(null)} />
      </Show>
    </div>
  );
}

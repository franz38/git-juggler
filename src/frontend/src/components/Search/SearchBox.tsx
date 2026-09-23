import { Show, createSignal } from "solid-js";
import { scrollToCommit } from "../../lib/scrollToCommit";
import {
  authorFilter,
  branchFilter,
  branchSince,
  clearBranchFilters,
  commentFilter,
  commitAuthors,
  commitBranches,
  matchingHashes,
  searchQuery,
  setAuthorFilter,
  setBranchFilter,
  setBranchSince,
  setCommentFilter,
  setSearchQuery,
  setTagFilter,
  tagFilter,
} from "../../state/store";
import { MultiSelect } from "./MultiSelect";
import { TriSwitch } from "./TriSwitch";

export function SearchBox() {
  // Only one of the two popovers (commit filter / branch visibility) is open at a time.
  const [openPanel, setOpenPanel] = createSignal<"filter" | "branches" | null>(null);
  const togglePanel = (panel: "filter" | "branches") => setOpenPanel((current) => (current === panel ? null : panel));
  const activeFilterCount = () => (authorFilter().length > 0 ? 1 : 0) + (commentFilter().trim().length > 0 ? 1 : 0) + (tagFilter() !== "unset" ? 1 : 0);
  const activeBranchFilterCount = () => (branchFilter().length > 0 ? 1 : 0) + (branchSince() ? 1 : 0);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const matches = matchingHashes();
    if (matches.size !== 1) return;
    const [hash] = matches;
    scrollToCommit(hash);
  };

  return (
    <div class="search-box">
      <input
        type="text"
        class="search-input"
        placeholder="Search commits…"
        value={searchQuery()}
        onInput={(e) => setSearchQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <Show when={searchQuery().trim().length > 0}>
        <span class="search-count">{matchingHashes().size}</span>
      </Show>
      <button
        type="button"
        class="filter-button"
        classList={{ active: activeFilterCount() > 0 }}
        title="Filter commits"
        onClick={() => togglePanel("filter")}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2 3h12L9.5 8v4l-3 1V8L2 3z" fill="currentColor" />
        </svg>
        <Show when={activeFilterCount() > 0}>
          <span class="filter-count">{activeFilterCount()}</span>
        </Show>
      </button>
      <button
        type="button"
        class="filter-button"
        classList={{ active: activeBranchFilterCount() > 0 }}
        title="Choose which branches are shown"
        onClick={() => togglePanel("branches")}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
        <Show when={activeBranchFilterCount() > 0}>
          <span class="filter-count">{activeBranchFilterCount()}</span>
        </Show>
      </button>
      <Show when={openPanel() === "filter"}>
        <div class="filter-popover">
          <label class="filter-field">
            <span>Comment contains</span>
            <input
              type="text"
              value={commentFilter()}
              placeholder="Text in commit comment"
              onInput={(e) => setCommentFilter(e.currentTarget.value)}
            />
          </label>
          <div class="filter-field">
            <span>Author</span>
            <MultiSelect options={commitAuthors()} selected={authorFilter()} onChange={setAuthorFilter} placeholder="All authors" />
          </div>
          <div class="filter-field">
            <span>Has tag</span>
            <TriSwitch value={tagFilter()} onChange={setTagFilter} labels={{ unset: "Any" }} />
          </div>
          <button type="button" class="filter-clear-button" onClick={() => setAuthorFilter([])}>
            Clear authors
          </button>
        </div>
      </Show>
      <Show when={openPanel() === "branches"}>
        <div class="filter-popover">
          <div class="filter-field">
            <span>Branches</span>
            <MultiSelect options={commitBranches()} selected={branchFilter()} onChange={setBranchFilter} placeholder="All branches" />
          </div>
          <label class="filter-field">
            <span>Commits since</span>
            <input type="date" value={branchSince()} onInput={(e) => setBranchSince(e.currentTarget.value)} />
          </label>
          <p class="filter-hint">
            Only branches that match every filter are shown: checked in the list (if any are) and with a commit on or after the date (if set).
          </p>
          <button type="button" class="filter-clear-button" onClick={clearBranchFilters}>
            Clear
          </button>
        </div>
      </Show>
    </div>
  );
}

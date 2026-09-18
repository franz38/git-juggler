import { For, Show, createSignal } from "solid-js";
import { scrollToCommit } from "../../lib/scrollToCommit";
import { authorFilter, commentFilter, commitAuthors, matchingHashes, searchQuery, setAuthorFilter, setCommentFilter, setSearchQuery } from "../../state/store";

export function SearchBox() {
  const [filterOpen, setFilterOpen] = createSignal(false);
  const activeFilterCount = () => (authorFilter().length > 0 ? 1 : 0) + (commentFilter().trim().length > 0 ? 1 : 0);
  const setSelectedAuthors = (select: HTMLSelectElement) => {
    setAuthorFilter([...select.selectedOptions].map((option) => option.value));
  };

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
        onClick={() => setFilterOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2 3h12L9.5 8v4l-3 1V8L2 3z" fill="currentColor" />
        </svg>
        <Show when={activeFilterCount() > 0}>
          <span class="filter-count">{activeFilterCount()}</span>
        </Show>
      </button>
      <Show when={filterOpen()}>
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
          <label class="filter-field">
            <span>Author</span>
            <select multiple onChange={(e) => setSelectedAuthors(e.currentTarget)}>
              <For each={commitAuthors()}>
                {(author) => <option value={author} selected={authorFilter().includes(author)}>{author}</option>}
              </For>
            </select>
          </label>
          <button type="button" class="filter-clear-button" onClick={() => setAuthorFilter([])}>
            Clear authors
          </button>
        </div>
      </Show>
    </div>
  );
}

import { For, Show, createSignal } from "solid-js";
import { scrollToCommit } from "../../lib/scrollToCommit";
import { authorFilter, commitAuthors, matchingHashes, searchQuery, setAuthorFilter, setSearchQuery } from "../../state/store";

export function SearchBox() {
  const [filterOpen, setFilterOpen] = createSignal(false);

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
        classList={{ active: authorFilter() !== null }}
        title="Filter commits"
        onClick={() => setFilterOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2 3h12L9.5 8v4l-3 1V8L2 3z" fill="currentColor" />
        </svg>
      </button>
      <Show when={filterOpen()}>
        <div class="filter-popover">
          <div class="filter-title">Author</div>
          <button
            type="button"
            class="filter-option"
            classList={{ active: authorFilter() === null }}
            onClick={() => {
              setAuthorFilter(null);
              setFilterOpen(false);
            }}
          >
            All authors
          </button>
          <For each={commitAuthors()}>
            {(author) => (
              <button
                type="button"
                class="filter-option"
                classList={{ active: authorFilter() === author }}
                onClick={() => {
                  setAuthorFilter(author);
                  setFilterOpen(false);
                }}
              >
                {author}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

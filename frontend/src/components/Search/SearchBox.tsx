import { Show } from "solid-js";
import { scrollToCommit } from "../../lib/scrollToCommit";
import { matchingHashes, searchQuery, setSearchQuery } from "../../state/store";

export function SearchBox() {
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
    </div>
  );
}

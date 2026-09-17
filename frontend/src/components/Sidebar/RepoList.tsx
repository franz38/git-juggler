import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import type { RepoSummary } from "../../api/types";
import {
  activeRepo,
  loadConfig,
  loadRepos,
  openRepoContextMenu,
  openRepoTab,
  pinTab,
  pinnedRepos,
  repos,
  toggleRepoPinned,
} from "../../state/store";

function RepoRow(props: { repo: RepoSummary }) {
  const isPinned = () => pinnedRepos().has(props.repo.path);

  return (
    <div
      class="repo-item"
      title={props.repo.path}
      classList={{ active: activeRepo() === props.repo.id }}
      onClick={() => openRepoTab(props.repo.id, props.repo.name)}
      onDblClick={() => {
        openRepoTab(props.repo.id, props.repo.name);
        pinTab(props.repo.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openRepoContextMenu(e.clientX, e.clientY, props.repo.id, props.repo.name);
      }}
    >
      <span
        class="repo-pin"
        classList={{ pinned: isPinned() }}
        title={isPinned() ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          void toggleRepoPinned(props.repo.path);
        }}
      >
        {isPinned() ? "★" : "☆"}
      </span>
      <span class="repo-names">
        <span class="repo-name">{props.repo.name}</span>
        <Show when={props.repo.current_branch}>
          <span class="repo-branch">{props.repo.current_branch}</span>
        </Show>
      </span>
    </div>
  );
}

export function RepoList() {
  onMount(() => {
    void loadRepos();
    void loadConfig();
  });

  const [query, setQuery] = createSignal("");
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    return q ? repos().filter((r) => r.name.toLowerCase().includes(q)) : repos();
  });
  const pinned = createMemo(() => filtered().filter((r) => pinnedRepos().has(r.path)));
  const unpinned = createMemo(() => filtered().filter((r) => !pinnedRepos().has(r.path)));

  return (
    <div class="repo-list">
      <div class="repo-search">
        <input
          type="text"
          placeholder="Filter repos…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <Show when={pinned().length > 0}>
        <h2>Pinned</h2>
        <For each={pinned()}>{(repo) => <RepoRow repo={repo} />}</For>
      </Show>
      <h2>Repositories</h2>
      <For each={unpinned()} fallback={<div class="repo-empty">No git repos found</div>}>
        {(repo) => <RepoRow repo={repo} />}
      </For>
    </div>
  );
}

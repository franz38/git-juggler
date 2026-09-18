import { For, Show, createMemo } from "solid-js";
import { COLLAPSED_ROW_HEIGHT, activeRepo, errorMessage, fetchingRepos, graphLoading, headCommit, isDirty, rowLayout, uncommittedFiles } from "../../state/store";
import { CommitRow } from "./CommitRow";
import { UncommittedRow } from "./UncommittedRow";

export function CommitList() {
  const isFetching = createMemo(() => {
    const repo = activeRepo();
    return repo !== null && fetchingRepos().has(repo);
  });
  const hasCommits = createMemo(() => rowLayout().order.length > 0);

  return (
    <div class="commit-list">
      <Show when={errorMessage()}>
        <div class="error-banner">{errorMessage()}</div>
      </Show>
      <Show when={graphLoading() && !hasCommits()}>
        <div class="loading-banner">Loading commits…</div>
      </Show>
      <Show when={isDirty() && headCommit() !== null}>
        <UncommittedRow files={uncommittedFiles()} />
      </Show>
      {/* Matches the graph's reserved ghost-commit band so rows stay aligned
          with their dots while a fetch is running. */}
      <Show when={isFetching()}>
        <div class="ghost-row-spacer" style={{ height: `${COLLAPSED_ROW_HEIGHT}px` }}>
          Fetching…
        </div>
      </Show>
      <For each={rowLayout().order}>{(commit) => <CommitRow commit={commit} />}</For>
    </div>
  );
}

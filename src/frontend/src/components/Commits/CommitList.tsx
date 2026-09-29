import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js";
import { COLLAPSED_ROW_HEIGHT, errorMessageForRepo, fetchingRepos, graphHasMoreForRepo, graphLoadingForRepo, graphLoadingMoreForRepo, loadMoreCommits, rowLayoutForRepo, uncommittedFilesForRepo, workingTreeVisibleForRepo } from "../../state/store";
import { CommitRow } from "./CommitRow";
import { UncommittedRow } from "./UncommittedRow";

// How far below the viewport the end of the list may be before the next page
// is requested, so it's usually there by the time the user scrolls to it.
const LOAD_MORE_MARGIN_PX = 600;

export function CommitList(props: { repoId: string }) {
  let sentinel: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;

  onMount(() => {
    if (!sentinel) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        void loadMoreCommits(props.repoId);
      },
      { root: sentinel.closest(".graph-and-list"), rootMargin: `0px 0px ${LOAD_MORE_MARGIN_PX}px 0px` },
    );
    observer.observe(sentinel);
  });
  onCleanup(() => observer?.disconnect());

  // O(rows), so computed once per change and shared by the reads below.
  const rowLayout = createMemo(() => rowLayoutForRepo(props.repoId));

  // An observer only reports when visibility *changes*. If the end of the list
  // is still in view after a page lands (a tall window, or filters hiding most
  // rows), nothing would fire again, so re-observe to get a fresh report.
  createEffect(
    on(
      [() => rowLayout().order.length, () => graphHasMoreForRepo(props.repoId), () => graphLoadingMoreForRepo(props.repoId), () => props.repoId],
      () => {
        if (!observer || !sentinel) return;
        observer.unobserve(sentinel);
        observer.observe(sentinel);
      },
      { defer: true },
    ),
  );

  const isFetching = createMemo(() => {
    return fetchingRepos().has(props.repoId);
  });
  const hasCommits = createMemo(() => rowLayout().order.length > 0);

  return (
    <div class="commit-list">
      <Show when={errorMessageForRepo(props.repoId)}>
        <div class="error-banner">{errorMessageForRepo(props.repoId)}</div>
      </Show>
      <Show when={graphLoadingForRepo(props.repoId) && !hasCommits()}>
        <div class="loading-banner">Loading commits…</div>
      </Show>
      <Show when={workingTreeVisibleForRepo(props.repoId)}>
        <UncommittedRow repoId={props.repoId} files={uncommittedFilesForRepo(props.repoId)} />
      </Show>
      {/* Matches the graph's reserved ghost-commit band so rows stay aligned
          with their dots while a fetch is running. Stays mounted (collapsed
          via max-height) so it animates open/closed instead of snapping the
          rows below it into place. */}
      <div
        class="ghost-row-spacer"
        classList={{ "ghost-row-spacer--visible": isFetching() }}
        style={{ "--ghost-row-height": `${COLLAPSED_ROW_HEIGHT}px` }}
      >
        Fetching…
      </div>
      <For each={rowLayout().order}>{(commit) => <CommitRow repoId={props.repoId} commit={commit} />}</For>
      <div
        ref={sentinel}
        class="load-more-sentinel"
        classList={{ "load-more-sentinel--visible": graphLoadingMoreForRepo(props.repoId) }}
        style={{ "--load-more-height": `${COLLAPSED_ROW_HEIGHT}px` }}
      >
        <Show when={graphLoadingMoreForRepo(props.repoId)}>Loading older commits…</Show>
      </div>
    </div>
  );
}

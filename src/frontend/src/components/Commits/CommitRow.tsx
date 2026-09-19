import { For, Show, onCleanup, onMount } from "solid-js";
import type { CommitSummary } from "../../api/types";
import { formatDate } from "../../lib/formatDate";
import {
  COLLAPSED_ROW_HEIGHT,
  commitDetails,
  expandedHashes,
  githubActionsRuns,
  matchingHashes,
  openBranchContextMenu,
  openContextMenu,
  openTagContextMenu,
  reportRowHeight,
  toggleExpand,
} from "../../state/store";
import { BranchBadge } from "../Badges/BranchBadge";
import { GitHubActionsBadge } from "../Badges/GitHubActionsBadge";
import { StashBadge } from "../Badges/StashBadge";
import { TagBadge } from "../Badges/TagBadge";
import { CommitDetailView } from "./CommitDetail";

export function CommitRow(props: { commit: CommitSummary }) {
  let rowRef: HTMLDivElement | undefined;
  const isExpanded = () => expandedHashes().has(props.commit.hash);
  const isMatch = () => matchingHashes().has(props.commit.hash);
  const actionsRuns = () => githubActionsRuns()[props.commit.hash] ?? [];
  const openRowContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, props.commit.hash);
  };
  const openBranchMenu = (name: string, remote: boolean) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openBranchContextMenu(e.clientX, e.clientY, name, remote);
  };
  const openTagMenu = (name: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTagContextMenu(e.clientX, e.clientY, name);
  };

  // The graph SVG stacks its dots using each row's real rendered height
  // (not an estimate) so it can never drift out of alignment with the list.
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (rowRef) reportRowHeight(props.commit.hash, rowRef.getBoundingClientRect().height);
    });
    observer.observe(rowRef!);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      id={`commit-row-${props.commit.hash}`}
      ref={rowRef}
      class="commit-row"
      classList={{ expanded: isExpanded(), match: isMatch() }}
      onContextMenu={openRowContextMenu}
    >
      <div
        class="commit-row-main"
        style={{ height: `${COLLAPSED_ROW_HEIGHT}px` }}
        onClick={() => toggleExpand(props.commit.hash)}
      >
        <span class="commit-refs">
          <For each={props.commit.refs.branches}>{(b) => <BranchBadge name={b} onContextMenu={openBranchMenu(b, false)} />}</For>
          <For each={props.commit.refs.remote_branches}>{(b) => <BranchBadge name={b} remote onContextMenu={openBranchMenu(b, true)} />}</For>
          <For each={props.commit.refs.tags}>{(t) => <TagBadge name={t} onContextMenu={openTagMenu(t)} />}</For>
          <For each={props.commit.refs.stashes}>{(s) => <StashBadge name={s} />}</For>
          <Show when={actionsRuns().length > 0}>
            <GitHubActionsBadge runs={actionsRuns()} />
          </Show>
        </span>
        <span class="commit-subject">{props.commit.subject}</span>
        <span class="commit-date">{formatDate(props.commit.authored_date)}</span>
        <span class="commit-author">{props.commit.author.name}</span>
        <span class="commit-hash mono">{props.commit.short_hash}</span>
      </div>
      <Show when={isExpanded()}>
        <CommitDetailView detail={commitDetails()[props.commit.hash]} />
      </Show>
    </div>
  );
}

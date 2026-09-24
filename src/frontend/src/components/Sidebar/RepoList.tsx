import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { RepoSummary } from "../../api/types";
import { flipTranslate } from "../../lib/flip";
import {
  activeRepo,
  agentActivityByRepositoryId,
  agentActivityByWorktreePath,
  openNewGroupModal,
  fetchRepo,
  loadConfig,
  loadRepos,
  moveRepoGroup,
  moveRepoInGroup,
  openRepoContextMenu,
  openRepoTab,
  pinTab,
  pinnedRepos,
  repoGroups,
  repos,
  reposFound,
  reposLoading,
  setRepoInGroup,
  setRepoPinned,
} from "../../state/store";

interface BookmarkMenuState {
  repo: RepoSummary;
  x: number;
  y: number;
}

interface BulkMenuState {
  x: number;
  y: number;
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5C4 1.7 4.7 1 5.5 1h5c.8 0 1.5.7 1.5 1.5V15l-4-2.4L4 15V2.5Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function RepoRow(props: {
  repo: RepoSummary;
  groupId?: string;
  selected: boolean;
  onSelectedChange: (repoPath: string, selected: boolean) => void;
  onBookmarkClick: (repo: RepoSummary, x: number, y: number) => void;
  disableRepoDrag?: boolean;
  dragging?: boolean;
  onRepoRef?: (el: HTMLDivElement) => void;
  onRepoDragStart?: () => void;
  onRepoDragOver?: (event: DragEvent) => void;
  onRepoDrop?: () => void;
  onRepoDragEnd?: () => void;
}) {
  const isPinned = () => pinnedRepos().has(props.repo.path);
  const agentActivity = () => agentActivityByWorktreePath().get(props.repo.path) ?? agentActivityByRepositoryId().get(props.repo.repository_id)?.[0];

  return (
    <div
      ref={(el) => props.onRepoRef?.(el)}
      class="repo-item"
      draggable={Boolean(props.groupId) && !props.disableRepoDrag}
      title={props.repo.path}
      classList={{ active: activeRepo() === props.repo.id, dragging: Boolean(props.dragging) }}
      onDragStart={(e) => {
        if (!props.groupId || props.disableRepoDrag) return;
        e.dataTransfer?.setData("text/plain", props.repo.path);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        props.onRepoDragStart?.();
      }}
      onDragOver={(e) => {
        if (!props.groupId || props.disableRepoDrag) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        props.onRepoDragOver?.(e);
      }}
      onDrop={(e) => {
        if (!props.groupId || props.disableRepoDrag) return;
        e.preventDefault();
        e.stopPropagation();
        props.onRepoDrop?.();
      }}
      onDragEnd={() => props.onRepoDragEnd?.()}
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
      <button
        type="button"
        class="repo-bookmark"
        classList={{ pinned: isPinned() }}
        title="Organize repo"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          props.onBookmarkClick(props.repo, rect.left, rect.bottom + 4);
        }}
      >
        <BookmarkIcon />
      </button>
      <span class="repo-names">
        <span class="repo-name-line">
          <span class="repo-name">{props.repo.name}</span>
          <Show when={agentActivity()}>
            {(activity) => <span class="repo-agent-dot" classList={{ idle: activity().state === "idle" }} title={`Agent ${activity().state}`} />}
          </Show>
        </span>
        <Show when={props.repo.current_branch}>
          <span class="repo-branch">{props.repo.current_branch}</span>
        </Show>
      </span>
      <input
        type="checkbox"
        class="repo-select"
        checked={props.selected}
        title="Select repo"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          props.onSelectedChange(props.repo.path, e.currentTarget.checked);
        }}
      />
    </div>
  );
}

function GroupCheckbox(props: { checked: boolean; indeterminate: boolean; onChange: (checked: boolean) => void }) {
  let input: HTMLInputElement | undefined;

  createEffect(() => {
    if (input) input.indeterminate = props.indeterminate;
  });

  return (
    <input
      ref={input}
      type="checkbox"
      class="repo-group-select"
      checked={props.checked}
      title="Select group repos"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.currentTarget.checked)}
    />
  );
}

function BookmarkMenu(props: { state: BookmarkMenuState; onClose: () => void }) {
  const isPinned = () => pinnedRepos().has(props.state.repo.path);

  function createGroupForRepo(): void {
    props.onClose();
    openNewGroupModal(props.state.repo.path);
  }

  return (
    <div class="repo-bookmark-overlay" onClick={props.onClose}>
      <div
        class="repo-bookmark-menu"
        style={{ left: `${props.state.x}px`, top: `${props.state.y}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="repo-bookmark-menu-item"
          onClick={() => {
            void setRepoPinned(props.state.repo.path, !isPinned());
            props.onClose();
          }}
        >
          <span>{isPinned() ? "✓" : ""}</span>
          <span>Pin</span>
        </button>
        <Show when={repoGroups().length > 0}>
          <div class="repo-bookmark-menu-separator" />
          <For each={repoGroups()}>
            {(group) => {
              const inGroup = () => group.repo_paths.includes(props.state.repo.path);
              return (
                <button
                  type="button"
                  class="repo-bookmark-menu-item"
                  onClick={() => {
                    void setRepoInGroup(group.id, props.state.repo.path, !inGroup());
                    props.onClose();
                  }}
                >
                  <span>{inGroup() ? "✓" : ""}</span>
                  <span>{group.name}</span>
                </button>
              );
            }}
          </For>
        </Show>
        <div class="repo-bookmark-menu-separator" />
        <button type="button" class="repo-bookmark-menu-item" onClick={createGroupForRepo}>
          <span>+</span>
          <span>Create new group</span>
        </button>
      </div>
    </div>
  );
}

function BulkMenu(props: { state: BulkMenuState; selectedCount: number; onFetch: () => void; onClose: () => void }) {
  return (
    <div class="repo-bookmark-overlay" onClick={props.onClose}>
      <div class="repo-bookmark-menu" style={{ left: `${props.state.x}px`, top: `${props.state.y}px` }} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="repo-bookmark-menu-item"
          disabled={props.selectedCount === 0}
          onClick={() => {
            props.onFetch();
            props.onClose();
          }}
        >
          <span>⇣</span>
          <span>Fetch</span>
        </button>
      </div>
    </div>
  );
}

export function RepoList() {
  onMount(() => {
    void loadRepos();
    void loadConfig();
  });

  const [query, setQuery] = createSignal("");
  const [bookmarkMenu, setBookmarkMenu] = createSignal<BookmarkMenuState | null>(null);
  const [bulkMenu, setBulkMenu] = createSignal<BulkMenuState | null>(null);
  const [selectedRepoPaths, setSelectedRepoPaths] = createSignal<Set<string>>(new Set());
  const [draggedGroupId, setDraggedGroupId] = createSignal<string | null>(null);
  const groupHeadingElements = new Map<string, HTMLElement>();
  const [draggedRepo, setDraggedRepo] = createSignal<{ groupId: string; repoPath: string } | null>(null);
  const repoElements = new Map<string, HTMLElement>();
  const [collapsedGroupIds, setCollapsedGroupIds] = createSignal<Set<string>>(new Set());
  // moveRepoGroup/moveRepoInGroup round-trip through the backend before the
  // local state (and thus the DOM order) actually updates, so guard against
  // overlapping swap requests from rapid-fire dragover events while one is
  // in flight.
  let groupSwapPending = false;
  let repoSwapPending = false;

  function toggleGroupCollapsed(groupId: string): void {
    const next = new Set(collapsedGroupIds());
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setCollapsedGroupIds(next);
  }
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    return q ? repos().filter((r) => r.name.toLowerCase().includes(q)) : repos();
  });
  const repoByPath = createMemo(() => new Map(repos().map((repo) => [repo.path, repo])));
  const pinned = createMemo(() => filtered().filter((r) => pinnedRepos().has(r.path)));
  const unpinned = createMemo(() => filtered().filter((r) => !pinnedRepos().has(r.path)));
  const filteredGroups = createMemo(() => {
    const hasQuery = query().trim().length > 0;
    const filteredPaths = new Set(filtered().map((repo) => repo.path));
    const byPath = repoByPath();
    return repoGroups()
      .map((group) => ({
        ...group,
        repos: group.repo_paths
          .map((path) => byPath.get(path))
          .filter((repo): repo is RepoSummary => repo !== undefined)
          .filter((repo) => filteredPaths.has(repo.path)),
      }))
      .filter((group) => !hasQuery || group.repos.length > 0);
  });

  function openBookmarkMenu(repo: RepoSummary, x: number, y: number): void {
    setBookmarkMenu({ repo, x, y });
  }

  function setRepoSelected(repoPath: string, selected: boolean): void {
    const next = new Set(selectedRepoPaths());
    if (selected) next.add(repoPath);
    else next.delete(repoPath);
    setSelectedRepoPaths(next);
  }

  function setGroupSelected(repoPaths: string[], selected: boolean): void {
    const next = new Set(selectedRepoPaths());
    for (const repoPath of repoPaths) {
      if (selected) next.add(repoPath);
      else next.delete(repoPath);
    }
    setSelectedRepoPaths(next);
  }

  function selectedCountFor(repoPaths: string[]): number {
    const selected = selectedRepoPaths();
    return repoPaths.filter((path) => selected.has(path)).length;
  }

  function openBulkMenu(x: number, y: number): void {
    setBulkMenu({ x, y });
  }

  function fetchSelectedRepos(): void {
    const byPath = repoByPath();
    for (const repoPath of selectedRepoPaths()) {
      const repo = byPath.get(repoPath);
      if (repo) fetchRepo(repo.id, repo.name);
    }
  }

  const draggedGroupIdFrom = (event: DragEvent): string | null => {
    return draggedGroupId() || event.dataTransfer?.getData("application/x-git-juggler-group") || event.dataTransfer?.getData("text/plain") || null;
  };

  const clearGroupDrag = () => setDraggedGroupId(null);

  // Animates both swapped elements from their pre-swap position to their new
  // one once the (backend-round-tripped) reorder has actually landed in the DOM.
  const animateGroupSwap = (draggedEl: HTMLElement, neighborEl: HTMLElement, fromId: string, toId: string) => {
    const beforeDragged = draggedEl.getBoundingClientRect();
    const beforeNeighbor = neighborEl.getBoundingClientRect();
    groupSwapPending = true;
    void moveRepoGroup(fromId, toId).finally(() => {
      groupSwapPending = false;
      requestAnimationFrame(() => {
        flipTranslate(draggedEl, 0, beforeDragged.top - draggedEl.getBoundingClientRect().top);
        flipTranslate(neighborEl, 0, beforeNeighbor.top - neighborEl.getBoundingClientRect().top);
      });
    });
  };

  // Swaps the dragged group one step at a time with whichever neighbor the
  // cursor has crossed past the (vertical) midpoint of -- mirrors TabsBar's
  // maybeSwap, adapted from clientX/left to clientY/top. The list reorders
  // live as you drag; no gap/ghost placeholder needed.
  const maybeSwapGroup = (event: DragEvent) => {
    if (groupSwapPending) return;
    const draggedId = draggedGroupIdFrom(event);
    if (!draggedId) return;
    const currentGroups = filteredGroups();
    const draggedIndex = currentGroups.findIndex((group) => group.id === draggedId);
    if (draggedIndex === -1) return;
    const draggedEl = groupHeadingElements.get(draggedId);
    if (!draggedEl) return;

    const nextGroup = currentGroups[draggedIndex + 1];
    if (nextGroup) {
      const el = groupHeadingElements.get(nextGroup.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (event.clientY > rect.top + rect.height / 2) {
          animateGroupSwap(draggedEl, el, draggedId, nextGroup.id);
          return;
        }
      }
    }

    const prevGroup = currentGroups[draggedIndex - 1];
    if (prevGroup) {
      const el = groupHeadingElements.get(prevGroup.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          animateGroupSwap(draggedEl, el, draggedId, prevGroup.id);
        }
      }
    }
  };

  const repoKey = (groupId: string, repoPath: string) => `${groupId}::${repoPath}`;

  const clearRepoDrag = () => setDraggedRepo(null);

  // Mirrors animateGroupSwap, scoped to one group's repo list.
  const animateRepoSwap = (draggedEl: HTMLElement, neighborEl: HTMLElement, groupId: string, fromPath: string, toPath: string) => {
    const beforeDragged = draggedEl.getBoundingClientRect();
    const beforeNeighbor = neighborEl.getBoundingClientRect();
    repoSwapPending = true;
    void moveRepoInGroup(groupId, fromPath, toPath).finally(() => {
      repoSwapPending = false;
      requestAnimationFrame(() => {
        flipTranslate(draggedEl, 0, beforeDragged.top - draggedEl.getBoundingClientRect().top);
        flipTranslate(neighborEl, 0, beforeNeighbor.top - neighborEl.getBoundingClientRect().top);
      });
    });
  };

  // Mirrors maybeSwapGroup, scoped to one group's repo list.
  const maybeSwapRepo = (event: DragEvent, groupId: string, orderedPaths: string[]) => {
    if (repoSwapPending) return;
    const dragged = draggedRepo();
    if (!dragged || dragged.groupId !== groupId) return;
    const draggedIndex = orderedPaths.indexOf(dragged.repoPath);
    if (draggedIndex === -1) return;
    const draggedEl = repoElements.get(repoKey(groupId, dragged.repoPath));
    if (!draggedEl) return;

    const nextPath = orderedPaths[draggedIndex + 1];
    if (nextPath) {
      const el = repoElements.get(repoKey(groupId, nextPath));
      if (el) {
        const rect = el.getBoundingClientRect();
        if (event.clientY > rect.top + rect.height / 2) {
          animateRepoSwap(draggedEl, el, groupId, dragged.repoPath, nextPath);
          return;
        }
      }
    }

    const prevPath = orderedPaths[draggedIndex - 1];
    if (prevPath) {
      const el = repoElements.get(repoKey(groupId, prevPath));
      if (el) {
        const rect = el.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          animateRepoSwap(draggedEl, el, groupId, dragged.repoPath, prevPath);
        }
      }
    }
  };

  return (
    <div class="repo-list">
      <div class="repo-search">
        <input
          type="text"
          placeholder="Filter repos…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <button
          type="button"
          class="repo-bulk-button"
          title="Bulk operation"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openBulkMenu(rect.left, rect.bottom + 4);
          }}
        >
          ⋯
        </button>
      </div>
      <Show when={reposLoading()}>
        <div class="repo-empty">Looking for repos: {reposFound()} found…</div>
      </Show>
      <Show when={pinned().length > 0}>
        <h2>Pinned</h2>
        <For each={pinned()}>{(repo) => <RepoRow repo={repo} selected={selectedRepoPaths().has(repo.path)} onSelectedChange={setRepoSelected} onBookmarkClick={openBookmarkMenu} />}</For>
      </Show>
      <div
        class="repo-group-list"
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          maybeSwapGroup(e);
        }}
        onDrop={(e) => {
          e.preventDefault();
          clearGroupDrag();
        }}
      >
        <For each={filteredGroups()}>
          {(group) => {
            const groupRepoPaths = () => group.repos.map((repo) => repo.path);
            const groupSelectedCount = () => selectedCountFor(groupRepoPaths());
            return (
              <section
                class="repo-group-section"
                classList={{ collapsed: collapsedGroupIds().has(group.id) }}
              >
              <h2
                ref={(el) => groupHeadingElements.set(group.id, el)}
                class="repo-group-heading"
                classList={{ dragging: draggedGroupId() === group.id }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  maybeSwapGroup(e);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearGroupDrag();
                }}
              >
                <span
                  class="repo-group-name"
                  draggable={true}
                  onDragStart={(e) => {
                    setDraggedGroupId(group.id);
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("application/x-git-juggler-group", group.id);
                    }
                    e.dataTransfer?.setData("text/plain", group.id);
                  }}
                  onDragEnd={clearGroupDrag}
                >
                  {group.name}
                </span>
                <button
                  type="button"
                  class="repo-group-collapse"
                  classList={{ collapsed: collapsedGroupIds().has(group.id) }}
                  title={collapsedGroupIds().has(group.id) ? "Expand group" : "Collapse group"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupCollapsed(group.id);
                  }}
                >
                  <ChevronIcon />
                </button>
                <GroupCheckbox
                  checked={groupRepoPaths().length > 0 && groupSelectedCount() === groupRepoPaths().length}
                  indeterminate={groupSelectedCount() > 0 && groupSelectedCount() < groupRepoPaths().length}
                  onChange={(checked) => setGroupSelected(groupRepoPaths(), checked)}
                />
              </h2>
              <Show when={!collapsedGroupIds().has(group.id)}>
                <div
                  class="repo-group-repos"
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    maybeSwapRepo(e, group.id, groupRepoPaths());
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    clearRepoDrag();
                  }}
                >
                  <For each={group.repos} fallback={<div class="repo-empty">No repos in group</div>}>
                    {(repo) => (
                      <RepoRow
                        repo={repo}
                        groupId={group.id}
                        selected={selectedRepoPaths().has(repo.path)}
                        onSelectedChange={setRepoSelected}
                        disableRepoDrag={draggedGroupId() !== null}
                        onBookmarkClick={openBookmarkMenu}
                        dragging={draggedRepo()?.groupId === group.id && draggedRepo()?.repoPath === repo.path}
                        onRepoRef={(el) => repoElements.set(repoKey(group.id, repo.path), el)}
                        onRepoDragStart={() => setDraggedRepo({ groupId: group.id, repoPath: repo.path })}
                        onRepoDragOver={(e) => maybeSwapRepo(e, group.id, groupRepoPaths())}
                        onRepoDrop={clearRepoDrag}
                        onRepoDragEnd={clearRepoDrag}
                      />
                    )}
                  </For>
                </div>
              </Show>
              </section>
            );
          }}
        </For>
      </div>
      <h2>Repositories</h2>
      <For each={unpinned()} fallback={<Show when={!reposLoading()}><div class="repo-empty">No git repos found</div></Show>}>
        {(repo) => <RepoRow repo={repo} selected={selectedRepoPaths().has(repo.path)} onSelectedChange={setRepoSelected} onBookmarkClick={openBookmarkMenu} />}
      </For>
      <Show when={bookmarkMenu()}>{(state) => <BookmarkMenu state={state()} onClose={() => setBookmarkMenu(null)} />}</Show>
      <Show when={bulkMenu()}>{(state) => <BulkMenu state={state()} selectedCount={selectedRepoPaths().size} onFetch={fetchSelectedRepos} onClose={() => setBulkMenu(null)} />}</Show>
    </div>
  );
}

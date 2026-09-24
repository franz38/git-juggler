import { For, Show, createSignal } from "solid-js";
import { flipTranslate } from "../../lib/flip";
import {
  activateTab,
  activeRepo,
  agentSessionCountsByRepositoryId,
  agentsEnabled,
  closeTab,
  moveTab,
  openRepoContextMenu,
  pinTab,
  repoCurrentBranch,
  repos,
  tabs,
  type AgentSessionCounts,
} from "../../state/store";

// Agent sessions working in this tab's repository (none when agent detection
// is off), for the badge next to the tab name.
function agentCounts(tabId: string): AgentSessionCounts {
  if (!agentsEnabled()) return { total: 0, active: 0 };
  const repositoryId = repos().find((repo) => repo.id === tabId)?.repository_id;
  return (repositoryId && agentSessionCountsByRepositoryId().get(repositoryId)) || { total: 0, active: 0 };
}

export function TabsBar() {
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const tabElements = new Map<string, HTMLDivElement>();

  // Pixels the pointer must travel before a press turns into a drag, so a
  // plain click (or a slightly shaky one) still activates the tab.
  const DRAG_THRESHOLD = 4;
  // Set when a drag just finished so the click that follows the pointerup on
  // the dragged tab doesn't also activate it.
  let suppressClick = false;

  const clearDrag = () => {
    setDraggedTabId(null);
    document.body.classList.remove("tab-dragging");
  };

  // Tabs are reordered with pointer events rather than native HTML5 drag and
  // drop: during a native drag the OS owns the cursor, so the page can't keep
  // showing the grabbing hand. Listeners live on window (not the tab) because
  // the tab element gets moved in the DOM as it swaps, which can drop pointer
  // capture.
  const startPress = (event: PointerEvent, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".tab-close")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    // The drag preview: a floating copy of the tab that follows the pointer,
    // standing in for the native drag image. The real tab stays in the bar,
    // dimmed, as the slot it will drop into.
    const createGhost = () => {
      const source = tabElements.get(tabId);
      if (!source) return;
      const rect = source.getBoundingClientRect();
      grabOffsetX = startX - rect.left;
      grabOffsetY = startY - rect.top;
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.remove("dragging");
      ghost.classList.add("tab-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
    };
    const moveGhost = (e: PointerEvent) => {
      if (ghost) ghost.style.transform = `translate(${e.clientX - grabOffsetX}px, ${e.clientY - grabOffsetY}px)`;
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        setDraggedTabId(tabId);
        document.body.classList.add("tab-dragging");
        createGhost();
      }
      moveGhost(e);
      maybeSwap(tabId, e.clientX);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      ghost?.remove();
      if (dragging) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
      }
      clearDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  // Animates the dragged tab and the neighbor it's about to swap with: capture
  // both elements' current position, let the (synchronous) reorder happen,
  // then on the next frame FLIP each one from its old position to its new one.
  const animateSwap = (draggedEl: HTMLElement, neighborEl: HTMLElement) => {
    const beforeDragged = draggedEl.getBoundingClientRect();
    const beforeNeighbor = neighborEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      flipTranslate(draggedEl, beforeDragged.left - draggedEl.getBoundingClientRect().left, 0);
      flipTranslate(neighborEl, beforeNeighbor.left - neighborEl.getBoundingClientRect().left, 0);
    });
  };

  // Swaps the dragged tab one step at a time with whichever neighbor the
  // cursor has crossed past the midpoint of, instead of computing a full
  // target index and only reordering on drop -- the list reorders live as
  // you drag, no gap/ghost placeholder needed.
  const maybeSwap = (draggedId: string, clientX: number) => {
    const currentTabs = tabs();
    const draggedIndex = currentTabs.findIndex((tab) => tab.id === draggedId);
    if (draggedIndex === -1) return;
    const draggedEl = tabElements.get(draggedId);
    if (!draggedEl) return;

    const nextTab = currentTabs[draggedIndex + 1];
    if (nextTab) {
      const el = tabElements.get(nextTab.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (clientX > rect.left + rect.width / 2) {
          animateSwap(draggedEl, el);
          moveTab(draggedId, nextTab.id, "after");
          return;
        }
      }
    }

    const prevTab = currentTabs[draggedIndex - 1];
    if (prevTab) {
      const el = tabElements.get(prevTab.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          animateSwap(draggedEl, el);
          moveTab(draggedId, prevTab.id, "before");
        }
      }
    }
  };

  return (
    <div class="tabs-bar">
      <For each={tabs()}>
        {(tab) => (
          <div
            ref={(el) => tabElements.set(tab.id, el)}
            class="tab"
            classList={{ active: activeRepo() === tab.id, preview: !tab.pinned, dragging: draggedTabId() === tab.id }}
            onPointerDown={(e) => startPress(e, tab.id)}
            onClick={() => {
              if (!suppressClick) activateTab(tab.id);
            }}
            onDblClick={() => pinTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              openRepoContextMenu(e.clientX, e.clientY, tab.id, tab.name);
            }}
            title={tab.pinned ? tab.name : `${tab.name} (double-click to pin)`}
          >
            <span class="tab-names">
              <span class="tab-label">{tab.name}</span>
              <Show when={repoCurrentBranch(tab.id)}>
                <span class="tab-branch">{repoCurrentBranch(tab.id)}</span>
              </Show>
            </span>
            <Show when={agentCounts(tab.id).total > 0}>
              <span
                class="tab-agent-badge"
                classList={{ idle: agentCounts(tab.id).active === 0 }}
                title={`${agentCounts(tab.id).active} of ${agentCounts(tab.id).total} agent session${agentCounts(tab.id).total === 1 ? "" : "s"} active`}
              >
                {agentCounts(tab.id).total}
              </span>
            </Show>
            <span
              class="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              &times;
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

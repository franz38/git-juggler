import { For, Show, createSignal } from "solid-js";
import { flipTranslate } from "../../lib/flip";
import { activateTab, activeRepo, closeTab, moveTab, openRepoContextMenu, pinTab, repoCurrentBranch, tabs } from "../../state/store";

export function TabsBar() {
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const tabElements = new Map<string, HTMLDivElement>();

  const draggedIdFrom = (event: DragEvent): string | null => {
    return draggedTabId() || event.dataTransfer?.getData("application/x-git-juggler-tab") || event.dataTransfer?.getData("text/plain") || null;
  };

  const clearDrag = () => setDraggedTabId(null);

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
  const maybeSwap = (event: DragEvent) => {
    const draggedId = draggedIdFrom(event);
    if (!draggedId) return;
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
        if (event.clientX > rect.left + rect.width / 2) {
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
        if (event.clientX < rect.left + rect.width / 2) {
          animateSwap(draggedEl, el);
          moveTab(draggedId, prevTab.id, "before");
        }
      }
    }
  };

  return (
    <div
      class="tabs-bar"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        maybeSwap(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        clearDrag();
      }}
    >
      <For each={tabs()}>
        {(tab) => (
          <div
            ref={(el) => tabElements.set(tab.id, el)}
            class="tab"
            classList={{ active: activeRepo() === tab.id, preview: !tab.pinned, dragging: draggedTabId() === tab.id }}
            draggable="true"
            onClick={() => activateTab(tab.id)}
            onDblClick={() => pinTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              openRepoContextMenu(e.clientX, e.clientY, tab.id, tab.name);
            }}
            onDragStart={(e) => {
              setDraggedTabId(tab.id);
              e.dataTransfer?.setData("application/x-git-juggler-tab", tab.id);
              e.dataTransfer?.setData("text/plain", tab.id);
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
              maybeSwap(e);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              clearDrag();
            }}
            onDragEnd={clearDrag}
            title={tab.pinned ? tab.name : `${tab.name} (double-click to pin)`}
          >
            <span class="tab-names">
              <span class="tab-label">{tab.name}</span>
              <Show when={repoCurrentBranch(tab.id)}>
                <span class="tab-branch">{repoCurrentBranch(tab.id)}</span>
              </Show>
            </span>
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

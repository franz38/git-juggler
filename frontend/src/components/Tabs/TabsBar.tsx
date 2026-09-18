import { For, Show, createSignal } from "solid-js";
import { activateTab, activeRepo, closeTab, moveTab, pinTab, repoCurrentBranch, tabs } from "../../state/store";
import type { TabInfo } from "../../state/store";

interface CollapsingGhost {
  tab: TabInfo;
  afterId: string | null;
  beforeId: string | null;
  width: number;
}

export function TabsBar() {
  const [draggedTabId, setDraggedTabId] = createSignal<string | null>(null);
  const [collapsingGhost, setCollapsingGhost] = createSignal<CollapsingGhost | null>(null);
  const [insertionIndex, setInsertionIndex] = createSignal<number | null>(null);
  const [gapWidth, setGapWidth] = createSignal(96);
  const tabElements = new Map<string, HTMLDivElement>();

  const draggedIdFrom = (event: DragEvent): string | null => {
    return draggedTabId() || event.dataTransfer?.getData("application/x-git-juggler-tab") || event.dataTransfer?.getData("text/plain") || null;
  };

  const clearDrag = () => {
    setDraggedTabId(null);
    setInsertionIndex(null);
  };

  const visibleInsertionIndex = () => {
    const index = insertionIndex();
    const draggedId = draggedTabId();
    if (index === null || !draggedId) return null;
    const draggedIndex = tabs().findIndex((tab) => tab.id === draggedId);
    if (draggedIndex === -1 || index === draggedIndex || index === draggedIndex + 1) return null;
    return index;
  };

  const computeInsertionIndex = (event: DragEvent): number => {
    const draggedId = draggedIdFrom(event);
    const currentTabs = tabs();
    const visibleGap = visibleInsertionIndex();
    for (let index = 0; index < currentTabs.length; index++) {
      const tab = currentTabs[index];
      if (tab.id === draggedId) continue;
      const element = tabElements.get(tab.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const adjustedLeft = visibleGap !== null && index >= visibleGap ? rect.left - gapWidth() : rect.left;
      if (event.clientX < adjustedLeft + rect.width / 2) return index;
    }
    return currentTabs.length;
  };

  const commitDrop = (event: DragEvent) => {
    const draggedId = draggedIdFrom(event);
    const index = insertionIndex();
    const currentTabs = tabs();
    const draggedIndex = currentTabs.findIndex((tab) => tab.id === draggedId);
    if (draggedId && index !== null && draggedIndex !== -1 && currentTabs.length > 0 && visibleInsertionIndex() !== null) {
      const draggedTab = currentTabs[draggedIndex];
      setCollapsingGhost({
        tab: draggedTab,
        afterId: currentTabs[draggedIndex - 1]?.id ?? null,
        beforeId: currentTabs[draggedIndex + 1]?.id ?? null,
        width: gapWidth(),
      });
      if (index >= currentTabs.length) {
        moveTab(draggedId, currentTabs[currentTabs.length - 1].id, "after");
      } else {
        moveTab(draggedId, currentTabs[index].id, "before");
      }
      clearDrag();
      window.setTimeout(() => setCollapsingGhost(null), 120);
      return;
    }
    clearDrag();
  };

  const gap = () => <div class="tab-drop-gap" style={{ width: `${gapWidth()}px` }} />;
  const ghost = () => {
    const item = collapsingGhost();
    if (!item) return null;
    return (
      <div class="tab tab-collapse-ghost" style={{ width: `${item.width}px` }}>
        <span class="tab-names">
          <span class="tab-label">{item.tab.name}</span>
          <Show when={repoCurrentBranch(item.tab.id)}>
            <span class="tab-branch">{repoCurrentBranch(item.tab.id)}</span>
          </Show>
        </span>
        <span class="tab-close">&times;</span>
      </div>
    );
  };

  return (
    <div
      class="tabs-bar"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (draggedIdFrom(e)) setInsertionIndex(computeInsertionIndex(e));
      }}
      onDrop={(e) => {
        e.preventDefault();
        commitDrop(e);
      }}
    >
      <Show when={collapsingGhost()?.beforeId === tabs()[0]?.id && collapsingGhost()?.afterId === null}>{ghost()}</Show>
      <For each={tabs()}>
        {(tab, index) => (
          <>
            <Show when={visibleInsertionIndex() === index()}>{gap()}</Show>
            <div
              ref={(el) => tabElements.set(tab.id, el)}
              class="tab"
              classList={{ active: activeRepo() === tab.id, preview: !tab.pinned, dragging: draggedTabId() === tab.id }}
              draggable="true"
              onClick={() => activateTab(tab.id)}
              onDblClick={() => pinTab(tab.id)}
              onDragStart={(e) => {
                setDraggedTabId(tab.id);
                setInsertionIndex(null);
                setGapWidth((e.currentTarget as HTMLElement).getBoundingClientRect().width);
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
                if (draggedIdFrom(e)) setInsertionIndex(computeInsertionIndex(e));
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                commitDrop(e);
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
            <Show when={collapsingGhost()?.afterId === tab.id}>{ghost()}</Show>
          </>
        )}
      </For>
      <Show when={visibleInsertionIndex() === tabs().length}>{gap()}</Show>
    </div>
  );
}

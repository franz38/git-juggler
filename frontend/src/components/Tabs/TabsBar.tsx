import { For, Show } from "solid-js";
import { activateTab, activeRepo, closeTab, pinTab, repoCurrentBranch, tabs } from "../../state/store";

export function TabsBar() {
  return (
    <div class="tabs-bar">
      <For each={tabs()}>
        {(tab) => (
          <div
            class="tab"
            classList={{ active: activeRepo() === tab.id, preview: !tab.pinned }}
            onClick={() => activateTab(tab.id)}
            onDblClick={() => pinTab(tab.id)}
            title={tab.pinned ? tab.name : `${tab.name} (preview — double-click to keep open)`}
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

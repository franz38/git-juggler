import { Show } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { useOverlay } from "../../state/overlayStack";
import { activeRepo, closeTagContextMenu, openDeleteTagModal, runInTerminal, scheduleGraphRefresh, shellQuote, tagContextMenu } from "../../state/store";

export function TagContextMenu() {
  let panelRef: HTMLDivElement | undefined;
  useOverlay("tag-context-menu", () => !!tagContextMenu(), closeTagContextMenu);

  const handleDelete = () => {
    const menu = tagContextMenu();
    if (!menu) return;
    openDeleteTagModal({ name: menu.name });
    closeTagContextMenu();
  };

  const handlePush = () => {
    const menu = tagContextMenu();
    const repo = activeRepo();
    if (!menu || !repo) return;
    runInTerminal(repo, `git push origin ${shellQuote(menu.name)}`);
    scheduleGraphRefresh(repo);
    closeTagContextMenu();
  };

  return (
    <Show when={tagContextMenu()}>
      {(menu) => {
        dismissOnOutsideClick(() => panelRef, closeTagContextMenu);
        return (
          <div class="context-menu" ref={panelRef} style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleDelete}>
              Delete tag
            </div>
            <div class="context-menu-item" onClick={handlePush}>
              Push tag
            </div>
          </div>
        );
      }}
    </Show>
  );
}

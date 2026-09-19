import { Show } from "solid-js";
import { activeRepo, closeTagContextMenu, openDeleteTagModal, runInTerminal, scheduleGraphRefresh, tagContextMenu } from "../../state/store";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function TagContextMenu() {
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
      {(menu) => (
        <>
          <div class="context-menu-overlay" onClick={closeTagContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleDelete}>
              Delete tag
            </div>
            <div class="context-menu-item" onClick={handlePush}>
              Push tag
            </div>
          </div>
        </>
      )}
    </Show>
  );
}

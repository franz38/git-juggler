import { Show } from "solid-js";
import { activeRepo, closeContextMenu, contextMenu, runInTerminal, scheduleGraphRefresh } from "../../state/store";

export function CommitContextMenu() {
  const handleCheckout = () => {
    const menu = contextMenu();
    const repo = activeRepo();
    if (!menu || !repo) return;
    runInTerminal(repo, `git checkout ${menu.hash}`);
    // The terminal also detects checkouts typed directly by the user (see
    // TerminalPanel), but we already know for certain one just happened
    // here, so schedule the refresh directly rather than relying on that
    // heuristic.
    scheduleGraphRefresh(repo);
    closeContextMenu();
  };

  return (
    <Show when={contextMenu()}>
      {(menu) => (
        <>
          <div class="context-menu-overlay" onClick={closeContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleCheckout}>
              Checkout
            </div>
          </div>
        </>
      )}
    </Show>
  );
}

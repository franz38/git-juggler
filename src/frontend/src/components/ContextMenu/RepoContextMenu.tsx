import { Show } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { closeRepoContextMenu, fetchRepo, repoContextMenu } from "../../state/store";

export function RepoContextMenu() {
  let panelRef: HTMLDivElement | undefined;

  const handleFetch = () => {
    const menu = repoContextMenu();
    if (!menu) return;
    fetchRepo(menu.repoId, menu.repoName);
    closeRepoContextMenu();
  };

  return (
    <Show when={repoContextMenu()}>
      {(menu) => {
        dismissOnOutsideClick(() => panelRef, closeRepoContextMenu);
        return (
          <div class="context-menu" ref={panelRef} style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleFetch}>
              Fetch
            </div>
          </div>
        );
      }}
    </Show>
  );
}

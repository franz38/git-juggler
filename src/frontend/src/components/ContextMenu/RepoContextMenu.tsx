import { Show } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { useOverlay } from "../../state/overlayStack";
import { closeRepoContextMenu, fetchRepo, openRepoTab, repoContextMenu, runInTerminal, scheduleGraphRefresh } from "../../state/store";

export function RepoContextMenu() {
  let panelRef: HTMLDivElement | undefined;
  useOverlay("repo-context-menu", () => !!repoContextMenu(), closeRepoContextMenu);

  const handleFetch = () => {
    const menu = repoContextMenu();
    if (!menu) return;
    fetchRepo(menu.repoId, menu.repoName);
    closeRepoContextMenu();
  };

  const runRepoCommand = (command: string) => {
    const menu = repoContextMenu();
    if (!menu) return;
    openRepoTab(menu.repoId, menu.repoName);
    runInTerminal(menu.repoId, command);
    scheduleGraphRefresh(menu.repoId);
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
            <div class="context-menu-item" onClick={() => runRepoCommand("git pull")}>
              Pull
            </div>
          </div>
        );
      }}
    </Show>
  );
}

import { Show } from "solid-js";
import { closeRepoContextMenu, fetchRepo, repoContextMenu } from "../../state/store";

export function RepoContextMenu() {
  const handleFetch = () => {
    const menu = repoContextMenu();
    if (!menu) return;
    fetchRepo(menu.repoId, menu.repoName);
    closeRepoContextMenu();
  };

  return (
    <Show when={repoContextMenu()}>
      {(menu) => (
        <>
          <div class="context-menu-overlay" onClick={closeRepoContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleFetch}>
              Fetch
            </div>
          </div>
        </>
      )}
    </Show>
  );
}

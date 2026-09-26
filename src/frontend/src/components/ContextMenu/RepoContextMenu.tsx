import { For, Show } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { useOverlay } from "../../state/overlayStack";
import { closeRepoContextMenu, fetchRepo, openNewGroupModal, openRepoTab, pinnedRepos, repoContextMenu, repoGroups, runInTerminal, scheduleGraphRefresh, setRepoInGroup, setRepoPinned } from "../../state/store";

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

  const togglePinned = () => {
    const menu = repoContextMenu();
    if (!menu?.repoPath) return;
    void setRepoPinned(menu.repoPath, !pinnedRepos().has(menu.repoPath));
    closeRepoContextMenu();
  };

  const toggleGroup = (groupId: string, repoPath: string, inGroup: boolean) => {
    void setRepoInGroup(groupId, repoPath, !inGroup);
    closeRepoContextMenu();
  };

  const createGroupForRepo = () => {
    const menu = repoContextMenu();
    if (!menu?.repoPath) return;
    const repoPath = menu.repoPath;
    closeRepoContextMenu();
    openNewGroupModal(repoPath);
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
            <Show when={menu().repoPath}>
              {(repoPath) => (
                <>
                  <div class="context-menu-separator" />
                  <div class="context-menu-item context-menu-item-with-trailing-mark" onClick={togglePinned}>
                    <span>Pin</span>
                    <span>{pinnedRepos().has(repoPath()) ? "✓" : ""}</span>
                  </div>
                  <div class="context-menu-separator" />
                  <div class="context-menu-submenu">
                    <div class="context-menu-item context-menu-item-with-arrow">
                      <span>Add to a group</span>
                      <span>›</span>
                    </div>
                    <div class="context-menu context-menu-submenu-panel">
                      <div class="context-menu-item context-menu-item-with-mark" onClick={createGroupForRepo}>
                        <span>+</span>
                        <span>Create new group</span>
                      </div>
                      <Show when={repoGroups().length > 0}>
                        <div class="context-menu-separator" />
                        <For each={repoGroups()}>
                          {(group) => {
                            const inGroup = () => group.repo_paths.includes(repoPath());
                            return (
                              <div class="context-menu-item context-menu-item-with-mark" onClick={() => toggleGroup(group.id, repoPath(), inGroup())}>
                                <span>{inGroup() ? "✓" : ""}</span>
                                <span class="repo-group-display-name">{group.name}</span>
                              </div>
                            );
                          }}
                        </For>
                      </Show>
                    </div>
                  </div>
                </>
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

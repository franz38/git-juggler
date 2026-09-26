import { Show } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { useOverlay } from "../../state/overlayStack";
import { branchContextMenu, closeBranchContextMenu, openDeleteBranchModal } from "../../state/store";

export function BranchContextMenu() {
  let panelRef: HTMLDivElement | undefined;
  useOverlay("branch-context-menu", () => !!branchContextMenu(), closeBranchContextMenu);

  const handleDelete = () => {
    const menu = branchContextMenu();
    if (!menu) return;
    openDeleteBranchModal({ name: menu.name, remote: menu.remote });
    closeBranchContextMenu();
  };

  return (
    <Show when={branchContextMenu()}>
      {(menu) => {
        dismissOnOutsideClick(() => panelRef, closeBranchContextMenu);
        return (
          <div class="context-menu" ref={panelRef} style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleDelete}>
              {menu().remote ? "Delete remote branch" : "Delete branch"}
            </div>
          </div>
        );
      }}
    </Show>
  );
}

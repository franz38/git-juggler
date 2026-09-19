import { Show } from "solid-js";
import { branchContextMenu, closeBranchContextMenu, openDeleteBranchModal } from "../../state/store";

export function BranchContextMenu() {
  const handleDelete = () => {
    const menu = branchContextMenu();
    if (!menu) return;
    openDeleteBranchModal({ name: menu.name, remote: menu.remote });
    closeBranchContextMenu();
  };

  return (
    <Show when={branchContextMenu()}>
      {(menu) => (
        <>
          <div class="context-menu-overlay" onClick={closeBranchContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <div class="context-menu-item" onClick={handleDelete}>
              {menu().remote ? "Delete remote branch" : "Delete branch"}
            </div>
          </div>
        </>
      )}
    </Show>
  );
}

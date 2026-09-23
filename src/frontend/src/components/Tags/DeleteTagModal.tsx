import { Show, createSignal } from "solid-js";
import { activeRepo, closeDeleteTagModal, deleteTagModal, runInTerminal, scheduleGraphRefresh, shellQuote } from "../../state/store";

export function DeleteTagModal() {
  const [deleteRemote, setDeleteRemote] = createSignal(false);

  const close = () => {
    setDeleteRemote(false);
    closeDeleteTagModal();
  };

  const confirm = () => {
    const modal = deleteTagModal();
    const repo = activeRepo();
    if (!modal || !repo) return;

    const commands = [`git tag -d ${shellQuote(modal.name)}`];
    if (deleteRemote()) commands.push(`git push origin :refs/tags/${shellQuote(modal.name)}`);
    runInTerminal(repo, commands.join(" && "));
    scheduleGraphRefresh(repo);
    close();
  };

  return (
    <Show when={deleteTagModal()}>
      {(modal) => (
        <div class="menu-overlay" onClick={close}>
          <div class="branch-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete tag</h3>
            <p class="menu-hint">
              Delete <span class="mono">{modal().name}</span> from this repo.
            </p>
            <label class="modal-check-row">
              <input type="checkbox" checked={deleteRemote()} onChange={(e) => setDeleteRemote(e.currentTarget.checked)} />
              <span>Also delete on remote</span>
            </label>
            <div class="menu-actions">
              <button type="button" class="menu-secondary-button" onClick={close}>
                Cancel
              </button>
              <button type="button" class="menu-primary-button danger" onClick={confirm}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

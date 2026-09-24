import { Show, createEffect, createSignal } from "solid-js";
import { closeNewGroupModal, createRepoGroup, newGroupModal } from "../../state/store";
import { overlayZIndex, useOverlay } from "../../state/overlayStack";

export function NewGroupModal() {
  const [name, setName] = createSignal("");
  let input: HTMLInputElement | undefined;

  createEffect(() => {
    if (newGroupModal()) queueMicrotask(() => input?.focus());
    else setName("");
  });

  useOverlay("new-group", () => !!newGroupModal(), closeNewGroupModal);

  const canCreate = () => name().trim().length > 0;

  const submit = async () => {
    const target = newGroupModal();
    if (!target || !canCreate()) return;
    closeNewGroupModal();
    await createRepoGroup(name(), target.repoPath);
  };

  return (
    <Show when={newGroupModal()}>
      <div class="menu-overlay" style={{ "z-index": overlayZIndex("new-group") }} onClick={closeNewGroupModal}>
        <div class="create-tag-dialog" onClick={(e) => e.stopPropagation()}>
          <h3>New group</h3>
          <label class="menu-field">
            <span>Group name</span>
            <input
              ref={input}
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
          <div class="menu-actions">
            <button type="button" class="menu-secondary-button" onClick={closeNewGroupModal}>
              Cancel
            </button>
            <button type="button" class="menu-primary-button" disabled={!canCreate()} onClick={() => void submit()}>
              Create group
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

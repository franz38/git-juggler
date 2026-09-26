import { Show, createEffect, createSignal } from "solid-js";
import {
  closeCreateBranchModal,
  createBranchModal,
  openRepoTab,
  runInTerminal,
  scheduleGraphRefresh,
  shellQuote,
} from "../../state/store";
import { overlayZIndex, useOverlay } from "../../state/overlayStack";

export function CreateBranchModal() {
  const [branchName, setBranchName] = createSignal("");

  createEffect(() => {
    if (!createBranchModal()) setBranchName("");
  });

  useOverlay("create-branch", () => !!createBranchModal(), closeCreateBranchModal);

  const trimmedName = () => branchName().trim();
  const canCreate = () => trimmedName().length > 0;

  const submit = () => {
    const target = createBranchModal();
    const name = trimmedName();
    if (!target || !name) return;

    if (target.repoName) openRepoTab(target.repoId, target.repoName);
    const startPoint = target.hash ? ` ${target.hash}` : "";
    runInTerminal(target.repoId, `git branch ${shellQuote(name)}${startPoint}`);
    scheduleGraphRefresh(target.repoId);
    closeCreateBranchModal();
  };

  return (
    <Show when={createBranchModal()}>
      {(target) => (
        <div class="menu-overlay" style={{ "z-index": overlayZIndex("create-branch") }} onClick={closeCreateBranchModal}>
          <div class="create-tag-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create branch</h3>
            <p class="menu-hint">
              <Show
                when={target().hash}
                fallback={<>From current HEAD{target().repoName ? ` in ${target().repoName}` : ""}.</>}
              >
                From {target().shortHash ?? target().hash}
                <Show when={target().subject}> — {target().subject}</Show>
              </Show>
            </p>

            <label class="menu-field">
              <span>Branch name</span>
              <input
                type="text"
                value={branchName()}
                onInput={(e) => setBranchName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate()) submit();
                }}
              />
            </label>

            <div class="menu-actions">
              <button type="button" class="menu-secondary-button" onClick={closeCreateBranchModal}>
                Cancel
              </button>
              <button type="button" class="menu-primary-button" disabled={!canCreate()} onClick={submit}>
                Create branch
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

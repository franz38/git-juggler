import { Show, createMemo, createSignal } from "solid-js";
import { activeRepo, closeDeleteBranchModal, commits, deleteBranchModal, runInTerminal, scheduleGraphRefresh, shellQuote } from "../../state/store";

import { overlayZIndex, useOverlay } from "../../state/overlayStack";

function remoteParts(remoteBranch: string): { remote: string; branch: string } | null {
  const slash = remoteBranch.indexOf("/");
  if (slash <= 0 || slash === remoteBranch.length - 1) return null;
  return { remote: remoteBranch.slice(0, slash), branch: remoteBranch.slice(slash + 1) };
}

export function DeleteBranchModal() {
  const [forceDelete, setForceDelete] = createSignal(false);
  const [deleteRemote, setDeleteRemote] = createSignal(false);
  const matchingRemote = createMemo(() => {
    const modal = deleteBranchModal();
    if (!modal || modal.remote) return null;
    const suffix = `/${modal.name}`;
    for (const commit of commits()) {
      const match = commit.refs.remote_branches.find((name) => name.endsWith(suffix));
      if (match) return match;
    }
    return null;
  });

  const close = () => {
    setForceDelete(false);
    setDeleteRemote(false);
    closeDeleteBranchModal();
  };

  const confirm = () => {
    const modal = deleteBranchModal();
    const repo = activeRepo();
    if (!modal || !repo) return;

    if (modal.remote) {
      const parts = remoteParts(modal.name);
      if (!parts) return;
      runInTerminal(repo, `git push ${shellQuote(parts.remote)} --delete ${shellQuote(parts.branch)}`);
    } else {
      const commands = [`git branch ${forceDelete() ? "-D" : "-d"} ${shellQuote(modal.name)}`];
      const remote = deleteRemote() ? matchingRemote() : null;
      const parts = remote ? remoteParts(remote) : null;
      if (parts) commands.push(`git push ${shellQuote(parts.remote)} --delete ${shellQuote(parts.branch)}`);
      runInTerminal(repo, commands.join(" && "));
    }

    scheduleGraphRefresh(repo);
    close();
  };

  useOverlay("delete-branch", () => !!deleteBranchModal(), close);

  return (
    <Show when={deleteBranchModal()}>
      {(modal) => (
        <div class="menu-overlay" style={{ "z-index": overlayZIndex("delete-branch") }} onClick={close}>
          <div class="branch-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal().remote ? "Delete remote branch" : "Delete branch"}</h3>
            <p class="menu-hint">
              Delete <span class="mono">{modal().name}</span>{modal().remote ? " from the remote. The local branch is not changed." : " from this repo."}
            </p>
            <Show when={!modal().remote}>
              <label class="modal-check-row">
                <input type="checkbox" checked={forceDelete()} onChange={(e) => setForceDelete(e.currentTarget.checked)} />
                <span>Force delete</span>
              </label>
              <Show when={matchingRemote()}>
                {(remote) => (
                  <label class="modal-check-row">
                    <input type="checkbox" checked={deleteRemote()} onChange={(e) => setDeleteRemote(e.currentTarget.checked)} />
                    <span>
                      Delete the branch on remote (<span class="mono">{remote()}</span>)
                    </span>
                  </label>
                )}
              </Show>
            </Show>
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

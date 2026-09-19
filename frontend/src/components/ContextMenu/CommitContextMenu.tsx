import { Show, createMemo } from "solid-js";
import {
  activeRepo,
  closeContextMenu,
  commits,
  contextMenu,
  openCreateTagModal,
  runInTerminal,
  scheduleGraphRefresh,
} from "../../state/store";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function copyText(value: string): void {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function CommitContextMenu() {
  const selectedCommit = createMemo(() => {
    const menu = contextMenu();
    if (!menu) return undefined;
    return commits().find((commit) => commit.hash === menu.hash);
  });
  const stashRef = createMemo(() => selectedCommit()?.refs.stashes[0]);
  const hashType = createMemo(() => (stashRef() ? "stash" : "commit"));

  const handleCheckout = () => {
    const menu = contextMenu();
    const repo = activeRepo();
    if (!menu || !repo) return;
    runInTerminal(repo, `git checkout ${menu.hash}`);
    // The terminal also detects checkouts typed directly by the user (see
    // TerminalPanel), but we already know for certain one just happened
    // here, so schedule the refresh directly rather than relying on that
    // heuristic.
    scheduleGraphRefresh(repo);
    closeContextMenu();
  };

  const handleCreateTag = () => {
    const commit = selectedCommit();
    if (!commit) return;
    openCreateTagModal({ hash: commit.hash, shortHash: commit.short_hash, subject: commit.subject });
    closeContextMenu();
  };

  const runStashCommand = (action: "apply" | "pop" | "drop") => {
    const repo = activeRepo();
    const ref = stashRef();
    if (!repo || !ref) return;
    runInTerminal(repo, `git stash ${action} ${shellQuote(ref)}`);
    scheduleGraphRefresh(repo);
    closeContextMenu();
  };

  const handleCopyHash = () => {
    const commit = selectedCommit();
    if (!commit) return;
    copyText(commit.hash);
    closeContextMenu();
  };

  return (
    <Show when={contextMenu()}>
      {(menu) => (
        <>
          <div class="context-menu-overlay" onClick={closeContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div class="context-menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <Show
              when={stashRef()}
              fallback={
                <>
                  <div class="context-menu-item" onClick={handleCheckout}>
                    Checkout
                  </div>
                  <div class="context-menu-item" onClick={handleCreateTag}>
                    Create tag
                  </div>
                </>
              }
            >
              <div class="context-menu-item" onClick={() => runStashCommand("apply")}>
                Apply stash
              </div>
              <div class="context-menu-item" onClick={() => runStashCommand("pop")}>
                Pop stash
              </div>
              <div class="context-menu-item" onClick={() => runStashCommand("drop")}>
                Drop stash
              </div>
            </Show>
            <div class="context-menu-item" onClick={handleCopyHash}>
              Copy {hashType()} hash
            </div>
          </div>
        </>
      )}
    </Show>
  );
}

import { Show, createMemo } from "solid-js";
import { dismissOnOutsideClick } from "../../lib/dismissOnOutsideClick";
import { useOverlay } from "../../state/overlayStack";
import {
  activeRepo,
  closeContextMenu,
  commits,
  contextMenu,
  currentBranch,
  headCommit,
  openCreateBranchModal,
  openCreateTagModal,
  runInTerminal,
  scheduleCiRefreshAfterPush,
  scheduleGraphRefresh,
  shellQuote,
  startPush,
  upstreamBranch,
  upstreamCommit,
  upstreamRemote,
} from "../../state/store";

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
  let panelRef: HTMLDivElement | undefined;
  useOverlay("commit-context-menu", () => !!contextMenu(), closeContextMenu);

  const selectedCommit = createMemo(() => {
    const menu = contextMenu();
    if (!menu) return undefined;
    return commits().find((commit) => commit.hash === menu.hash);
  });
  const stashRef = createMemo(() => selectedCommit()?.refs.stashes[0]);
  const hashType = createMemo(() => (stashRef() ? "stash" : "commit"));
  const parentsByHash = createMemo(() => new Map(commits().map((commit) => [commit.hash, commit.parents])));
  const collectAncestors = (start: string): Set<string> => {
    const parents = parentsByHash();
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const hash = stack.pop()!;
      if (seen.has(hash)) continue;
      seen.add(hash);
      for (const parent of parents.get(hash) ?? []) stack.push(parent);
    }
    return seen;
  };
  const headAncestors = createMemo(() => {
    const head = headCommit();
    return head ? collectAncestors(head) : new Set<string>();
  });
  const unpushedCommits = createMemo(() => {
    const upstream = upstreamCommit();
    if (!headCommit() || !upstream) return new Set<string>();

    const localOnly = new Set(headAncestors());
    for (const hash of collectAncestors(upstream)) localOnly.delete(hash);
    return localOnly;
  });
  const canPushUpToHere = createMemo(() => {
    const commit = selectedCommit();
    return Boolean(commit && !stashRef() && unpushedCommits().has(commit.hash));
  });
  // The tip branch of the right-clicked commit, when it's a local branch
  // other than the one currently checked out -- "merge into current branch"
  // only makes sense for a commit that actually represents another branch.
  const mergeableBranch = createMemo(() => {
    const commit = selectedCommit();
    if (!commit || stashRef()) return undefined;
    const current = currentBranch();
    return commit.refs.branches.find((name) => name !== current);
  });

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

  // Cherry-picking a commit already in the current branch's history is a no-op.
  const canCherryPick = createMemo(() => {
    const commit = selectedCommit();
    return Boolean(commit && !stashRef() && headCommit() && !headAncestors().has(commit.hash));
  });

  const handleCherryPick = () => {
    const commit = selectedCommit();
    const repo = activeRepo();
    if (!commit || !repo || !canCherryPick()) return;
    // A merge commit has several parents; git needs to be told which side is
    // the mainline. Parent 1 is the branch the merge landed on.
    const mainline = commit.parents.length > 1 ? "-m 1 " : "";
    runInTerminal(repo, `git cherry-pick ${mainline}${commit.hash}`);
    scheduleGraphRefresh(repo);
    closeContextMenu();
  };

  const handleCreateTag = () => {
    const commit = selectedCommit();
    if (!commit) return;
    openCreateTagModal({ hash: commit.hash, shortHash: commit.short_hash, subject: commit.subject });
    closeContextMenu();
  };

  const handleCreateBranch = () => {
    const commit = selectedCommit();
    const repo = activeRepo();
    if (!commit || !repo || stashRef()) return;
    openCreateBranchModal({ repoId: repo, hash: commit.hash, shortHash: commit.short_hash, subject: commit.subject });
    closeContextMenu();
  };

  const handlePushUpToHere = () => {
    const menu = contextMenu();
    const repo = activeRepo();
    const remote = upstreamRemote();
    const branch = upstreamBranch();
    if (!menu || !repo || !canPushUpToHere() || !remote || !branch) return;
    startPush(repo, menu.hash);
    runInTerminal(repo, `git push ${shellQuote(remote)} ${shellQuote(`${menu.hash}:refs/heads/${branch}`)}`);
    scheduleCiRefreshAfterPush(repo);
    closeContextMenu();
  };

  const handleMerge = () => {
    const repo = activeRepo();
    const branch = mergeableBranch();
    if (!repo || !branch) return;
    runInTerminal(repo, `git merge ${shellQuote(branch)}`);
    scheduleGraphRefresh(repo);
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
      {(menu) => {
        dismissOnOutsideClick(() => panelRef, closeContextMenu);
        return (
          <div class="context-menu" ref={panelRef} style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <Show
              when={stashRef()}
              fallback={
                <>
                  <div class="context-menu-item" onClick={handleCheckout}>
                    Checkout
                  </div>
                  <Show when={canCherryPick()}>
                    <div class="context-menu-item" onClick={handleCherryPick}>
                      Cherry-pick
                    </div>
                  </Show>
                  <div class="context-menu-item" onClick={handleCreateTag}>
                    Create tag
                  </div>
                  <div class="context-menu-item" onClick={handleCreateBranch}>
                    Create branch here
                  </div>
                  <Show when={canPushUpToHere()}>
                    <div class="context-menu-item" onClick={handlePushUpToHere}>
                      Push all up to here
                    </div>
                  </Show>
                  <Show when={mergeableBranch()}>
                    <div class="context-menu-item" onClick={handleMerge}>
                      Merge into current branch
                    </div>
                  </Show>
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
        );
      }}
    </Show>
  );
}

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { FileChange } from "../../api/types";
import {
  COLLAPSED_ROW_HEIGHT,
  UNCOMMITTED_ROW_KEY,
  activeRepo,
  reportRowHeight,
  runInTerminal,
  toggleUncommittedExpanded,
  uncommittedExpanded,
} from "../../state/store";

function statusLabel(status: string): string {
  if (status === "untracked") return "U";
  return status[0]?.toUpperCase() ?? "M";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function UncommittedRow(props: { files: FileChange[] }) {
  let rowRef: HTMLDivElement | undefined;
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal("");

  const selected = createMemo(() => props.files.filter((file) => selectedPaths().has(file.path)));
  const hasSelection = createMemo(() => selected().length > 0);
  const canRunAction = createMemo(() => hasSelection() && message().trim().length > 0);

  const togglePath = (path: string) => {
    const next = new Set(selectedPaths());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const selectedPathArgs = () => selected().map((file) => shellQuote(file.path)).join(" ");

  const runCommit = () => {
    const repo = activeRepo();
    if (!repo || !canRunAction()) return;
    runInTerminal(repo, `git add -- ${selectedPathArgs()} && git commit -m ${shellQuote(message().trim())}`);
  };

  const runStash = () => {
    const repo = activeRepo();
    if (!repo || !canRunAction()) return;
    runInTerminal(repo, `git stash push -u -m ${shellQuote(message().trim())} -- ${selectedPathArgs()}`);
  };

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (rowRef) reportRowHeight(UNCOMMITTED_ROW_KEY, rowRef.getBoundingClientRect().height);
    });
    observer.observe(rowRef!);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={rowRef} class="commit-row uncommitted-row" classList={{ expanded: uncommittedExpanded() }} onContextMenu={(e) => e.preventDefault()}>
      <div class="commit-row-main" style={{ height: `${COLLAPSED_ROW_HEIGHT}px` }} onClick={toggleUncommittedExpanded}>
        <span class="commit-refs">
          <span class="badge uncommitted-badge">working tree</span>
        </span>
        <span class="commit-subject">Uncommitted changes ({props.files.length})</span>
        <span class="commit-date">{props.files.length} file{props.files.length === 1 ? "" : "s"}</span>
        <span class="commit-author">not committed</span>
        <span class="commit-hash mono">dirty</span>
      </div>
      <Show when={uncommittedExpanded()}>
        <div class="commit-detail">
          <div class="uncommitted-detail-body">
            <Show when={hasSelection()}>
              <div class="uncommitted-action-panel" onClick={(e) => e.stopPropagation()}>
                <label class="uncommitted-message-label" for="uncommitted-message">
                  Commit message
                </label>
                <textarea
                  id="uncommitted-message"
                  class="uncommitted-message-input"
                  value={message()}
                  rows={4}
                  onInput={(e) => setMessage(e.currentTarget.value)}
                  placeholder="Describe these changes"
                />
                <div class="uncommitted-action-buttons">
                  <button type="button" disabled={!canRunAction()} onClick={runCommit}>
                    Commit
                  </button>
                  <button type="button" disabled={!canRunAction()} onClick={runStash}>
                    Stash
                  </button>
                </div>
              </div>
            </Show>
            <div class="commit-files uncommitted-files">
              <For each={props.files}>
                {(f) => (
                  <div class={`commit-file status-${f.status}`}>
                    <input
                      class="uncommitted-file-checkbox"
                      type="checkbox"
                      checked={selectedPaths().has(f.path)}
                      onChange={() => togglePath(f.path)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span class="file-status">{statusLabel(f.status)}</span>
                    <span class="file-path">{f.path}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { FileChange } from "../../api/types";
import {
  COLLAPSED_ROW_HEIGHT,
  UNCOMMITTED_ROW_KEY,
  observeRowHeight,
  openFileDiff,
  runInTerminal,
  scheduleCommitRefresh,
  scheduleGraphRefresh,
  shellQuote,
  toggleUncommittedExpandedForRepo,
  uncommittedExpandedForRepo,
} from "../../state/store";
import { LineCounts } from "./LineCounts";

const SUBJECT_LIMIT = 72;
const RATIO_BLOCKS = 5;

function statusLabel(status: string): string {
  if (status === "untracked") return "U";
  return status[0]?.toUpperCase() ?? "M";
}

const STATUS_TITLES: Record<string, string> = {
  untracked: "Untracked",
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

/** Five blocks split green/red by the file's share of added vs deleted lines. */
function ratioBlocks(file: FileChange): ("add" | "del" | "none")[] {
  const added = file.additions ?? 0;
  const deleted = file.deletions ?? 0;
  const total = added + deleted;
  if (!total) return Array(RATIO_BLOCKS).fill("none");
  const green = Math.round((added / total) * RATIO_BLOCKS);
  return Array.from({ length: RATIO_BLOCKS }, (_, i) => (i < green ? "add" : "del"));
}

function CheckBox(props: { state: "on" | "off" | "mixed" }) {
  return (
    <span class="commit-panel-checkbox" classList={{ on: props.state !== "off" }} aria-hidden="true">
      {props.state === "on" ? "✓" : props.state === "mixed" ? "–" : ""}
    </span>
  );
}

export function UncommittedRow(props: { repoId: string; files: FileChange[] }) {
  let rowRef: HTMLDivElement | undefined;
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal("");

  const selected = createMemo(() => props.files.filter((file) => selectedPaths().has(file.path)));
  const count = () => selected().length;
  const allSelected = () => count() > 0 && count() === props.files.length;
  const canCommit = createMemo(() => count() > 0 && message().trim().length > 0);
  const subjectLength = () => message().split("\n")[0].length;
  const totals = createMemo(() =>
    props.files.reduce(
      (sum, file) => ({ add: sum.add + (file.additions ?? 0), del: sum.del + (file.deletions ?? 0) }),
      { add: 0, del: 0 },
    ),
  );
  const hint = () =>
    count() === 0
      ? "Select files to include in the commit."
      : !message().trim()
        ? `Add a message to commit ${count()} ${count() === 1 ? "file" : "files"}.`
        : "⌘ ↵ to commit";

  const togglePath = (path: string) => {
    const next = new Set(selectedPaths());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const toggleAll = () => setSelectedPaths(new Set(allSelected() ? [] : props.files.map((file) => file.path)));

  const selectedPathArgs = () => selected().map((file) => shellQuote(file.path)).join(" ");

  const runCommit = () => {
    if (!canCommit()) return;
    runInTerminal(props.repoId, `git add -- ${selectedPathArgs()} && git commit -m ${shellQuote(message().trim())}`);
    // The terminal also detects commits typed directly by the user (see
    // TerminalPanel), but we already know for certain one just happened
    // here, so schedule the refresh directly rather than relying on that
    // heuristic.
    scheduleCommitRefresh(props.repoId);
    setMessage("");
  };

  const runStash = () => {
    if (count() === 0) return;
    const text = message().trim();
    const messageArg = text ? ` -m ${shellQuote(text)}` : "";
    runInTerminal(props.repoId, `git stash push -u${messageArg} -- ${selectedPathArgs()}`);
    scheduleGraphRefresh(props.repoId);
    setMessage("");
  };

  const onCheckboxKey = (e: KeyboardEvent, toggle: () => void) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };

  onMount(() => {
    onCleanup(observeRowHeight(rowRef!, `${props.repoId}:${UNCOMMITTED_ROW_KEY}`));
  });

  return (
    <div ref={rowRef} class="commit-row uncommitted-row" classList={{ expanded: uncommittedExpandedForRepo(props.repoId) }} onContextMenu={(e) => e.preventDefault()}>
      <div class="commit-row-main" style={{ height: `${COLLAPSED_ROW_HEIGHT}px` }} onClick={() => toggleUncommittedExpandedForRepo(props.repoId)}>
        <span class="commit-refs">
          <span class="badge uncommitted-badge">working tree</span>
        </span>
        <span class="commit-subject">Uncommitted changes ({props.files.length})</span>
      </div>
      <Show when={uncommittedExpandedForRepo(props.repoId)}>
        <div class="commit-detail commit-panel-container">
          <div class="commit-panel" onClick={(e) => e.stopPropagation()}>
            <div class="commit-panel-compose">
              <div class="commit-panel-heading">
                <label class="commit-panel-label" for="uncommitted-message">
                  Commit message
                </label>
                <Show when={subjectLength()}>
                  <span class="commit-panel-subject-count" classList={{ over: subjectLength() > SUBJECT_LIMIT }}>
                    {subjectLength()} / {SUBJECT_LIMIT}
                  </span>
                </Show>
              </div>
              <textarea
                id="uncommitted-message"
                class="commit-panel-message"
                value={message()}
                rows={5}
                onInput={(e) => setMessage(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    runCommit();
                  }
                }}
                placeholder="Describe these changes"
              />
              <div class="commit-panel-actions">
                <button type="button" class="menu-primary-button commit-panel-commit" disabled={!canCommit()} onClick={runCommit}>
                  Commit
                  <Show when={count()}>
                    <span class="commit-panel-commit-count">{count()}</span>
                  </Show>
                </button>
                <button type="button" class="menu-secondary-button" disabled={count() === 0} onClick={runStash}>
                  Stash
                </button>
              </div>
              <div class="commit-panel-hint">{hint()}</div>
            </div>

            <div class="commit-panel-changes">
              <div class="commit-panel-changes-header">
                <span
                  role="checkbox"
                  tabIndex={0}
                  aria-label="Select all files"
                  aria-checked={allSelected() ? "true" : count() ? "mixed" : "false"}
                  class="commit-panel-toggle-all"
                  onClick={toggleAll}
                  onKeyDown={(e) => onCheckboxKey(e, toggleAll)}
                >
                  <CheckBox state={allSelected() ? "on" : count() ? "mixed" : "off"} />
                </span>
                <span class="commit-panel-label commit-panel-changes-title">Changes · {props.files.length}</span>
                <span class="commit-panel-totals">
                  <span class="lines-added">+{totals().add}</span>
                  <span class="lines-deleted">−{totals().del}</span>
                </span>
              </div>
              <div class="commit-panel-files">
                <For each={props.files}>
                  {(f) => {
                    const slash = f.path.lastIndexOf("/");
                    const name = slash > -1 ? f.path.slice(slash + 1) : f.path;
                    const dir = slash > -1 ? f.path.slice(0, slash) : "";
                    const isSelected = () => selectedPaths().has(f.path);
                    return (
                      <div
                        role="checkbox"
                        tabIndex={0}
                        aria-checked={isSelected()}
                        class={`commit-panel-file status-${f.status}`}
                        onClick={() => togglePath(f.path)}
                        onKeyDown={(e) => onCheckboxKey(e, () => togglePath(f.path))}
                      >
                        <CheckBox state={isSelected() ? "on" : "off"} />
                        <span class="file-status" title={STATUS_TITLES[f.status] ?? f.status}>
                          {statusLabel(f.status)}
                        </span>
                        <span class="commit-panel-file-path">
                          <span
                            class="commit-panel-file-name"
                            title="View changes"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFileDiff(props.repoId, null, f);
                            }}
                          >
                            {name}
                          </span>
                          <Show when={dir}>
                            <span class="commit-panel-file-dir">{dir}</span>
                          </Show>
                        </span>
                        <span class="commit-panel-file-stats">
                          <LineCounts file={f} />
                          <span class="commit-panel-ratio">
                            <For each={ratioBlocks(f)}>{(kind) => <span class={`ratio-${kind}`} />}</For>
                          </span>
                        </span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

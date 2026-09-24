import { For, Match, Show, Switch, createMemo, createResource, onCleanup, onMount } from "solid-js";
import { parse } from "diff2html/lib-esm/diff-parser";
import { fetchCommitFileDiff, fetchWorkingFileDiff } from "../../api/client";
import type { FileDiff } from "../../api/types";
import { buildOverviewMarks, buildSideBySideRows, type DiffCell, type SideBySideRow } from "../../lib/sideBySide";
import { closeFileDiff, commitDetails, diffFullFile, fileDiffModal, selectFileDiff, setDiffFullFile, uncommittedFiles } from "../../state/store";
import { ToggleField } from "../inputs/ToggleField";

function DiffPane(props: {
  side: "left" | "right";
  rows: SideBySideRow[];
  ref: (el: HTMLDivElement) => void;
  onScroll: (e: Event) => void;
}) {
  return (
    <div class={`file-diff-pane file-diff-pane-${props.side}`} ref={props.ref} onScroll={props.onScroll}>
      <table class="file-diff-table">
        <tbody>
          <For each={props.rows}>
            {(row) => {
              if (row.kind === "hunk") {
                return (
                  <tr class="diff-hunk">
                    <td colSpan={2}>{props.side === "left" ? row.header : ""}</td>
                  </tr>
                );
              }
              const cell: DiffCell | null = props.side === "left" ? row.left : row.right;
              const kind = cell ? `diff-${cell.kind}` : "diff-empty";
              return (
                <tr>
                  <td class={`diff-num ${kind}`}>{cell?.number || ""}</td>
                  <td class={`diff-code ${kind}`}>{cell?.text}</td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

// A column-high overview of the whole file: removed lines as red bars in the
// left half, added lines as green bars in the right half, each placed and
// sized by its share of the total rows.
function DiffOverview(props: { rows: SideBySideRow[] }) {
  const overview = createMemo(() => buildOverviewMarks(props.rows));
  const pct = (rows: number) => `${(rows / overview().total) * 100}%`;
  return (
    <div class="file-diff-overview">
      <For each={overview().marks}>
        {(mark) => (
          <>
            <Show when={mark.deleted > 0}>
              <div class="overview-bar overview-delete" style={{ top: pct(mark.start), height: pct(mark.deleted) }} />
            </Show>
            <Show when={mark.inserted > 0}>
              <div class="overview-bar overview-insert" style={{ top: pct(mark.start), height: pct(mark.inserted) }} />
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

function DiffTable(props: { diff: FileDiff }) {
  const rows = createMemo(() => {
    const files = parse(props.diff.patch);
    return buildSideBySideRows(files.flatMap((file) => file.blocks));
  });

  let leftPane: HTMLDivElement | undefined;
  let rightPane: HTMLDivElement | undefined;

  // Each side scrolls horizontally on its own; vertical scroll is kept in sync.
  const syncVertical = (from: "left" | "right") => (e: Event) => {
    const source = e.currentTarget as HTMLDivElement;
    const target = from === "left" ? rightPane : leftPane;
    if (target && target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
  };

  return (
    <Show when={rows().length > 0} fallback={<div class="file-diff-message">No textual changes.</div>}>
      <div class="file-diff-panes">
        <DiffPane side="left" rows={rows()} ref={(el) => (leftPane = el)} onScroll={syncVertical("left")} />
        <DiffPane side="right" rows={rows()} ref={(el) => (rightPane = el)} onScroll={syncVertical("right")} />
        <DiffOverview rows={rows()} />
      </div>
      <Show when={props.diff.truncated}>
        <div class="file-diff-message">Diff truncated — it is too large to display in full.</div>
      </Show>
    </Show>
  );
}

export function FileDiffModal() {
  const [diff] = createResource(
    () => {
      const target = fileDiffModal();
      return target ? { target, full: diffFullFile() } : null;
    },
    ({ target, full }) =>
      target.hash
        ? fetchCommitFileDiff(target.repo, target.hash, target.file, full)
        : fetchWorkingFileDiff(target.repo, target.file, full),
  );

  // Every file of the commit (or of the working tree) so the user can switch
  // between them without closing the modal.
  const files = createMemo(() => {
    const target = fileDiffModal();
    if (!target) return [];
    return target.hash ? commitDetails()[target.hash]?.files ?? [target.file] : uncommittedFiles();
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fileDiffModal()) closeFileDiff();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <Show when={fileDiffModal()}>
      {(target) => (
        <div class="menu-overlay file-diff-overlay" onClick={closeFileDiff}>
          <div class="file-diff-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="file-diff-header">
              <span class={`file-status status-${target().file.status}`}>{target().file.status[0]?.toUpperCase()}</span>
              <span class="file-diff-title">
                <Show when={target().file.old_path}>{(old) => <>{old()} → </>}</Show>
                {target().file.path}
              </span>
              <ToggleField class="file-diff-full-toggle" label="Full file" checked={diffFullFile()} onChange={setDiffFullFile} />
              <button type="button" class="menu-secondary-button" onClick={closeFileDiff}>
                Close
              </button>
            </div>
            <div class="file-diff-main">
              <div class="file-diff-files">
                <For each={files()}>
                  {(f) => (
                    <div
                      class={`file-diff-file status-${f.status}`}
                      classList={{ active: f.path === target().file.path }}
                      title={f.path}
                      onClick={() => selectFileDiff(f)}
                    >
                      <span class="file-status">{f.status === "untracked" ? "U" : f.status[0]?.toUpperCase()}</span>
                      <span class="file-diff-file-name">{f.path}</span>
                    </div>
                  )}
                </For>
              </div>
                <div class="file-diff-body">
                  <Switch>
                    <Match when={diff.error}>
                      <div class="file-diff-message">Could not load the diff for this file.</div>
                    </Match>
                    <Match when={diff.loading || !diff()}>
                      <div class="file-diff-message">Loading diff…</div>
                    </Match>
                    <Match when={diff()?.binary}>
                      <div class="file-diff-message">Binary file — no textual diff available.</div>
                    </Match>
                    <Match when={diff()}>{(d) => <DiffTable diff={d()} />}</Match>
                  </Switch>
                </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

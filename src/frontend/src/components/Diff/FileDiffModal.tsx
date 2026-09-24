import { For, Match, Show, Switch, createMemo, createResource, onCleanup, onMount } from "solid-js";
import { parse } from "diff2html/lib-esm/diff-parser";
import { fetchCommitFileDiff, fetchWorkingFileDiff } from "../../api/client";
import type { FileDiff } from "../../api/types";
import { buildSideBySideRows, type DiffCell } from "../../lib/sideBySide";
import { closeFileDiff, fileDiffModal } from "../../state/store";

function Cell(props: { cell: DiffCell | null }) {
  return (
    <>
      <td class={`diff-num ${props.cell ? `diff-${props.cell.kind}` : "diff-empty"}`}>{props.cell?.number || ""}</td>
      <td class={`diff-code ${props.cell ? `diff-${props.cell.kind}` : "diff-empty"}`}>{props.cell?.text}</td>
    </>
  );
}

function DiffTable(props: { diff: FileDiff }) {
  const rows = createMemo(() => {
    const files = parse(props.diff.patch);
    return buildSideBySideRows(files.flatMap((file) => file.blocks));
  });

  return (
    <Show when={rows().length > 0} fallback={<div class="file-diff-message">No textual changes.</div>}>
      <table class="file-diff-table">
        <colgroup>
          <col class="diff-col-num" />
          <col class="diff-col-code" />
          <col class="diff-col-num" />
          <col class="diff-col-code" />
        </colgroup>
        <tbody>
          <For each={rows()}>
            {(row) =>
              row.kind === "hunk" ? (
                <tr class="diff-hunk">
                  <td colSpan={4}>{row.header}</td>
                </tr>
              ) : (
                <tr>
                  <Cell cell={row.left} />
                  <Cell cell={row.right} />
                </tr>
              )
            }
          </For>
        </tbody>
      </table>
      <Show when={props.diff.truncated}>
        <div class="file-diff-message">Diff truncated — it is too large to display in full.</div>
      </Show>
    </Show>
  );
}

export function FileDiffModal() {
  const [diff] = createResource(fileDiffModal, (target) =>
    target.hash
      ? fetchCommitFileDiff(target.repo, target.hash, target.file)
      : fetchWorkingFileDiff(target.repo, target.file),
  );

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
              <button type="button" class="menu-secondary-button" onClick={closeFileDiff}>
                Close
              </button>
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
      )}
    </Show>
  );
}

import { For, Show, onCleanup, onMount } from "solid-js";
import type { FileChange } from "../../api/types";
import {
  COLLAPSED_ROW_HEIGHT,
  UNCOMMITTED_ROW_KEY,
  reportRowHeight,
  toggleUncommittedExpanded,
  uncommittedExpanded,
} from "../../state/store";

function statusLabel(status: string): string {
  if (status === "untracked") return "U";
  return status[0]?.toUpperCase() ?? "M";
}

export function UncommittedRow(props: { files: FileChange[] }) {
  let rowRef: HTMLDivElement | undefined;

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
          <div class="commit-files">
            <For each={props.files}>
              {(f) => (
                <div class={`commit-file status-${f.status}`}>
                  <span class="file-status">{statusLabel(f.status)}</span>
                  <span class="file-path">{f.path}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

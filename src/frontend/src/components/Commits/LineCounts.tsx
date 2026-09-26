import { Show } from "solid-js";
import type { FileChange } from "../../api/types";

/** `+added −deleted` for a changed file; zero sides are left blank. */
export function LineCounts(props: { file: FileChange }) {
  return (
    <span class="line-counts">
      <span class="lines-added">
        <Show when={props.file.additions}>+{props.file.additions}</Show>
      </span>
      <span class="lines-deleted">
        <Show when={props.file.deletions}>−{props.file.deletions}</Show>
      </span>
    </span>
  );
}

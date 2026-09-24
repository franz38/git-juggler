import { For, Show } from "solid-js";
import type { CommitDetail } from "../../api/types";
import { formatDate } from "../../lib/formatDate";
import { activeRepo, openFileDiff } from "../../state/store";

export function CommitDetailView(props: { detail?: CommitDetail }) {
  return (
    <div class="commit-detail">
      <Show when={props.detail} fallback={<div class="commit-detail-loading">Loading details…</div>}>
        <dl class="commit-meta">
          <dt>Commit</dt>
          <dd class="mono">{props.detail!.hash}</dd>
          <dt>Parents</dt>
          <dd class="mono">{props.detail!.parents.length ? props.detail!.parents.join(", ") : "(none)"}</dd>
          <dt>Author</dt>
          <dd>
            {props.detail!.author.name} &lt;{props.detail!.author.email}&gt;
          </dd>
          <dt>Committer</dt>
          <dd>
            {props.detail!.committer.name} &lt;{props.detail!.committer.email}&gt;
          </dd>
          <dt>Authored</dt>
          <dd>{formatDate(props.detail!.authored_date)}</dd>
          <dt>Committed</dt>
          <dd>{formatDate(props.detail!.committed_date)}</dd>
        </dl>
        <div class="commit-message">{props.detail!.message.trimEnd()}</div>
        <div class="commit-files">
          <For each={props.detail!.files}>
            {(f) => (
              <div
                class={`commit-file clickable status-${f.status}`}
                title="View changes"
                onClick={() => {
                  const repo = activeRepo();
                  if (repo) openFileDiff(repo, props.detail!.hash, f);
                }}
              >
                <span class="file-status">{f.status[0]?.toUpperCase()}</span>
                <span class="file-path">{f.path}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

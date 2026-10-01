import { For, Show, createEffect, createSignal } from "solid-js";
import {
  DEFAULT_GRAPH_PAGE_SIZE,
  MAX_GRAPH_PAGE_SIZE,
  addRepoPath,
  excludedPaths,
  excludedPathsError,
  graphPageSize,
  graphPageSizeError,
  openDirectoryBrowser,
  removeRepoPath,
  repoPaths,
  repoPathsError,
  saveExcludedPaths,
  saveGraphPageSize,
} from "../../state/store";
import { NumberField } from "../inputs/NumberField";
import { TextField } from "../inputs/TextField";

// The "Search paths" settings: which top-level folders get scanned for git
// repos, plus which per-repo paths are excluded from the uncommitted-changes
// check. Shared between the Settings menu (Repos section) and the welcome
// wizard's Repositories step — both just read/write the real setting.
export function RepoPathsSettings() {
  const [newPath, setNewPath] = createSignal("");
  const [excludedPathsDraft, setExcludedPathsDraft] = createSignal("");

  createEffect(() => {
    setExcludedPathsDraft(excludedPaths().join(", "));
  });

  const handleSaveExcludedPaths = () => {
    const next = excludedPathsDraft()
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    void saveExcludedPaths(next);
  };

  const handleAdd = () => {
    const path = newPath().trim();
    if (!path) return;
    void addRepoPath(path);
    setNewPath("");
  };

  return (
    <>
      <div class="menu-field">
        <span>Search paths</span>
        <p class="menu-hint">Repos are found among the immediate children of each path below.</p>
      <div class="menu-path-list">
        <For each={repoPaths()} fallback={<div class="menu-empty">No paths configured</div>}>
          {(path) => (
            <div class="menu-path-row">
              <span class="menu-path-text">{path}</span>
              <span class="menu-path-remove" onClick={() => void removeRepoPath(path)}>
                &times;
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="menu-add-path">
        <input
          type="text"
          placeholder="/absolute/path/to/projects"
          value={newPath()}
          onInput={(e) => setNewPath(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <button type="button" class="menu-secondary-button" onClick={() => openDirectoryBrowser((path) => setNewPath(path))}>
          Explore
        </button>
        <button type="button" class="menu-add-button" onClick={handleAdd}>
          Add
        </button>
      </div>
      <Show when={repoPathsError()}>
        <div class="menu-error">{repoPathsError()}</div>
      </Show>
      </div>
      <TextField
        label="Excluded paths"
        description="Comma-separated paths (relative to each repo's root) ignored when detecting uncommitted changes."
        placeholder=".claude"
        value={excludedPathsDraft()}
        onChange={setExcludedPathsDraft}
        onBlur={handleSaveExcludedPaths}
      />
      <Show when={excludedPathsError()}>
        <div class="menu-error">{excludedPathsError()}</div>
      </Show>
      <NumberField
        label="Commits per graph page"
        description={`How many commits to request when a repo graph loads and when older commits are fetched. Default ${DEFAULT_GRAPH_PAGE_SIZE}.`}
        min={1}
        max={MAX_GRAPH_PAGE_SIZE}
        value={graphPageSize()}
        onChange={(value) => void saveGraphPageSize(value ?? DEFAULT_GRAPH_PAGE_SIZE)}
      />
      <Show when={graphPageSizeError()}>
        <div class="menu-error">{graphPageSizeError()}</div>
      </Show>
    </>
  );
}

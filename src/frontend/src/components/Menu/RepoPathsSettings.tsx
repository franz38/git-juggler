import { For, Show, createEffect, createSignal } from "solid-js";
import {
  addRepoPath,
  excludedPaths,
  excludedPathsError,
  openDirectoryBrowser,
  removeRepoPath,
  repoPaths,
  repoPathsError,
  saveExcludedPaths,
} from "../../state/store";

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
      <label class="menu-field">
        <span>Excluded paths</span>
        <input
          type="text"
          placeholder=".claude"
          value={excludedPathsDraft()}
          onInput={(e) => setExcludedPathsDraft(e.currentTarget.value)}
          onBlur={handleSaveExcludedPaths}
        />
      </label>
      <p class="menu-hint">Comma-separated paths (relative to each repo's root) ignored when detecting uncommitted changes.</p>
      <Show when={excludedPathsError()}>
        <div class="menu-error">{excludedPathsError()}</div>
      </Show>
    </>
  );
}

import { For, Show, createEffect, createSignal } from "solid-js";
import {
  addIndividualRepoPath,
  addRepoPath,
  excludedPaths,
  excludedPathsError,
  individualRepoPaths,
  individualRepoPathsError,
  openDirectoryBrowser,
  removeIndividualRepoPath,
  removeRepoPath,
  repoPaths,
  repoPathsError,
  saveExcludedPaths,
} from "../../state/store";
import { TextField } from "../inputs/TextField";

// The "Search paths" settings: which top-level folders get scanned for git
// repos, which individual repos are added on top of those, plus which per-repo
// paths are excluded from the uncommitted-changes check. Shared between the
// Settings menu (Repos section) and the welcome wizard's Repositories step —
// both just read/write the real setting.
export function RepoPathsSettings() {
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

  return (
    <>
      <PathListField
        label="Search paths"
        hint="Repos are found among the immediate children of each path below."
        emptyText="No paths configured"
        placeholder="/absolute/path/to/projects"
        paths={repoPaths()}
        error={repoPathsError()}
        onAdd={addRepoPath}
        onRemove={removeRepoPath}
      />
      <PathListField
        label="Repositories"
        hint="Specific repos to show, wherever they live — no search path needed."
        emptyText="No repos added"
        placeholder="/absolute/path/to/repo"
        paths={individualRepoPaths()}
        error={individualRepoPathsError()}
        onAdd={addIndividualRepoPath}
        onRemove={removeIndividualRepoPath}
      />
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
    </>
  );
}

// A labelled list of absolute paths with a remove button per row, plus an
// input (typed or picked via the folder browser) to add another one.
function PathListField(props: {
  label: string;
  hint: string;
  emptyText: string;
  placeholder: string;
  paths: string[];
  error: string | null;
  onAdd: (path: string) => Promise<void>;
  onRemove: (path: string) => Promise<void>;
}) {
  const [newPath, setNewPath] = createSignal("");

  const handleAdd = () => {
    const path = newPath().trim();
    if (!path) return;
    void props.onAdd(path);
    setNewPath("");
  };

  return (
    <div class="menu-field">
      <span>{props.label}</span>
      <p class="menu-hint">{props.hint}</p>
      <div class="menu-path-list">
        <For each={props.paths} fallback={<div class="menu-empty">{props.emptyText}</div>}>
          {(path) => (
            <div class="menu-path-row">
              <span class="menu-path-text">{path}</span>
              <span class="menu-path-remove" onClick={() => void props.onRemove(path)}>
                &times;
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="menu-add-path">
        <input
          type="text"
          placeholder={props.placeholder}
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
      <Show when={props.error}>
        <div class="menu-error">{props.error}</div>
      </Show>
    </div>
  );
}

import { For, Show } from "solid-js";
import { closeDirectoryBrowser, directoryBrowser, navigateDirectoryBrowser, selectDirectoryBrowserPath } from "../../state/store";

export function DirectoryBrowserModal() {
  return (
    <Show when={directoryBrowser()}>
      {(state) => (
        <div class="menu-overlay" onClick={closeDirectoryBrowser}>
          <div class="create-tag-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Choose a folder</h3>
            <p class="directory-browser-path">{state().path}</p>
            <div class="directory-browser-list">
              <Show when={state().parent}>
                {(parent) => (
                  <div class="directory-browser-entry" onClick={() => navigateDirectoryBrowser(parent())}>
                    ..
                  </div>
                )}
              </Show>
              <For each={state().entries} fallback={<div class="menu-empty">No subfolders</div>}>
                {(entry) => (
                  <div class="directory-browser-entry" onClick={() => navigateDirectoryBrowser(entry.path)}>
                    {entry.name}
                  </div>
                )}
              </For>
            </div>
            <Show when={state().error}>
              <div class="menu-error">{state().error}</div>
            </Show>
            <div class="menu-actions">
              <button type="button" class="menu-secondary-button" onClick={closeDirectoryBrowser}>
                Cancel
              </button>
              <button type="button" class="menu-primary-button" onClick={selectDirectoryBrowserPath}>
                Select this folder
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

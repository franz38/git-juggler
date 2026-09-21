import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { BUILTIN_THEMES, type AppTheme } from "../../lib/appTheme";
import {
  importThemeFile,
  importedThemes,
  installedThemes,
  previewTheme,
  removeImportedTheme,
  setThemeId,
  themeId,
  themesError,
} from "../../state/themes";

function Swatch(props: { theme: AppTheme }) {
  const t = () => props.theme;
  const dots = () => [t().vars["--accent"], t().terminal.red, t().terminal.green, t().terminal.yellow, t().terminal.blue];
  return (
    <span class="theme-swatch" style={{ background: t().vars["--bg"], "border-color": t().vars["--border"] }}>
      <span class="theme-swatch-panel" style={{ background: t().vars["--panel-bg"] }} />
      <For each={dots()}>{(color) => <span class="theme-swatch-dot" style={{ background: color }} />}</For>
    </span>
  );
}

function ThemeRow(props: { theme: AppTheme; removable?: boolean }) {
  return (
    <div class="theme-row-wrap">
      <button
        class="theme-row"
        classList={{ active: themeId() === props.theme.id }}
        onClick={() => setThemeId(props.theme.id)}
        onMouseEnter={() => previewTheme(props.theme.id)}
        onFocus={() => previewTheme(props.theme.id)}
        onBlur={() => previewTheme(null)}
      >
        <Swatch theme={props.theme} />
        <span class="theme-row-name">{props.theme.name}</span>
        <span class="theme-row-kind">{props.theme.kind}</span>
      </button>
      <Show when={props.removable}>
        <button class="theme-row-remove" title="Remove imported theme" onClick={() => void removeImportedTheme(props.theme.id)}>
          ×
        </button>
      </Show>
    </div>
  );
}

export function ThemePicker() {
  const [query, setQuery] = createSignal("");
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null);
  let fileInput: HTMLInputElement | undefined;

  // A hover preview must never outlive the picker.
  onCleanup(() => previewTheme(null));

  const matches = (t: AppTheme) => t.name.toLowerCase().includes(query().trim().toLowerCase());
  const builtin = createMemo(() => BUILTIN_THEMES.filter(matches));
  const imported = createMemo(() => importedThemes().filter(matches));
  const installed = createMemo(() => installedThemes().filter(matches));

  const onFileChosen = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const warning = await importThemeFile(file);
      setNotice(warning ? { text: warning, error: false } : null);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Could not read that theme file.", error: true });
    }
  };

  return (
    <div class="theme-picker" onMouseLeave={() => previewTheme(null)}>
      <div class="theme-picker-toolbar">
        <input
          type="search"
          placeholder="Filter themes…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <button class="menu-secondary-button" onClick={() => fileInput?.click()}>
          Import theme file…
        </button>
        <input ref={fileInput} type="file" accept=".json,.jsonc,application/json" hidden onChange={onFileChosen} />
      </div>

      <Show when={notice()}>
        {(n) => <div classList={{ "menu-error": n().error, "menu-notice": !n().error }}>{n().text}</div>}
      </Show>
      <Show when={themesError()}>
        <div class="menu-error">Couldn't load installed VS Code themes: {themesError()}</div>
      </Show>

      <div class="theme-list">
        <Show when={builtin().length}>
          <div class="theme-group-label">Built-in</div>
          <For each={builtin()}>{(t) => <ThemeRow theme={t} />}</For>
        </Show>
        <Show when={imported().length}>
          <div class="theme-group-label">Imported</div>
          <For each={imported()}>{(t) => <ThemeRow theme={t} removable />}</For>
        </Show>
        <div class="theme-group-label">Installed VS Code themes</div>
        <For
          each={installed()}
          fallback={
            <p class="menu-hint">
              {installedThemes().length === 0
                ? "No VS Code themes found in ~/.vscode/extensions or the VS Code app. You can still import a theme file."
                : "No themes match."}
            </p>
          }
        >
          {(t) => <ThemeRow theme={t} />}
        </For>
      </div>
    </div>
  );
}

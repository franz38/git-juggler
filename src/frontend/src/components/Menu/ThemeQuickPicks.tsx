import { For, Show, createMemo, onCleanup } from "solid-js";
import { BUILTIN_DARK, BUILTIN_LIGHT, type AppTheme } from "../../lib/appTheme";
import { DEFAULT_THEME } from "../../lib/bundledThemes";
import { installedThemes, previewTheme, setThemeId, themeId } from "../../state/themes";

type Quick = { id: string; label: string; kind: "dark" | "light" | "system"; theme: AppTheme };

const QUICK_PICKS: Quick[] = [
  { id: BUILTIN_DARK.id, label: "Dark", kind: "dark", theme: BUILTIN_DARK },
  { id: BUILTIN_LIGHT.id, label: "Light", kind: "light", theme: BUILTIN_LIGHT },
  { id: "system", label: "System", kind: "system", theme: BUILTIN_DARK },
];

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

// A slimmed, three-card theme chooser for the welcome wizard: Dark, Light or
// System (resolved once, from the OS preference, at click time). Anything
// more — filtering, importing, browsing every installed VS Code theme — is
// the full ThemePicker's job, in Settings > Appearance.
export function ThemeQuickPicks() {
  // A hover/keyboard preview must never outlive the picker.
  onCleanup(() => previewTheme(null));

  const activeQuickId = createMemo(() => {
    if (themeId() === BUILTIN_DARK.id) return BUILTIN_DARK.id;
    if (themeId() === BUILTIN_LIGHT.id) return BUILTIN_LIGHT.id;
    return null;
  });

  const resolvedId = (quick: Quick) => (quick.kind === "system" ? (prefersDark() ? BUILTIN_DARK.id : BUILTIN_LIGHT.id) : quick.id);

  const pick = (quick: Quick) => setThemeId(resolvedId(quick));

  return (
    <div class="theme-quickpicks" onMouseLeave={() => previewTheme(null)}>
      <div class="theme-quickpick-grid">
        <For each={QUICK_PICKS}>
          {(quick) => (
            <button
              type="button"
              class="theme-quickpick-card"
              classList={{ active: activeQuickId() === quick.id }}
              onClick={() => pick(quick)}
              onMouseEnter={() => previewTheme(resolvedId(quick))}
              onMouseLeave={() => previewTheme(null)}
            >
              <span
                class="theme-quickpick-preview"
                style={{ background: quick.theme.vars["--bg"], "border-color": quick.theme.vars["--border"] }}
              >
                <span class="theme-quickpick-bar" style={{ background: quick.theme.vars["--accent"] }} />
                <span class="theme-quickpick-chip" style={{ background: quick.theme.vars["--border"] }} />
              </span>
              <span class="theme-quickpick-label">{quick.label}</span>
            </button>
          )}
        </For>
      </div>

      <div class="theme-quickpick-editor-section">
        <div class="menu-setting-label">Or pick another theme</div>
        <p class="menu-hint">
          <Show when={installedThemes().length > 0} fallback="More themes are searchable in Appearance later.">
            Includes {installedThemes().length} found in your editor — searchable in Appearance later.
          </Show>
        </p>
        <div class="theme-quickpick-mini-grid">
          <For each={[DEFAULT_THEME, ...installedThemes()]}>
            {(t) => (
              <button
                type="button"
                class="theme-quickpick-mini-card"
                classList={{ active: themeId() === t.id }}
                title={t.name}
                onClick={() => setThemeId(t.id)}
                onMouseEnter={() => previewTheme(t.id)}
                onMouseLeave={() => previewTheme(null)}
              >
                <span
                  class="theme-quickpick-mini-preview"
                  style={{ background: t.vars["--bg"], "border-color": t.vars["--border"] }}
                >
                  <span class="theme-quickpick-mini-bar" style={{ background: t.vars["--accent"] }} />
                </span>
                <span class="theme-quickpick-mini-label">{t.name}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

import { For, Show, createMemo } from "solid-js";
import { BUILTIN_DARK, BUILTIN_LIGHT, type AppTheme } from "../../lib/appTheme";
import { installedThemes, setThemeId, themeId } from "../../state/themes";

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
  const activeQuickId = createMemo(() => {
    if (themeId() === BUILTIN_DARK.id) return BUILTIN_DARK.id;
    if (themeId() === BUILTIN_LIGHT.id) return BUILTIN_LIGHT.id;
    return null;
  });

  const pick = (quick: Quick) => {
    if (quick.kind === "system") {
      setThemeId(prefersDark() ? BUILTIN_DARK.id : BUILTIN_LIGHT.id);
    } else {
      setThemeId(quick.id);
    }
  };

  return (
    <div class="theme-quickpicks">
      <div class="theme-quickpick-grid">
        <For each={QUICK_PICKS}>
          {(quick) => (
            <button
              type="button"
              class="theme-quickpick-card"
              classList={{ active: activeQuickId() === quick.id }}
              onClick={() => pick(quick)}
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

      <Show when={installedThemes().length > 0}>
        <div class="theme-quickpick-editor-row">
          <div>
            <div class="menu-setting-label">Or use one of your editor themes</div>
            <p class="menu-hint">{installedThemes().length} found — searchable in Appearance later.</p>
          </div>
          <select
            class="theme-quickpick-select"
            value=""
            onChange={(e) => {
              const id = e.currentTarget.value;
              if (id) setThemeId(id);
              e.currentTarget.value = "";
            }}
          >
            <option value="">Browse installed themes…</option>
            <For each={installedThemes()}>{(t) => <option value={t.id}>{t.name}</option>}</For>
          </select>
        </div>
      </Show>
    </div>
  );
}

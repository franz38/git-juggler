import { createMemo, createSignal } from "solid-js";
import { fetchThemes, saveImportedThemes } from "../api/client";
import { BUILTIN_DARK, BUILTIN_LIGHT, BUILTIN_THEMES, type AppTheme, type RawVscodeTheme } from "../lib/appTheme";
import { rawThemeFromFile, resolveVscodeTheme } from "../lib/vscodeTheme";

// --- Persistence ------------------------------------------------------------
// Only the selected theme id lives in localStorage (as before). The last
// resolved theme is cached next to it so a VS Code theme applies on the very
// first paint after a reload, before /api/themes has answered.

const THEME_KEY = "git-juggler:theme";
const THEME_CACHE_KEY = "git-juggler:themeCache";

function loadThemeId(): string {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    // Older versions stored just "light" or "dark".
    if (stored === "light") return BUILTIN_LIGHT.id;
    if (!stored || stored === "dark") return BUILTIN_DARK.id;
    return stored;
  } catch {
    return BUILTIN_DARK.id;
  }
}

function loadCachedTheme(): AppTheme | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppTheme;
    return parsed && typeof parsed.id === "string" && parsed.vars ? parsed : null;
  } catch {
    return null;
  }
}

function persist(id: string, theme: AppTheme | undefined): void {
  try {
    localStorage.setItem(THEME_KEY, id);
    if (theme) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
  } catch {
    // Not critical — theme just won't survive a reload.
  }
}

// --- State ------------------------------------------------------------------

const [themeId, setThemeIdSignal] = createSignal(loadThemeId());
const [previewId, setPreviewId] = createSignal<string | null>(null);
const [installedRaw, setInstalledRaw] = createSignal<RawVscodeTheme[]>([]);
const [importedRaw, setImportedRaw] = createSignal<RawVscodeTheme[]>([]);
const [themesError, setThemesError] = createSignal<string | null>(null);
const cachedTheme = loadCachedTheme();

export { themeId, themesError };

function resolveAll(raws: RawVscodeTheme[]): AppTheme[] {
  const out: AppTheme[] = [];
  for (const raw of raws) {
    try {
      out.push(resolveVscodeTheme(raw));
    } catch {
      // A malformed theme shouldn't take the whole picker down.
    }
  }
  return out;
}

export const installedThemes = createMemo(() => resolveAll(installedRaw()));
export const importedThemes = createMemo(() => resolveAll(importedRaw()));

const allThemes = createMemo<AppTheme[]>(() => [...BUILTIN_THEMES, ...importedThemes(), ...installedThemes()]);

/** The theme currently applied: a hover/keyboard preview wins over the saved choice. */
export const activeTheme = createMemo<AppTheme>(() => {
  const id = previewId() ?? themeId();
  return (
    allThemes().find((t) => t.id === id) ??
    (cachedTheme && cachedTheme.id === id ? cachedTheme : null) ??
    BUILTIN_DARK
  );
});

/** True while a theme is being previewed (hovered/focused) rather than chosen. */
export const isPreviewingTheme = (): boolean => previewId() !== null;

export function previewTheme(id: string | null): void {
  setPreviewId(id);
}

export function setThemeId(id: string): void {
  setPreviewId(null);
  setThemeIdSignal(id);
  persist(id, allThemes().find((t) => t.id === id));
}

// --- Loading / importing ------------------------------------------------------

export async function loadThemes(): Promise<void> {
  try {
    const res = await fetchThemes();
    setInstalledRaw(res.installed);
    setImportedRaw(res.imported);
    setThemesError(null);
    // Refresh the cache in case the theme file changed on disk.
    const id = themeId();
    persist(id, allThemes().find((t) => t.id === id));
  } catch (err) {
    setThemesError(err instanceof Error ? err.message : "Could not load themes");
  }
}

/** Import a VS Code theme file. Resolves with a warning to show, if any. */
export async function importThemeFile(file: File): Promise<string | null> {
  const { theme, hasInclude } = rawThemeFromFile(file.name, await file.text());
  const next = [...importedRaw().filter((t) => t.id !== theme.id), theme];
  setImportedRaw(next);
  setThemeId(theme.id);
  try {
    await saveImportedThemes(next);
  } catch {
    return "Theme applied, but it couldn't be saved to the backend; it may not persist.";
  }
  return hasInclude
    ? "This theme extends another theme (\"include\"), which can't be followed from a single file. Some colors may fall back to defaults."
    : null;
}

export async function removeImportedTheme(id: string): Promise<void> {
  const next = importedRaw().filter((t) => t.id !== id);
  setImportedRaw(next);
  if (themeId() === id) setThemeId(BUILTIN_DARK.id);
  try {
    await saveImportedThemes(next);
  } catch {
    setThemesError("Couldn't update the saved themes on the backend.");
  }
}

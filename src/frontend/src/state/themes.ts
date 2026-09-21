import { createMemo, createSignal } from "solid-js";
import { fetchThemes, saveImportedThemes } from "../api/client";
import type { Preferences } from "../api/types";
import { BUILTIN_DARK, BUILTIN_LIGHT, BUILTIN_THEMES, type AppTheme, type RawVscodeTheme } from "../lib/appTheme";
import { savePreference } from "./preferenceSync";
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

const PINNED_KEY = "git-juggler:pinnedThemes";

function isStored(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function loadPinned(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function cachePinned(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    // Not critical — pins just won't survive a reload without the server.
  }
}

// Refreshes only the cached copy of the resolved theme (never the "selected
// theme" key: that one must exist only once a choice was made or received from
// the server, because its presence is what lets this browser seed the server).
function cacheTheme(theme: AppTheme | undefined): void {
  try {
    if (theme) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
  } catch {
    // Not critical — theme just won't survive a reload.
  }
}

function persist(id: string, theme: AppTheme | undefined): void {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // Not critical — theme just won't survive a reload.
  }
  cacheTheme(theme);
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
  savePreference({ theme_id: id });
}

// --- Pinned themes ------------------------------------------------------------
// Pinned themes are listed first in the picker. Like the selected theme, the
// list is shared across browsers (localStorage is just the local cache).

const [pinnedThemeIds, setPinnedThemeIds] = createSignal<string[]>(loadPinned());
export { pinnedThemeIds };

export const isThemePinned = (id: string): boolean => pinnedThemeIds().includes(id);

export function togglePinTheme(id: string): void {
  const next = isThemePinned(id) ? pinnedThemeIds().filter((p) => p !== id) : [...pinnedThemeIds(), id];
  setPinnedThemeIds(next);
  cachePinned(next);
  savePreference({ pinned_themes: next });
}

/**
 * Reconciles the selected theme and pinned list with the backend's copy
 * (which wins, so every browser converges) and returns whatever exists only in
 * this browser so the caller can upload it. Doesn't write back to the server.
 */
export function applyRemoteThemePreferences(remote: Preferences): Preferences {
  const seed: Preferences = {};

  if (remote.theme_id) {
    setThemeIdSignal(remote.theme_id);
    persist(remote.theme_id, allThemes().find((t) => t.id === remote.theme_id));
  } else if (isStored(THEME_KEY)) {
    seed.theme_id = themeId();
  }

  if (remote.pinned_themes) {
    setPinnedThemeIds(remote.pinned_themes);
    cachePinned(remote.pinned_themes);
  } else if (isStored(PINNED_KEY)) {
    seed.pinned_themes = pinnedThemeIds();
  }

  return seed;
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
    cacheTheme(allThemes().find((t) => t.id === id));
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

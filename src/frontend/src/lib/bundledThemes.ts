import { BUILTIN_THEMES, type AppTheme, type RawVscodeTheme } from "./appTheme.ts";
import { resolveVscodeTheme } from "./vscodeTheme.ts";

// The "Github+Gruvbox" VS Code theme (correiagithubgruvbox.correia-github-gruvbox),
// reduced to the color keys resolveVscodeTheme reads, so it works on machines
// that don't have the extension installed.
export const GRUVBOX_RAW: RawVscodeTheme = {
  id: "bundled:github-gruvbox",
  label: "Github+Gruvbox",
  uiTheme: "vs-dark",
  colors: {
  "button.background": "#347d39",
  "descriptionForeground": "#768390",
  "dropdown.background": "#2d333b",
  "editor.background": "#22272e",
  "editor.foreground": "#adbac7",
  "editor.selectionBackground": "#3392ff44",
  "editorGroup.border": "#444c56",
  "editorWidget.background": "#2d333b",
  "errorForeground": "#e5534b",
  "focusBorder": "#316dca",
  "foreground": "#adbac7",
  "gitDecoration.addedResourceForeground": "#57ab5a",
  "gitDecoration.deletedResourceForeground": "#e5534b",
  "gitDecoration.modifiedResourceForeground": "#c69026",
  "input.background": "#22272e",
  "list.activeSelectionBackground": "#636e7b66",
  "list.activeSelectionForeground": "#adbac7",
  "list.hoverBackground": "#636e7b1a",
  "list.inactiveSelectionBackground": "#636e7b66",
  "panel.background": "#1c2128",
  "panel.border": "#444c56",
  "sideBar.background": "#1c2128",
  "sideBar.border": "#444c56",
  "tab.activeForeground": "#adbac7",
  "terminal.ansiBlack": "#545d68",
  "terminal.ansiBlue": "#539bf5",
  "terminal.ansiBrightBlack": "#636e7b",
  "terminal.ansiBrightBlue": "#6cb6ff",
  "terminal.ansiBrightCyan": "#56d4dd",
  "terminal.ansiBrightGreen": "#6bc46d",
  "terminal.ansiBrightMagenta": "#dcbdfb",
  "terminal.ansiBrightRed": "#ff938a",
  "terminal.ansiBrightWhite": "#cdd9e5",
  "terminal.ansiBrightYellow": "#daaa3f",
  "terminal.ansiCyan": "#39c5cf",
  "terminal.ansiGreen": "#57ab5a",
  "terminal.ansiMagenta": "#b083f0",
  "terminal.ansiRed": "#539bf5",
  "terminal.ansiWhite": "#909dab",
  "terminal.ansiYellow": "#c69026",
  "terminal.foreground": "#768390",
  "textLink.foreground": "#539bf5"
},
};

export const GRUVBOX_THEME: AppTheme = resolveVscodeTheme(GRUVBOX_RAW);

/** The theme used when nothing has been chosen yet (fresh install, reset). */
export const DEFAULT_THEME: AppTheme = GRUVBOX_THEME;

/** Every theme that ships with the app, default first. */
export const SHIPPED_THEMES: AppTheme[] = [DEFAULT_THEME, ...BUILTIN_THEMES];

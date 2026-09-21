import type { ITheme } from "@xterm/xterm";

export type ThemeKind = "light" | "dark";

/** Everything the UI needs from a theme, independent of where it came from. */
export interface AppTheme {
  id: string;
  name: string;
  kind: ThemeKind;
  /** CSS custom properties (with the leading `--`). */
  vars: Record<string, string>;
  terminal: ITheme;
  /** Six branch/graph colors. */
  branchPalette: string[];
  tagColor: string;
}

/** Raw VS Code theme as sent by the backend (include chain already merged). */
export interface RawVscodeTheme {
  id: string;
  label: string;
  uiTheme: string; // vs | vs-dark | hc-black | hc-light
  colors: Record<string, string>;
}

export const DEFAULT_BRANCH_PALETTE = [
  "#4C9AFF", // blue
  "#36B37E", // green
  "#FFAB00", // amber
  "#FF5630", // red-orange
  "#9C6ADE", // purple
  "#00B8D9", // teal
];

export const DEFAULT_TAG_COLOR = "#8993A4";

const DARK_VARS: Record<string, string> = {
  "--text": "#c8ccd4",
  "--text-dim": "#7d8590",
  "--text-h": "#f0f2f5",
  "--bg": "#0d1117",
  "--panel-bg": "#12151b",
  "--hover-bg": "#1c2129",
  "--active-bg": "#202632",
  "--border": "#262b33",
  "--accent": "#4c9aff",
  "--accent-fg": "#0d1117",
  "--danger": "#ff5630",
  "--danger-fg": "#ffb4b4",
  "--danger-bg": "#4a1f24",
  "--warning": "#ffd666",
  "--success": "#36b37e",
  "--menu-bg": "#12151b",
  "--input-bg": "#0d1117",
  "--shadow": "rgba(0, 0, 0, 0.5)",
  "--shadow-soft": "rgba(0, 0, 0, 0.45)",
};

const LIGHT_VARS: Record<string, string> = {
  "--text": "#3a3f46",
  "--text-dim": "#6e7781",
  "--text-h": "#1f2328",
  "--bg": "#ffffff",
  "--panel-bg": "#f6f8fa",
  "--hover-bg": "#eef0f2",
  "--active-bg": "#e4e7eb",
  "--border": "#d0d7de",
  "--accent": "#0969da",
  "--accent-fg": "#ffffff",
  "--danger": "#cf222e",
  "--danger-fg": "#a40e26",
  "--danger-bg": "#ffebe9",
  "--warning": "#9a6700",
  "--success": "#1a7f37",
  "--menu-bg": "#ffffff",
  "--input-bg": "#ffffff",
  "--shadow": "rgba(0, 0, 0, 0.5)",
  "--shadow-soft": "rgba(0, 0, 0, 0.45)",
};

export const BUILTIN_DARK: AppTheme = {
  id: "builtin:dark",
  name: "Dark (default)",
  kind: "dark",
  vars: DARK_VARS,
  terminal: {
    background: "#12151b",
    foreground: "#c8ccd4",
    cursor: "#c8ccd4",
    selectionBackground: "#264f78",
    // xterm.js's own default ANSI palette, spelled out so the picker swatch
    // can show it; identical to what the terminal rendered before.
    black: "#2e3436",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    brightBlack: "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#eeeeec",
  },
  branchPalette: DEFAULT_BRANCH_PALETTE,
  tagColor: DEFAULT_TAG_COLOR,
};

// Roughly GitHub-light-flavored ANSI palette, tuned so bright colors (yellow
// especially) stay readable against a white background.
export const BUILTIN_LIGHT: AppTheme = {
  id: "builtin:light",
  name: "Light (default)",
  kind: "light",
  vars: LIGHT_VARS,
  terminal: {
    background: "#ffffff",
    foreground: "#24292f",
    cursor: "#24292f",
    selectionBackground: "#add6ff",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
  branchPalette: DEFAULT_BRANCH_PALETTE,
  tagColor: DEFAULT_TAG_COLOR,
};

export const BUILTIN_THEMES: AppTheme[] = [BUILTIN_DARK, BUILTIN_LIGHT];

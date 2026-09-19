import type { ITheme } from "@xterm/xterm";
import type { Theme } from "../state/store";

const DARK_TERMINAL_THEME: ITheme = {
  background: "#12151b",
  foreground: "#c8ccd4",
  cursor: "#c8ccd4",
  selectionBackground: "#264f78",
};

// Roughly GitHub-light-flavored ANSI palette, tuned so bright colors (yellow
// especially) stay readable against a white background.
const LIGHT_TERMINAL_THEME: ITheme = {
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
};

export function getTerminalTheme(theme: Theme): ITheme {
  return theme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

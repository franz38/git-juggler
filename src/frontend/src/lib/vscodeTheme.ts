import type { ITheme } from "@xterm/xterm";
import {
  DEFAULT_BRANCH_PALETTE,
  type AppTheme,
  type RawVscodeTheme,
  type ThemeKind,
} from "./appTheme.ts";
import { blend, contrast, mix, parseColor, readableOn, toHex, withAlpha, type Rgba } from "./color.ts";

// Approximations of VS Code's built-in default terminal palettes, used when a
// theme leaves a terminal.ansi* key undefined (VS Code does the same).
const ANSI_KEYS = [
  ["black", "Black"],
  ["red", "Red"],
  ["green", "Green"],
  ["yellow", "Yellow"],
  ["blue", "Blue"],
  ["magenta", "Magenta"],
  ["cyan", "Cyan"],
  ["white", "White"],
  ["brightBlack", "BrightBlack"],
  ["brightRed", "BrightRed"],
  ["brightGreen", "BrightGreen"],
  ["brightYellow", "BrightYellow"],
  ["brightBlue", "BrightBlue"],
  ["brightMagenta", "BrightMagenta"],
  ["brightCyan", "BrightCyan"],
  ["brightWhite", "BrightWhite"],
] as const;

const DARK_ANSI = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5",
];
const LIGHT_ANSI = [
  "#000000", "#cd3131", "#00bc00", "#949800", "#0451a5", "#bc05bc", "#0598bc", "#555555",
  "#666666", "#cd3131", "#14ce14", "#b5ba00", "#0451a5", "#bc05bc", "#0598bc", "#a5a5a5",
];

// Defaults for the few keys every theme is expected to have but might not.
const FALLBACK = {
  dark: { bg: "#1f1f1f", fg: "#cccccc", accent: "#0078d4", danger: "#f85149", success: "#2ea043", warning: "#cca700" },
  light: { bg: "#ffffff", fg: "#3b3b3b", accent: "#005fb8", danger: "#e51400", success: "#2ea043", warning: "#bf8803" },
} as const;

export function kindFromUiTheme(uiTheme: string): ThemeKind {
  return uiTheme === "vs" || uiTheme === "hc-light" ? "light" : "dark";
}

/** Strip JSONC comments and trailing commas, leaving string contents alone. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas (outside strings; strings were copied verbatim, but a
  // regex over the whole text could still touch them, so walk again).
  let clean = "";
  let inStr = false;
  for (let k = 0; k < out.length; k++) {
    const ch = out[k];
    if (inStr) {
      clean += ch;
      if (ch === "\\") clean += out[++k] ?? "";
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      clean += ch;
    } else if (ch === ",") {
      let m = k + 1;
      while (m < out.length && /\s/.test(out[m])) m++;
      if (out[m] !== "}" && out[m] !== "]") clean += ch;
    } else {
      clean += ch;
    }
  }
  return JSON.parse(clean);
}

/**
 * Parse an uploaded VS Code theme file into a RawVscodeTheme. `include` is not
 * followed (a single upload can't resolve relative files); `hasInclude` tells
 * the caller to warn that the result may be incomplete.
 */
export function rawThemeFromFile(
  fileName: string,
  text: string,
): { theme: RawVscodeTheme; hasInclude: boolean } {
  const data = parseJsonc(text) as Record<string, unknown>;
  if (!data || typeof data !== "object" || typeof data.colors !== "object" || data.colors === null) {
    throw new Error("Not a VS Code color theme: no `colors` object found.");
  }
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.colors as Record<string, unknown>)) {
    if (typeof v === "string") colors[k] = v;
  }
  const type = typeof data.type === "string" ? data.type : "";
  const uiTheme = type === "light" ? "vs" : type === "hc" ? "hc-black" : type === "hc-light" ? "hc-light" : "vs-dark";
  const label = typeof data.name === "string" && data.name ? data.name : fileName.replace(/\.jsonc?$/i, "");
  return {
    theme: { id: `import:${label}`, label, uiTheme, colors },
    hasInclude: typeof data.include === "string",
  };
}

export function resolveVscodeTheme(raw: RawVscodeTheme): AppTheme {
  const kind = kindFromUiTheme(raw.uiTheme);
  const fb = FALLBACK[kind];
  const colors = raw.colors;
  const get = (...keys: string[]): Rgba | null => {
    for (const k of keys) {
      const c = parseColor(colors[k]);
      if (c) return c;
    }
    return null;
  };

  const bg = blend(get("editor.background") ?? parseColor(fb.bg)!, parseColor(fb.bg)!);
  const over = (c: Rgba, base: Rgba) => blend(c, base);
  const panel = over(get("sideBar.background", "panel.background") ?? bg, bg);
  const readable = (c: Rgba, against: Rgba, min: number) => (contrast(c, against) >= min ? c : readableOn(against));

  const text = readable(over(get("foreground", "editor.foreground") ?? parseColor(fb.fg)!, bg), bg, 3);
  const textH = readable(
    over(get("list.activeSelectionForeground", "tab.activeForeground", "editor.foreground") ?? text, bg),
    bg,
    3,
  );
  const textDim = over(get("descriptionForeground") ?? withAlpha(text, 0.6), bg);

  const hover = over(get("list.hoverBackground") ?? withAlpha(text, 0.06), panel);
  const active = over(get("list.activeSelectionBackground", "list.inactiveSelectionBackground") ?? withAlpha(text, 0.12), panel);
  const border = over(
    get("sideBar.border", "panel.border", "widget.border", "editorGroup.border", "contrastBorder") ??
      withAlpha(text, 0.15),
    bg,
  );

  let accent: Rgba | null = null;
  for (const c of [get("focusBorder"), get("button.background"), get("textLink.foreground")]) {
    if (!c) continue;
    const solid = over(c, bg);
    if (contrast(solid, bg) >= 2.5) {
      accent = solid;
      break;
    }
    accent ??= solid;
  }
  accent ??= parseColor(fb.accent)!;
  const accentFg = readableOn(accent);

  const ansi = (i: number): Rgba => {
    const [, suffix] = ANSI_KEYS[i];
    return get(`terminal.ansi${suffix}`) ?? parseColor((kind === "dark" ? DARK_ANSI : LIGHT_ANSI)[i])!;
  };

  const danger = over(get("editorError.foreground", "errorForeground", "gitDecoration.deletedResourceForeground") ?? parseColor(fb.danger)!, bg);
  const success = over(
    get("gitDecoration.addedResourceForeground", "charts.green") ?? ansi(2) ?? parseColor(fb.success)!,
    bg,
  );
  const warning = over(get("editorWarning.foreground", "charts.yellow", "gitDecoration.modifiedResourceForeground") ?? ansi(3), bg);

  const menuBg = over(get("menu.background", "editorWidget.background", "dropdown.background") ?? panel, bg);
  const inputBg = over(get("input.background") ?? bg, bg);
  const shadow = get("widget.shadow");

  const vars: Record<string, string> = {
    "--text": toHex(text),
    "--text-dim": toHex(textDim),
    "--text-h": toHex(textH),
    "--bg": toHex(bg),
    "--panel-bg": toHex(panel),
    "--hover-bg": toHex(hover),
    "--active-bg": toHex(active),
    "--border": toHex(border),
    "--accent": toHex(accent),
    "--accent-fg": toHex(accentFg),
    "--danger": toHex(danger),
    "--danger-fg": toHex(mix(danger, text, 0.5)),
    "--danger-bg": toHex(mix(bg, danger, 0.2)),
    "--warning": toHex(warning),
    "--success": toHex(success),
    "--menu-bg": toHex(menuBg),
    "--input-bg": toHex(inputBg),
    "--shadow": shadow && shadow.a > 0 ? toHex(withAlpha(shadow, Math.max(shadow.a, 0.35))) : "rgba(0, 0, 0, 0.5)",
    "--shadow-soft": shadow && shadow.a > 0 ? toHex(withAlpha(shadow, Math.max(shadow.a, 0.3))) : "rgba(0, 0, 0, 0.45)",
  };

  const termBg = over(get("terminal.background") ?? panel, bg);
  const termFg = over(get("terminal.foreground") ?? text, termBg);
  const terminal: ITheme = {
    background: toHex(termBg),
    foreground: toHex(termFg),
    cursor: toHex(over(get("terminalCursor.foreground") ?? termFg, termBg)),
    selectionBackground: toHex(
      over(get("terminal.selectionBackground", "editor.selectionBackground") ?? withAlpha(accent, 0.35), termBg),
    ),
  };
  ANSI_KEYS.forEach(([name], i) => {
    (terminal as Record<string, string>)[name] = toHex(over(ansi(i), termBg));
  });

  // Branch colors: prefer chart colors, then terminal ANSI, then app defaults.
  // Each must stay legible against the background.
  const candidates: (Rgba | null)[] = [
    get("charts.blue") ?? ansi(12),
    get("charts.green") ?? ansi(10),
    get("charts.yellow") ?? ansi(11),
    get("charts.orange", "charts.red") ?? ansi(9),
    get("charts.purple") ?? ansi(13),
    ansi(14),
  ];
  const branchPalette = candidates.map((c, i) => {
    const solid = c ? over(c, bg) : null;
    return solid && contrast(solid, bg) >= 3 ? toHex(solid) : DEFAULT_BRANCH_PALETTE[i];
  });

  return {
    id: raw.id,
    name: raw.label,
    kind,
    vars,
    terminal,
    branchPalette,
    tagColor: toHex(textDim),
  };
}

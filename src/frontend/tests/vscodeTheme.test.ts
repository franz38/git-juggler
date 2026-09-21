import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, toHex, blend } from "../src/lib/color.ts";
import { parseJsonc, rawThemeFromFile, resolveVscodeTheme, kindFromUiTheme } from "../src/lib/vscodeTheme.ts";
import { DEFAULT_BRANCH_PALETTE } from "../src/lib/appTheme.ts";

test("parseColor handles #RGB, #RGBA, #RRGGBB, #RRGGBBAA and rejects junk", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(Math.round(parseColor("#0008")!.a * 255), 0x88);
  assert.equal(toHex(parseColor("#2AA19899")!), "#2aa19899");
  assert.equal(parseColor("red"), null);
  assert.equal(parseColor(undefined), null);
});

test("blend composites alpha over an opaque background", () => {
  const out = blend(parseColor("#ffffff80")!, parseColor("#000000")!);
  assert.equal(toHex(out), "#808080");
});

test("parseJsonc strips comments and trailing commas but not string contents", () => {
  const v = parseJsonc(`{
    // line comment
    "a": "http://x.y/*not a comment*/", /* block */
    "b": [1, 2,],
  }`) as any;
  assert.equal(v.a, "http://x.y/*not a comment*/");
  assert.deepEqual(v.b, [1, 2]);
});

test("kindFromUiTheme", () => {
  assert.equal(kindFromUiTheme("vs"), "light");
  assert.equal(kindFromUiTheme("hc-light"), "light");
  assert.equal(kindFromUiTheme("vs-dark"), "dark");
  assert.equal(kindFromUiTheme("hc-black"), "dark");
});

const dark = {
  id: "t:dark",
  label: "Test Dark",
  uiTheme: "vs-dark",
  colors: {
    "editor.background": "#002B36",
    foreground: "#839496",
    "sideBar.background": "#00212B",
    "sideBar.border": "#2b2b4a",
    "list.hoverBackground": "#004454AA",
    "list.activeSelectionBackground": "#005A6F",
    focusBorder: "#2AA19899",
    "terminal.ansiRed": "#dc322f",
  },
};

test("resolve maps core keys and blends alpha over the right background", () => {
  const t = resolveVscodeTheme(dark);
  assert.equal(t.kind, "dark");
  assert.equal(t.vars["--bg"], "#002b36");
  assert.equal(t.vars["--panel-bg"], "#00212b");
  assert.equal(t.vars["--border"], "#2b2b4a");
  assert.equal(t.vars["--active-bg"], "#005a6f");
  // every var is opaque (6-digit) except the shadows
  for (const [k, v] of Object.entries(t.vars)) {
    if (k.startsWith("--shadow")) continue;
    assert.match(v, /^#[0-9a-f]{6}$/, k);
  }
  // hover was #004454AA over the panel, so it differs from the raw value
  assert.notEqual(t.vars["--hover-bg"], "#004454");
});

test("resolve falls back for a sparse theme and still yields a full terminal palette", () => {
  const t = resolveVscodeTheme({ id: "t:sparse", label: "Sparse", uiTheme: "vs-dark", colors: {} });
  assert.equal(t.terminal.red, "#cd3131");
  assert.equal(t.terminal.brightWhite, "#e5e5e5");
  assert.ok(t.vars["--accent"]);
  assert.equal(t.branchPalette.length, 6);
});

test("resolve uses light fallbacks for uiTheme vs", () => {
  const t = resolveVscodeTheme({ id: "t:l", label: "L", uiTheme: "vs", colors: {} });
  assert.equal(t.kind, "light");
  assert.equal(t.vars["--bg"], "#ffffff");
  assert.equal(t.terminal.green, "#00bc00");
});

test("theme ANSI keys override defaults", () => {
  assert.equal(resolveVscodeTheme(dark).terminal.red, "#dc322f");
});

test("low-contrast branch colors fall back to the default palette", () => {
  const t = resolveVscodeTheme({
    id: "t:c",
    label: "C",
    uiTheme: "vs-dark",
    colors: { "editor.background": "#202020", "charts.blue": "#222222", "charts.green": "#4ec9b0" },
  });
  assert.equal(t.branchPalette[0], DEFAULT_BRANCH_PALETTE[0]);
  assert.equal(t.branchPalette[1], "#4ec9b0");
});

test("text falls back to a readable color when the theme's is invisible", () => {
  const t = resolveVscodeTheme({
    id: "t:x",
    label: "X",
    uiTheme: "vs-dark",
    colors: { "editor.background": "#000000", foreground: "#010101" },
  });
  assert.equal(t.vars["--text"], "#ffffff");
});

test("rawThemeFromFile reads name/type, flags include, rejects non-themes", () => {
  const ok = rawThemeFromFile(
    "x.json",
    `{ // c
    "name": "Mine", "type": "light", "include": "./base.json", "colors": {"editor.background": "#fff",},}`,
  );
  assert.equal(ok.theme.label, "Mine");
  assert.equal(ok.theme.uiTheme, "vs");
  assert.equal(ok.hasInclude, true);
  assert.throws(() => rawThemeFromFile("y.json", `{"tokenColors": []}`));
});

import type { JSX } from "solid-js";

// Shared look for the input components. Everything resolves through the app's
// theme variables, so the fields follow whichever theme is active.

export const MONO = "ui-monospace, Menlo, Consolas, monospace";

export const labelStyle: JSX.CSSProperties = { "font-size": "13px", color: "var(--text-h)" };

export const descStyle: JSX.CSSProperties = { "font-size": "12px", color: "var(--text-dim)", "line-height": 1.5 };

export const borderFor = (focused: boolean) => `1px solid ${focused ? "var(--accent)" : "var(--border)"}`;

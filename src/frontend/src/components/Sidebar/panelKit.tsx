import { For, Show, createSignal, type JSX } from "solid-js";

/* Building blocks shared by the sidebar panels (Repos, Agents, Pipelines):
   header with a live dot, segmented filter, group heading, disclosure arrow
   and a hover-aware box. Colors come from the theme variables. */

export const MONO = "ui-monospace, Menlo, Consolas, monospace";

export const sectionLabel: JSX.CSSProperties = {
  "font-family": MONO,
  "font-size": "10px",
  "letter-spacing": "0.08em",
  color: "var(--text-dim)",
  "text-transform": "uppercase",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

export function Hoverable(props: {
  style: JSX.CSSProperties;
  hover: JSX.CSSProperties;
  onClick?: () => void;
  children: JSX.Element;
  title?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  ariaExpanded?: boolean;
}) {
  const [hovered, setHovered] = createSignal(false);
  return (
    <div
      role={props.role ?? "button"}
      aria-expanded={props.ariaExpanded}
      title={props.title}
      onClick={() => props.onClick?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...props.style, ...(hovered() ? props.hover : {}) }}
    >
      {props.children}
    </div>
  );
}

/** Small bordered button, as used for a row's actions. */
export function PanelButton(props: { onClick?: () => void; children: JSX.Element; muted?: boolean; title?: string }) {
  return (
    <Hoverable
      title={props.title}
      onClick={props.onClick}
      style={{
        padding: "6px 10px",
        "border-radius": "6px",
        border: "1px solid var(--border)",
        color: props.muted ? "var(--text-dim)" : "var(--text)",
        "font-size": "12px",
        "font-weight": 500,
        "white-space": "nowrap",
        cursor: "pointer",
      }}
      hover={{ background: "var(--hover-bg)", color: "var(--text-h)" }}
    >
      {props.children}
    </Hoverable>
  );
}

export function Disclosure(props: { open: boolean }) {
  return (
    <span
      style={{
        flex: "none",
        width: "10px",
        color: "var(--text-dim)",
        "font-size": "8px",
        transform: props.open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 160ms ease",
      }}
    >
      ▶
    </span>
  );
}

export function LiveDot(props: { color: string }) {
  return <span style={{ flex: "none", width: "6px", height: "6px", "border-radius": "3px", background: props.color }} />;
}

export interface SegmentOption<T extends string> {
  id: T;
  label: JSX.Element;
  count?: number;
  /** Color of the count when it's non-zero (dim otherwise). */
  tone?: string;
  title?: string;
}

/** The pill-shaped segmented control (panel filters, sidebar tabs). */
export function Segmented<T extends string>(props: { options: SegmentOption<T>[]; value: T; onChange: (id: T) => void; role?: JSX.HTMLAttributes<HTMLDivElement>["role"] }) {
  return (
    <div
      role={props.role ?? "tablist"}
      style={{ display: "flex", padding: "2px", gap: "2px", "border-radius": "7px", background: "var(--input-bg)", border: "1px solid var(--border)" }}
    >
      <For each={props.options}>
        {(option) => {
          const selected = () => props.value === option.id;
          return (
            <div
              role="tab"
              aria-selected={selected()}
              title={option.title}
              onClick={() => props.onChange(option.id)}
              style={{
                flex: 1,
                "min-width": 0,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                gap: "6px",
                padding: "5px 0",
                "border-radius": "5px",
                background: selected() ? "var(--active-bg)" : "transparent",
                color: selected() ? "var(--text-h)" : "var(--text-dim)",
                "font-size": "12px",
                "font-weight": 500,
                cursor: "pointer",
                "white-space": "nowrap",
                transition: "background-color 150ms ease, color 150ms ease",
              }}
            >
              {option.label}
              <Show when={option.count !== undefined}>
                <span style={{ "font-family": MONO, "font-size": "10px", color: option.count && option.tone ? option.tone : "var(--text-dim)" }}>{option.count}</span>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/** Title + live indicator + optional controls; sticks to the top of the scrolling sidebar. */
export function PanelHeader(props: { title: string; live: JSX.Element; liveTitle?: string; children?: JSX.Element }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        "z-index": 1,
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
        padding: "16px 16px 12px 16px",
        background: "var(--panel-bg)",
        "border-bottom": "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--text-h)" }}>{props.title}</div>
        <div
          title={props.liveTitle}
          style={{ display: "flex", "align-items": "center", gap: "6px", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)", "white-space": "nowrap" }}
        >
          {props.live}
        </div>
      </div>
      {props.children}
    </div>
  );
}

/** A group's uppercase label and its item count. */
export function GroupHeading(props: { label: string; count: number; title?: string }) {
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", padding: "0 8px 6px 8px" }}>
      <div style={sectionLabel} title={props.title}>
        {props.label}
      </div>
      <div style={{ "font-family": MONO, "font-size": "10px", color: "var(--text-dim)", opacity: 0.7 }}>{props.count}</div>
    </div>
  );
}

export function EmptyNote(props: { children: JSX.Element }) {
  return <div style={{ padding: "32px 16px", "text-align": "center", "font-size": "13px", color: "var(--text-dim)" }}>{props.children}</div>;
}

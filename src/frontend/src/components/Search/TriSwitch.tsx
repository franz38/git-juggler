import { For, Show, createSignal, splitProps, type JSX } from "solid-js";

export type TriState = "yes" | "unset" | "no";

export interface TriSwitchProps {
  /** Controlled value. Omit to use uncontrolled mode with `defaultValue`. */
  value?: TriState;
  defaultValue?: TriState;
  onChange?: (value: TriState) => void;
  label?: JSX.Element;
  labels?: Partial<Record<TriState, string>>;
  disabled?: boolean;
  class?: string;
}

const ORDER: TriState[] = ["yes", "unset", "no"];
const SEG_W = 40;
const GAP = 2;

const PILL_BG: Record<TriState, string> = {
  yes: "#2f6fbd",
  unset: "#2c2c2c",
  no: "#5a2a2a",
};
const ACTIVE_FG: Record<TriState, string> = {
  yes: "#ffffff",
  unset: "#ededed",
  no: "#f0c4c4",
};
const IDLE_FG = "#8f8f8f";
const EASE = "cubic-bezier(0.3, 0.7, 0.2, 1)";

export function TriSwitch(props: TriSwitchProps) {
  const [local] = splitProps(props, ["value", "defaultValue", "onChange", "label", "labels", "disabled", "class"]);
  const [inner, setInner] = createSignal<TriState>(local.defaultValue ?? "unset");
  const current = () => local.value ?? inner();
  const text = (s: TriState) => local.labels?.[s] ?? { yes: "Yes", unset: "Any", no: "No" }[s];

  const select = (s: TriState) => {
    if (local.disabled || s === current()) return;
    if (local.value === undefined) setInner(s);
    local.onChange?.(s);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = ORDER.indexOf(current());
    if (e.key === "ArrowRight") { e.preventDefault(); select(ORDER[Math.min(2, i + 1)]); }
    if (e.key === "ArrowLeft") { e.preventDefault(); select(ORDER[Math.max(0, i - 1)]); }
  };

  return (
    <div
      class={local.class}
      style={{ display: "flex", "align-items": "center", gap: "10px", opacity: local.disabled ? 0.5 : 1 }}
    >
      <div
        role="radiogroup"
        tabIndex={local.disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          display: "flex",
          padding: "2px",
          gap: `${GAP}px`,
          "border-radius": "7px",
          background: "#1b1b1b",
          border: "1px solid #333",
          outline: "none",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "2px",
            left: "2px",
            width: `${SEG_W}px`,
            height: "24px",
            "border-radius": "5px",
            background: PILL_BG[current()],
            transform: `translateX(${ORDER.indexOf(current()) * (SEG_W + GAP)}px)`,
            transition: `transform 220ms ${EASE}, background-color 220ms ease`,
          }}
        />
        <For each={ORDER}>
          {(s) => (
            <button
              type="button"
              role="radio"
              aria-checked={current() === s}
              tabIndex={-1}
              disabled={local.disabled}
              onClick={() => select(s)}
              style={{
                position: "relative",
                width: `${SEG_W}px`,
                height: "24px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                padding: "0",
                border: "none",
                "border-radius": "5px",
                background: "transparent",
                color: current() === s ? ACTIVE_FG[s] : IDLE_FG,
                font: "500 12px 'IBM Plex Sans', Helvetica, Arial, sans-serif",
                cursor: local.disabled ? "default" : "pointer",
                transition: "color 180ms ease",
              }}
            >
              {text(s)}
            </button>
          )}
        </For>
      </div>
      <Show when={local.label}>
        <span style={{ "font-size": "13px", color: "#d6d6d6" }}>{local.label}</span>
      </Show>
    </div>
  );
}

export default TriSwitch;

import { Show, createSignal, createUniqueId, type JSX } from "solid-js";

const FONT = "'IBM Plex Sans', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const C = {
  label: "#ededed",
  desc: "#8f8f8f",
  hint: "#6f6f6f",
  value: "#d6d6d6",
  inputBg: "#1b1b1b",
  inputBgAlt: "#232323",
  border: "#333333",
  borderAlt: "#3a3a3a",
  accent: "#2f6fbd",
  off: "#3a3a3a",
};

const labelStyle: JSX.CSSProperties = { "font-size": "13px", "font-weight": 500, color: C.label, "font-family": FONT };
const descStyle: JSX.CSSProperties = { "font-size": "12px", color: C.desc, "line-height": 1.5, "font-family": FONT };

interface BaseProps {
  label: string;
  description?: string;
  disabled?: boolean;
  class?: string;
}

export interface NumberFieldProps extends BaseProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Unit suffix inside the input, e.g. "sec". */
  unit?: string;
  width?: number;
}

export function NumberField(props: NumberFieldProps) {
  const id = createUniqueId();
  const [focus, setFocus] = createSignal(false);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) return;
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n));
    props.onChange(clamped);
  };
  return (
    <div class={props.class} style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px", padding: "12px 0" }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
        <label for={id} style={labelStyle}>{props.label}</label>
        <Show when={props.description}>
          <div style={descStyle}>{props.description}</div>
        </Show>
      </div>
      <div
        style={{
          flex: "none",
          width: `${props.width ?? 86}px`,
          "box-sizing": "border-box",
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "0 10px",
          "border-radius": "6px",
          background: C.inputBgAlt,
          border: `1px solid ${focus() ? C.accent : C.borderAlt}`,
          transition: "border-color 150ms ease",
          opacity: props.disabled ? 0.5 : 1,
        }}
      >
        <input
          id={id}
          type="number"
          inputmode="numeric"
          value={props.value}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          disabled={props.disabled}
          onChange={(e) => commit(e.currentTarget.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            "min-width": 0,
            padding: "6px 0",
            border: "none",
            background: "transparent",
            color: C.value,
            "font-family": MONO,
            "font-size": "12px",
            outline: "none",
          }}
        />
        <Show when={props.unit}>
          <span style={{ flex: "none", "font-family": MONO, "font-size": "11px", color: C.hint }}>{props.unit}</span>
        </Show>
      </div>
    </div>
  );
}

export default NumberField;

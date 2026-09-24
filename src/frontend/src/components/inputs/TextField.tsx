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

export interface TextFieldProps extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Small right-aligned hint next to the label, e.g. "comma-separated". */
  hint?: string;
  /** Use monospace for the value (paths, URLs). Default true. */
  mono?: boolean;
}

export function TextField(props: TextFieldProps) {
  const id = createUniqueId();
  const [focus, setFocus] = createSignal(false);
  return (
    <div class={props.class} style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "14px 0" }}>
      <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between", gap: "12px" }}>
        <label for={id} style={labelStyle}>{props.label}</label>
        <Show when={props.hint}>
          <span style={{ "font-size": "12px", color: C.hint, "font-family": FONT }}>{props.hint}</span>
        </Show>
      </div>
      <input
        id={id}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: "8px 10px",
          "border-radius": "6px",
          background: C.inputBg,
          border: `1px solid ${focus() ? C.accent : C.border}`,
          color: C.value,
          "font-family": props.mono === false ? FONT : MONO,
          "font-size": "12px",
          outline: "none",
          transition: "border-color 150ms ease",
          opacity: props.disabled ? 0.5 : 1,
        }}
      />
      <Show when={props.description}>
        <div style={descStyle}>{props.description}</div>
      </Show>
    </div>
  );
}

export default TextField;

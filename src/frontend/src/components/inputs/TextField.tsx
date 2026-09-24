import { Show, createSignal, createUniqueId } from "solid-js";
import { MONO, borderFor, descStyle, labelStyle } from "./styles";

export interface TextFieldProps {
  label: string;
  value: string;
  /** Called on every edit with the current text. */
  onChange: (value: string) => void;
  /** Called when the field loses focus. */
  onBlur?: () => void;
  description?: string;
  placeholder?: string;
  /** Small right-aligned hint next to the label, e.g. "comma-separated". */
  hint?: string;
  /** Use monospace for the value (paths, URLs). Default true. */
  mono?: boolean;
  disabled?: boolean;
  class?: string;
}

export function TextField(props: TextFieldProps) {
  const id = createUniqueId();
  const [focus, setFocus] = createSignal(false);
  return (
    <div class={props.class} style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between", gap: "12px" }}>
        <label for={id} style={labelStyle}>{props.label}</label>
        <Show when={props.hint}>
          <span style={descStyle}>{props.hint}</span>
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
        onBlur={() => {
          setFocus(false);
          props.onBlur?.();
        }}
        style={{
          padding: "6px 8px",
          "border-radius": "4px",
          background: "var(--input-bg)",
          border: borderFor(focus()),
          color: "var(--text)",
          font: "inherit",
          "font-family": props.mono === false ? "inherit" : MONO,
          "font-size": "12px",
          outline: "none",
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

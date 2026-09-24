import { Show, createSignal, createUniqueId } from "solid-js";
import { MONO, borderFor, descStyle, labelStyle } from "./styles";

export interface NumberFieldProps {
  label: string;
  value: number;
  /**
   * Called when an edit is committed (on blur / Enter) with the value clamped to
   * min/max, or `null` when the field was left empty or isn't a number. What an
   * empty field means is up to the caller.
   */
  onChange: (value: number | null) => void;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Unit suffix inside the input, e.g. "sec". */
  unit?: string;
  width?: number;
  disabled?: boolean;
  class?: string;
}

export function NumberField(props: NumberFieldProps) {
  const id = createUniqueId();
  const [focus, setFocus] = createSignal(false);

  const commit = (input: HTMLInputElement) => {
    const n = input.valueAsNumber;
    props.onChange(Number.isNaN(n) ? null : Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n)));
    // Always show the value the caller actually applied, even when it equals
    // the previous one (in which case no re-render would refresh the input).
    input.value = String(props.value);
  };

  return (
    <div class={props.class} style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px" }}>
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
          padding: "0 8px",
          "border-radius": "4px",
          background: "var(--input-bg)",
          border: borderFor(focus()),
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
          onChange={(e) => commit(e.currentTarget)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            "min-width": 0,
            padding: "5px 0",
            border: "none",
            background: "transparent",
            color: "var(--text)",
            "font-family": MONO,
            "font-size": "12px",
            outline: "none",
          }}
        />
        <Show when={props.unit}>
          <span style={{ flex: "none", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>{props.unit}</span>
        </Show>
      </div>
    </div>
  );
}

export default NumberField;

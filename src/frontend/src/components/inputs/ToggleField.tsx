import { Show, createUniqueId } from "solid-js";
import { descStyle, labelStyle } from "./styles";

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  class?: string;
}

export function ToggleField(props: ToggleFieldProps) {
  const id = createUniqueId();
  const toggle = () => !props.disabled && props.onChange(!props.checked);
  return (
    <div class={props.class} style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px" }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
        <label for={id} style={{ ...labelStyle, cursor: props.disabled ? "default" : "pointer" }}>{props.label}</label>
        <Show when={props.description}>
          <div style={descStyle}>{props.description}</div>
        </Show>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={toggle}
        style={{
          flex: "none",
          width: "30px",
          height: "18px",
          padding: "2px",
          border: "none",
          "border-radius": "9px",
          "box-sizing": "border-box",
          display: "flex",
          background: props.checked ? "var(--accent)" : "var(--border)",
          cursor: props.disabled ? "default" : "pointer",
          opacity: props.disabled ? 0.5 : 1,
          transition: "background-color 180ms ease",
        }}
      >
        <span
          style={{
            width: "14px",
            height: "14px",
            "border-radius": "7px",
            background: "#ffffff",
            "box-shadow": "0 1px 2px rgba(0,0,0,0.35)",
            transform: props.checked ? "translateX(12px)" : "translateX(0px)",
            transition: "transform 200ms cubic-bezier(0.3, 0.7, 0.2, 1)",
          }}
        />
      </button>
    </div>
  );
}

export default ToggleField;

import { For, Show, createSignal } from "solid-js";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

export function MultiSelect(props: MultiSelectProps) {
  const [open, setOpen] = createSignal(false);

  const label = () => {
    const n = props.selected.length;
    if (n === 0) return props.placeholder;
    if (n === 1) return props.selected[0];
    return `${n} selected`;
  };

  const toggle = (option: string) => {
    const next = props.selected.includes(option) ? props.selected.filter((o) => o !== option) : [...props.selected, option];
    props.onChange(next);
  };

  return (
    <div class="multiselect">
      <button type="button" class="multiselect-trigger" classList={{ active: props.selected.length > 0 }} onClick={() => setOpen((o) => !o)}>
        <span class="multiselect-trigger-label">{label()}</span>
        <svg class="multiselect-caret" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="multiselect-overlay" onClick={() => setOpen(false)} />
        <div class="multiselect-panel">
          <For each={props.options}>
            {(option) => (
              <label class="multiselect-option">
                <input type="checkbox" checked={props.selected.includes(option)} onChange={() => toggle(option)} />
                <span>{option}</span>
              </label>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { CaretDownIcon } from "../icons";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

export function MultiSelect(props: MultiSelectProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [placement, setPlacement] = createSignal<JSX.CSSProperties>({});
  let triggerRef: HTMLButtonElement | undefined;

  const filteredOptions = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.options;
    return props.options.filter((option) => option.toLowerCase().includes(needle));
  });

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

  const placePanel = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const downward = below >= Math.min(180, above);
    const maxHeight = Math.max(120, downward ? below : above);
    setPlacement({
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      "max-height": `${maxHeight}px`,
      ...(downward ? { top: `${rect.bottom + gap}px` } : { bottom: `${window.innerHeight - rect.top + gap}px` }),
    });
  };

  createEffect(() => {
    if (!open()) return;
    placePanel();
    window.addEventListener("scroll", placePanel, true);
    window.addEventListener("resize", placePanel);
    onCleanup(() => {
      window.removeEventListener("scroll", placePanel, true);
      window.removeEventListener("resize", placePanel);
    });
  });

  return (
    <div class="multiselect">
      <button ref={triggerRef} type="button" class="multiselect-trigger" classList={{ active: props.selected.length > 0 }} onClick={() => setOpen((o) => !o)}>
        <span class="multiselect-trigger-label">{label()}</span>
        <CaretDownIcon />
      </button>
      <Show when={open()}>
        <Portal>
        <div class="multiselect-overlay" onClick={() => setOpen(false)} />
        <div class="multiselect-panel" style={placement()}>
          <input
            class="multiselect-search"
            type="text"
            value={query()}
            placeholder="Search..."
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Show when={filteredOptions().length > 0} fallback={<div class="multiselect-empty">No matches</div>}>
          <For each={filteredOptions()}>
            {(option) => (
              <label class="multiselect-option">
                <input type="checkbox" checked={props.selected.includes(option)} onChange={() => toggle(option)} />
                <span>{option}</span>
              </label>
            )}
          </For>
          </Show>
        </div>
        </Portal>
      </Show>
    </div>
  );
}

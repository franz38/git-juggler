import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { parseColor, toHex, withAlpha } from "../../lib/color";
import { matchVariables, openTokenAt, splitTemplate, tokenReplaceEnd, type TemplateVariable } from "../../lib/templateTokens";
import { useOverlay } from "../../state/overlayStack";

interface TemplateInputProps {
  value: string;
  onInput: (value: string) => void;
  variables: TemplateVariable[];
  placeholder?: string;
}

const PANEL_WIDTH = 320;

const tint = (color: string) => {
  const parsed = parseColor(color);
  return parsed ? toHex(withAlpha(parsed, 0.16)) : "transparent";
};

// A plain text input whose `{variable}` tokens are colored, with variable
// suggestions while a `{` is being typed. The input itself is untouched: its
// text is made transparent and a click-through mirror on top paints the same
// text with colored tokens, scrolled in step with the input.
export function TemplateInput(props: TemplateInputProps) {
  let inputRef!: HTMLInputElement;
  let mirrorRef!: HTMLDivElement;
  let panelRef: HTMLDivElement | undefined;
  const [scrollX, setScrollX] = createSignal(0);
  const [token, setToken] = createSignal<{ start: number; query: string } | null>(null);
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [placement, setPlacement] = createSignal<JSX.CSSProperties>({});

  const segments = createMemo(() => splitTemplate(props.value, props.variables));

  const matches = createMemo(() => {
    const current = token();
    return current ? matchVariables(current.query, props.variables) : [];
  });

  const panelOpen = () => open() && matches().length > 0;
  const close = () => setOpen(false);
  useOverlay(`template-input-${createUniqueId()}`, panelOpen, close);

  const syncScroll = () => {
    setScrollX(inputRef.scrollLeft);
    requestAnimationFrame(() => setScrollX(inputRef.scrollLeft));
  };

  // Re-reads the caret. Typing a `{` (or more of a name after one) opens the
  // suggestions; moving the caret out of a `{partial` closes them.
  const refreshToken = (openIfInToken: boolean) => {
    const caret = inputRef.selectionStart ?? 0;
    const next = caret === inputRef.selectionEnd ? openTokenAt(inputRef.value, caret) : null;
    if (next?.query !== token()?.query || next?.start !== token()?.start) setActiveIndex(0);
    setToken(next);
    if (!next) close();
    else if (openIfInToken) setOpen(true);
  };

  const accept = (variable: TemplateVariable) => {
    const current = token();
    if (!current) return;
    const caret = inputRef.selectionStart ?? current.start + 1 + current.query.length;
    const end = tokenReplaceEnd(inputRef.value, caret);
    const text = `{${variable.name}}`;
    inputRef.focus();
    inputRef.setSelectionRange(current.start, end);
    // execCommand keeps the edit on the input's native undo stack and fires
    // the regular input event; fall back to a direct edit where unsupported.
    if (!document.execCommand("insertText", false, text)) {
      inputRef.setRangeText(text, current.start, end, "end");
      props.onInput(inputRef.value);
    }
    close();
    setToken(null);
    syncScroll();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!panelOpen()) return;
    const count = matches().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
      panelRef?.querySelector(".template-suggest-option.active")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(matches()[Math.min(activeIndex(), count - 1)]);
    }
  };

  // The mirror has to sit exactly over the input's text: copy the box
  // metrics and font the input ends up with from whatever styles it.
  onMount(() => {
    const cs = getComputedStyle(inputRef);
    const inset = (side: "Top" | "Right" | "Bottom" | "Left") =>
      `${parseFloat(cs[`border${side}Width`]) + parseFloat(cs[`padding${side}`])}px`;
    Object.assign(mirrorRef.style, {
      top: inset("Top"),
      right: inset("Right"),
      bottom: inset("Bottom"),
      left: inset("Left"),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      wordSpacing: cs.wordSpacing,
    });
  });

  // Programmatic value changes (draft resets, the accept above) can move the
  // input's scroll position without a scroll event.
  createEffect(() => {
    void props.value;
    requestAnimationFrame(() => setScrollX(inputRef.scrollLeft));
  });

  const placePanel = () => {
    const current = token();
    if (!current) return;
    const rect = inputRef.getBoundingClientRect();
    const mirrorRect = mirrorRef.getBoundingClientRect();
    const ctx = document.createElement("canvas").getContext("2d");
    let offset = 0;
    if (ctx) {
      const cs = getComputedStyle(inputRef);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      offset = ctx.measureText(inputRef.value.slice(0, current.start)).width - inputRef.scrollLeft;
    }
    const anchor = mirrorRect.left + Math.max(0, Math.min(offset, mirrorRect.width));
    const margin = 8;
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const downward = below >= Math.min(220, above);
    setPlacement({
      left: `${Math.max(margin, Math.min(anchor - 6, window.innerWidth - PANEL_WIDTH - margin))}px`,
      width: `${PANEL_WIDTH}px`,
      "max-height": `${Math.max(120, Math.min(280, downward ? below : above))}px`,
      ...(downward ? { top: `${rect.bottom + gap}px` } : { bottom: `${window.innerHeight - rect.top + gap}px` }),
    });
  };

  createEffect(() => {
    if (!panelOpen()) return;
    void token()?.start;
    placePanel();
    window.addEventListener("scroll", placePanel, true);
    window.addEventListener("resize", placePanel);
    onCleanup(() => {
      window.removeEventListener("scroll", placePanel, true);
      window.removeEventListener("resize", placePanel);
    });
  });

  return (
    <div class="template-input">
      <input
        ref={inputRef}
        type="text"
        classList={{ "template-input-filled": props.value.length > 0 }}
        value={props.value}
        placeholder={props.placeholder}
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
          refreshToken(true);
          syncScroll();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => {
          refreshToken(false);
          syncScroll();
        }}
        onMouseUp={() => {
          refreshToken(false);
          syncScroll();
        }}
        onSelect={syncScroll}
        onScroll={syncScroll}
        onFocus={syncScroll}
        onBlur={() => {
          close();
          syncScroll();
        }}
      />
      <div ref={mirrorRef} class="template-input-mirror" aria-hidden="true">
        <div class="template-input-mirror-text" style={{ transform: `translateX(${-scrollX()}px)` }}>
          <For each={segments()}>
            {(segment) =>
              segment.variable ? (
                <span class="template-input-token" style={{ color: segment.variable.color, background: tint(segment.variable.color), "box-shadow": `0 0 0 1px ${tint(segment.variable.color)}` }}>
                  {segment.text}
                </span>
              ) : segment.unknown ? (
                <span class="template-input-token unknown">{segment.text}</span>
              ) : (
                segment.text
              )
            }
          </For>
        </div>
      </div>
      <Show when={panelOpen()}>
        <Portal>
          <div ref={panelRef} class="template-suggest" style={placement()} onMouseDown={(e) => e.preventDefault()}>
            <For each={matches()}>
              {(variable, index) => (
                <div
                  class="template-suggest-option"
                  classList={{ active: index() === activeIndex() }}
                  title={variable.description}
                  onMouseEnter={() => setActiveIndex(index())}
                  onClick={() => accept(variable)}
                >
                  <div class="template-suggest-row">
                    <span class="template-suggest-name" style={{ color: variable.color }}>{`{${variable.name}}`}</span>
                    <Show when={variable.example}>
                      <span class="template-suggest-example">{variable.example}</span>
                    </Show>
                  </div>
                  <div class="template-suggest-description">{variable.description}</div>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

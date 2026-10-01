import { For, Show, createMemo, createSignal, onMount } from "solid-js";

/* Create tag dialog — one form; adding a message makes it annotated. SolidJS, inline styles.
   Colors are theme variables (not the design's fixed dark palette) so it follows the active theme. */

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "inherit";
const ACCENT = "var(--accent)";
const DANGER = "var(--danger)";
const ERROR_BORDER = "color-mix(in srgb, var(--danger) 60%, var(--border))";

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const SUBMIT_KEYS = isMac ? "⌘↵" : "Ctrl ↵";

export interface RecentTag {
  name: string;
  sha: string;
  /** Pre-formatted, e.g. "1d". */
  age?: string;
  /** Unknown when undefined. */
  annotated?: boolean;
}

export interface CreateTagDialogProps {
  sha: string;
  subject: string;
  /** All existing tag names, for the "already exists" check. */
  existingTags?: string[];
  /** Latest tags, newest first. Hidden when empty. */
  recentTags?: RecentTag[];
  /** How many recent tags to show. Default 3. */
  recentCount?: number;
  /** e.g. "0.2.13" — shown as a "Use …" shortcut. */
  suggestedName?: string;
  /** Resolves to an error message when creating failed; the dialog stays open showing it. */
  onCreate: (tag: { name: string; message?: string; annotated: boolean }) => void | string | Promise<void | string>;
  onCancel: () => void;
}

// Whitespace isn't listed: it's turned into "-" (see tagName()). A leading "-" would be read as an option.
const BAD_REF = /[~^:?*\[\\\x00-\x1f\x7f]|\.\.|^[.-]|\.$|\/$|\.lock$|@\{|^@$/;

export function CreateTagDialog(props: CreateTagDialogProps) {
  const [name, setName] = createSignal("");
  const [msg, setMsg] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let input!: HTMLInputElement;
  onMount(() => input?.focus());

  const n = () => name().trim().replace(/\s+/g, "-");
  const annotated = () => msg().trim().length > 0;
  const check = createMemo(() => {
    if (!n()) return { invalid: true, error: false, hint: "Lightweight and annotated tags both point at this commit." };
    if (BAD_REF.test(n())) return { invalid: true, error: true, hint: "Not a valid tag name — no ~ ^ : ? * [ \\, “..” or leading “-”." };
    if (props.existingTags?.includes(n())) {
      const on = props.recentTags?.find((t) => t.name === n())?.sha;
      return { invalid: true, error: true, hint: `Tag ${n()} already exists${on ? ` on ${on.slice(0, 7)}` : ""}.` };
    }
    return { invalid: false, error: false, hint: `Will create refs/tags/${n()}` };
  });
  const recent = () => (props.recentTags ?? []).slice(0, props.recentCount ?? 3);
  const pick = (value: string) => { setName(value); setError(""); input.focus(); };

  const submit = async () => {
    if (check().invalid || busy()) return;
    const tagName = n();
    setName(tagName);
    setError("");
    setBusy(true);
    try {
      const failure = await props.onCreate({ name: tagName, message: annotated() ? msg().trim() : undefined, annotated: annotated() });
      if (failure) setError(failure);
    } finally { setBusy(false); }
  };
  // Escape is left to the app-wide overlay stack, which closes the topmost overlay.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
    else if (e.key === "Enter" && e.target === input) { e.preventDefault(); void submit(); }
  };

  const field = { "box-sizing": "border-box", "border-radius": "6px", background: "var(--input-bg)", border: "1px solid var(--border)", outline: "none" } as const;
  const focusOn = (e: FocusEvent) => ((e.currentTarget as HTMLElement).style.borderColor = ACCENT);
  const focusOff = (err: () => boolean) => (e: FocusEvent) => ((e.currentTarget as HTMLElement).style.borderColor = err() ? ERROR_BORDER : "var(--border)");
  const disabled = () => check().invalid || busy();

  return (
    <div role="dialog" aria-label="Create tag" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
      style={{ width: "420px", "max-width": "calc(100vw - 32px)", "max-height": "80vh", "overflow-y": "auto", display: "flex", "flex-direction": "column", "border-radius": "10px", background: "var(--menu-bg)", border: "1px solid var(--border)", "box-shadow": "0 16px 40px var(--shadow)", "font-family": SANS }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "16px 18px 14px 18px", "border-bottom": "1px solid var(--border)" }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--text-h)" }}>Create tag</div>
          <button type="button" title="Close (Esc)" onClick={props.onCancel}
            style={{ width: "22px", height: "22px", display: "flex", "align-items": "center", "justify-content": "center", padding: 0, border: "none", "border-radius": "5px", background: "transparent", color: "var(--text-dim)", "font-size": "15px", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.color = "var(--text-h)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}>×</button>
        </div>
        <div title={props.subject} style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
          <span style={{ flex: "none", padding: "0 6px", "border-radius": "4px", background: "var(--active-bg)", "font-family": MONO, "font-size": "11px", "line-height": "18px", color: "var(--text)" }}>{props.sha.slice(0, 7)}</span>
          <span style={{ "min-width": 0, "font-size": "12px", color: "var(--text-dim)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{props.subject}</span>
        </div>
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "16px 18px" }}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between" }}>
            <label for="ct-name" style={{ "font-size": "12px", "font-weight": 500, color: "var(--text)" }}>Tag name</label>
            <Show when={props.suggestedName}>
              <button type="button" disabled={busy()} onClick={() => pick(props.suggestedName!)}
                style={{ border: "none", background: "transparent", padding: 0, "font-family": MONO, "font-size": "11px", color: ACCENT, cursor: "pointer" }}>Use {props.suggestedName}</button>
            </Show>
          </div>
          <input id="ct-name" ref={input} type="text" placeholder="e.g. v1.4.0" value={name()} disabled={busy()} autocomplete="off" spellcheck={false}
            onInput={(e) => { setName(e.currentTarget.value); setError(""); }}
            onFocus={focusOn} onBlur={focusOff(() => check().error)}
            style={{ ...field, height: "32px", padding: "0 10px", color: "var(--text-h)", "font-family": MONO, "font-size": "12px", "border-color": check().error ? ERROR_BORDER : "var(--border)" }} />
          <div aria-live="polite" style={{ "min-height": "16px", "font-size": "11px", "line-height": "16px", color: check().error ? DANGER : "var(--text-dim)", "overflow-wrap": "anywhere" }}>{check().hint}</div>
          <Show when={recent().length}>
            <div style={{ display: "flex", "align-items": "center", "flex-wrap": "wrap", gap: "6px" }}>
              <span style={{ "font-size": "11px", color: "var(--text-dim)" }}>Recent</span>
              <For each={recent()}>
                {(t) => (
                  <button type="button" disabled={busy()}
                    title={`${t.name} on ${t.sha.slice(0, 7)}${t.annotated === undefined ? "" : t.annotated ? " · annotated" : " · lightweight"} · click to use as a starting point`}
                    onClick={() => pick(t.name)}
                    style={{ display: "flex", "align-items": "center", gap: "6px", padding: "1px 7px", "border-radius": "10px", border: "1px solid var(--border)", background: "var(--input-bg)", cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.borderColor = "var(--text-dim)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--input-bg)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                    <span style={{ "font-family": MONO, "font-size": "11px", "line-height": "16px", color: "var(--text)" }}>{t.name}</span>
                    <Show when={t.age}><span style={{ "font-family": MONO, "font-size": "10px", color: "var(--text-dim)" }}>{t.age}</span></Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between" }}>
            <label for="ct-msg" style={{ "font-size": "12px", "font-weight": 500, color: "var(--text)" }}>Message</label>
            <span style={{ "font-size": "11px", color: "var(--text-dim)" }}>Optional</span>
          </div>
          <textarea id="ct-msg" rows={3} placeholder="Release notes or why this tag exists" value={msg()} disabled={busy()}
            onInput={(e) => { setMsg(e.currentTarget.value); setError(""); }}
            onFocus={focusOn} onBlur={focusOff(() => false)}
            style={{ ...field, padding: "8px 10px", color: "var(--text)", "font-family": SANS, "font-size": "12px", "line-height": "18px", resize: "vertical" }} />
          <div style={{ "font-size": "11px", "line-height": "16px", color: "var(--text-dim)" }}>
            {annotated() ? "Annotated tag — stores the message, author and date." : "Leave empty for a lightweight tag."}
          </div>
        </div>

        <Show when={error()}>
          <div role="alert" style={{ padding: "8px 10px", "border-radius": "6px", border: `1px solid ${ERROR_BORDER}`, background: "var(--danger-bg)", color: "var(--danger-fg)", "font-size": "12px", "line-height": "16px", "overflow-wrap": "anywhere" }}>{error()}</div>
        </Show>
      </div>

      <div style={{ display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "8px", padding: "12px 18px", "border-top": "1px solid var(--border)" }}>
        <button type="button" onClick={props.onCancel}
          style={{ padding: "6px 12px", "border-radius": "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", "font-family": SANS, "font-size": "12px", "font-weight": 500, cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.color = "var(--text-h)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text)"; }}>Cancel</button>
        <button type="button" disabled={disabled()} onClick={() => void submit()} title={SUBMIT_KEYS}
          style={{ display: "flex", "align-items": "center", gap: "8px", padding: "6px 12px", "border-radius": "6px", border: "none", background: ACCENT, color: "var(--accent-fg)", opacity: disabled() ? 0.45 : 1, "font-family": SANS, "font-size": "12px", "font-weight": 500, cursor: disabled() ? "default" : "pointer", transition: "opacity 150ms ease" }}>
          <span>{busy() ? (annotated() ? "Creating annotated tag…" : "Creating tag…") : annotated() ? "Create annotated tag" : "Create tag"}</span>
          <span style={{ "font-family": MONO, "font-size": "10px", opacity: 0.7 }}>{SUBMIT_KEYS}</span>
        </button>
      </div>
    </div>
  );
}

/** Next patch version after the latest semver-ish tag, e.g. "v0.2.12" → "v0.2.13". */
export function suggestNextTag(latest?: string): string | undefined {
  const m = latest?.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[1]}${m[2]}.${m[3]}.${Number(m[4]) + 1}` : undefined;
}

export default CreateTagDialog;

import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { countBranchFilters, countCommitFilters, emptyBranchFilters, emptyCommitFilters } from "../../state/graph";
import type { BranchFilters, CommitFilters, SincePreset, TagFilter } from "../../state/graph";

/* Graph toolbar — repo tabs, commit search, and Commits / Branches filter popovers. SolidJS, inline styles.
   Colors are theme variables (not the design's fixed dark palette) so it follows the active theme. */

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "inherit";
const ACCENT = "var(--accent)";

/* ───────────── Types ───────────── */

// The filter shapes, their empty values and counters live in the store, which owns the state.
export { countBranchFilters, countCommitFilters, emptyBranchFilters, emptyCommitFilters };
export type { BranchFilters, CommitFilters, SincePreset, TagFilter };

export interface RepoTab { name: string; branch: string; changes?: number }

export interface AuthorOption { name: string; color?: string }
export interface BranchOption { name: string; color?: string; lastActive?: string }

/* ───────────── Shared bits ───────────── */

const inputStyle: JSX.CSSProperties = { height: "30px", "box-sizing": "border-box", padding: "0 10px", "border-radius": "6px", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text)", "font-family": SANS, "font-size": "12px", outline: "none" };
const focusOn = (e: FocusEvent) => ((e.currentTarget as HTMLElement).style.borderColor = ACCENT);
const focusOff = (e: FocusEvent) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border)");

function Label(props: { children: JSX.Element; hint?: string }) {
  return (
    <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between" }}>
      <div style={{ "font-size": "12px", "font-weight": 500, color: "var(--text)" }}>{props.children}</div>
      <Show when={props.hint}><div style={{ "font-size": "11px", color: "var(--text-dim)" }}>{props.hint}</div></Show>
    </div>
  );
}

function PopoverShell(props: { title: string; meta?: string; resetEnabled: boolean; onReset: () => void; onDone: () => void; children: JSX.Element; style?: JSX.CSSProperties }) {
  return (
    <div role="dialog" class="filter-popover" aria-label={props.title} style={{ width: "380px", display: "flex", "flex-direction": "column", "border-radius": "10px", background: "var(--menu-bg)", border: "1px solid var(--border)", "box-shadow": "0 12px 32px var(--shadow-soft)", "font-family": SANS, ...props.style }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "12px 14px 10px 14px", "border-bottom": "1px solid var(--border)" }}>
        <div style={{ "font-size": "13px", "font-weight": 600, color: "var(--text-h)" }}>{props.title}</div>
        <Show when={props.meta}><div style={{ "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>{props.meta}</div></Show>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "14px", padding: "14px" }}>{props.children}</div>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "10px 14px", "border-top": "1px solid var(--border)" }}>
        <button type="button" disabled={!props.resetEnabled} onClick={props.onReset}
          style={{ border: "none", background: "transparent", padding: 0, "font-family": SANS, "font-size": "12px", color: props.resetEnabled ? "var(--text-dim)" : "color-mix(in srgb, var(--text-dim) 50%, transparent)", cursor: props.resetEnabled ? "pointer" : "default" }}>Reset</button>
        <button type="button" onClick={props.onDone}
          style={{ border: "none", padding: "5px 12px", "border-radius": "6px", background: ACCENT, color: "var(--accent-fg)", "font-family": SANS, "font-size": "12px", "font-weight": 500, cursor: "pointer" }}>Done</button>
      </div>
    </div>
  );
}

/* ───────────── RepoTabs ───────────── */

export function RepoTabs(props: { tabs: RepoTab[]; active?: string; onSelect?: (name: string) => void; onClose?: (name: string) => void; style?: JSX.CSSProperties }) {
  return (
    <div role="tablist" style={{ flex: 1, "min-width": 0, display: "flex", "align-items": "stretch", overflow: "hidden", "font-family": SANS, ...props.style }}>
      <For each={props.tabs}>
        {(t) => {
          const on = () => t.name === props.active;
          const [h, setH] = createSignal(false);
          return (
            <div role="tab" aria-selected={on()} title={`${t.name} · ${t.branch}${t.changes ? ` · ${t.changes} uncommitted` : ""}`}
              onClick={() => props.onSelect?.(t.name)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
              style={{ position: "relative", flex: "none", display: "flex", "align-items": "center", gap: "10px", "max-width": "240px", padding: "0 10px 0 14px", background: on() ? "var(--active-bg)" : h() ? "var(--hover-bg)" : "transparent", "border-right": "1px solid var(--border)", cursor: "pointer" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "2px", background: on() ? ACCENT : "transparent" }} />
              <div style={{ "min-width": 0, display: "flex", "flex-direction": "column" }}>
                <div style={{ "font-size": "13px", "line-height": "17px", color: on() ? "var(--text-h)" : "var(--text-dim)", "font-weight": on() ? 600 : 400, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{t.name}</div>
                <div style={{ display: "flex", "align-items": "center", gap: "6px", "font-family": MONO, "font-size": "10px", "line-height": "13px", color: "var(--text-dim)", "white-space": "nowrap" }}>
                  <span style={{ overflow: "hidden", "text-overflow": "ellipsis" }}>{t.branch}</span>
                  <Show when={t.changes}><span title="Uncommitted files" style={{ color: "var(--warning)" }}>{t.changes}Δ</span></Show>
                </div>
              </div>
              <button type="button" title="Close tab" onClick={(e) => { e.stopPropagation(); props.onClose?.(t.name); }}
                style={{ flex: "none", width: "18px", height: "18px", display: "flex", "align-items": "center", "justify-content": "center", padding: 0, border: "none", "border-radius": "4px", background: "transparent", color: "var(--text-dim)", "font-size": "13px", cursor: "pointer", opacity: on() || h() ? 1 : 0.35 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.color = "var(--text-h)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}>×</button>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/* ───────────── CommitSearch ───────────── */

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

export function CommitSearch(props: {
  value: string; onInput: (v: string) => void; placeholder?: string; width?: string; ref?: (el: HTMLInputElement) => void;
  onKeyDown?: (e: KeyboardEvent) => void; /** shown in place of the ⌘F hint while there is a query */ count?: number;
}) {
  // Collapsed to just the icon until hovered, focused (click, ⌘F) or holding a query.
  const [hover, setHover] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const expanded = () => hover() || focused() || props.value.length > 0;
  let input: HTMLInputElement | undefined;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => input?.focus()}
      style={{ position: "relative", flex: "none", display: "flex", "align-items": "center", height: "30px", "box-sizing": "border-box", width: expanded() ? props.width ?? "260px" : "41px", overflow: "hidden", "border-radius": "6px", background: expanded() ? "var(--input-bg)" : "transparent", border: `1px solid ${focused() ? ACCENT : "var(--border)"}`, cursor: expanded() ? "text" : "pointer", transition: "width 180ms cubic-bezier(.3,.7,.4,1), border-color 120ms ease" }}>
      <span style={{ flex: "none", width: "39px", display: "flex", "align-items": "center", "justify-content": "center", "pointer-events": "none" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" stroke-width="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" stroke-linecap="round" /></svg>
      </span>
      <input ref={(el) => { input = el; props.ref?.(el); }} placeholder={props.placeholder ?? "Search commits, sha, author…"} value={props.value} onInput={(e) => props.onInput(e.currentTarget.value)} onKeyDown={props.onKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ ...inputStyle, flex: 1, "min-width": 0, height: "100%", padding: "0 52px 0 0", border: "none", background: "transparent", opacity: expanded() ? 1 : 0, transition: "opacity 120ms ease" }} />
      <Show when={expanded()}>
      <Show when={props.value.trim() && props.count !== undefined}
        fallback={<span style={{ position: "absolute", right: "7px", padding: "0 5px", "border-radius": "4px", border: "1px solid var(--border)", "font-family": MONO, "font-size": "10px", "line-height": "14px", color: "var(--text-dim)", "pointer-events": "none" }}>{isMac ? "⌘F" : "Ctrl F"}</span>}>
        <span title="Matching commits" style={{ position: "absolute", right: "9px", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)", "pointer-events": "none" }}>{props.count}</span>
      </Show>
      </Show>
    </div>
  );
}

/* ───────────── FilterButtons ───────────── */

export type FilterPanel = "commit" | "branch" | null;

function FilterBtn(props: { label: string; icon: JSX.Element; open: boolean; count: number; onClick: () => void }) {
  const [h, setH] = createSignal(false);
  return (
    <button type="button" class="filter-button" aria-expanded={props.open} title={`Filter ${props.label.toLowerCase()}`} onClick={props.onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", "align-items": "center", gap: "6px", height: "100%", padding: "0 13px", border: "none", background: props.open ? "color-mix(in srgb, var(--accent) 24%, transparent)" : props.count ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent", color: props.open || props.count || h() ? "var(--text-h)" : "var(--text-dim)", "font-family": SANS, "font-size": "12px", cursor: "pointer" }}>
      {props.icon}
      <Show when={props.count}>
        <span style={{ "min-width": "14px", padding: "0 4px", "box-sizing": "border-box", "border-radius": "7px", background: ACCENT, color: "var(--accent-fg)", "font-family": MONO, "font-size": "10px", "line-height": "14px", "text-align": "center" }}>{props.count}</span>
      </Show>
    </button>
  );
}

export function FilterButtons(props: { open: FilterPanel; onToggle: (p: Exclude<FilterPanel, null>) => void; commitCount: number; branchCount: number }) {
  return (
    <div style={{ display: "flex", height: "30px", "box-sizing": "border-box", "border-radius": "6px", border: "1px solid var(--border)", overflow: "hidden" }}>
      <FilterBtn label="Commits" open={props.open === "commit"} count={props.commitCount} onClick={() => props.onToggle("commit")}
        icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12l-4.6 5.4V13l-2.8 1.2V8.4z" /></svg>} />
      <div style={{ width: "1px", background: "var(--border)" }} />
      <FilterBtn label="Branches" open={props.open === "branch"} count={props.branchCount} onClick={() => props.onToggle("branch")}
        icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2.2-7 4.3" /></svg>} />
    </div>
  );
}

/* ───────────── CommitFilterPopover ───────────── */

export function CommitFilterPopover(props: {
  value: CommitFilters; onChange: (v: CommitFilters) => void; authors: AuthorOption[];
  /** e.g. "5 of 7 commits" */ matchLabel?: string; onDone: () => void; style?: JSX.CSSProperties;
}) {
  const v = () => props.value;
  const set = (p: Partial<CommitFilters>) => props.onChange({ ...v(), ...p });
  const idx = () => ({ yes: 0, any: 1, no: 2 })[v().hasTag];
  return (
    <PopoverShell title="Filter commits" meta={props.matchLabel} resetEnabled={countCommitFilters(v()) > 0} onReset={() => props.onChange(emptyCommitFilters)} onDone={props.onDone} style={props.style}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
        <Label>Message contains</Label>
        <input placeholder="Text in commit message" value={v().text} onInput={(e) => set({ text: e.currentTarget.value })} onFocus={focusOn} onBlur={focusOff} style={inputStyle} />
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
        <Label hint={v().authors.length ? `${v().authors.length} selected` : "All authors"}>Author</Label>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
          <For each={props.authors}>
            {(a) => {
              const on = () => v().authors.includes(a.name);
              return (
                <div role="checkbox" aria-checked={on()} onClick={() => set({ authors: on() ? v().authors.filter((x) => x !== a.name) : [...v().authors, a.name] })}
                  style={{ display: "flex", "align-items": "center", gap: "6px", padding: "3px 9px 3px 4px", "border-radius": "12px", border: `1px solid ${on() ? ACCENT : "var(--border)"}`, background: on() ? "color-mix(in srgb, var(--accent) 24%, transparent)" : "var(--input-bg)", color: on() ? "var(--text-h)" : "var(--text-dim)", "font-size": "12px", cursor: "pointer", transition: "background-color 150ms ease, border-color 150ms ease" }}>
                  <span style={{ width: "16px", height: "16px", "border-radius": "8px", background: a.color ?? "var(--text-dim)", color: "var(--accent-fg)", "font-size": "9px", "font-weight": 600, display: "flex", "align-items": "center", "justify-content": "center" }}>{a.name[0]?.toUpperCase()}</span>
                  <span>{a.name}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <Label>Has tag</Label>
        <div role="radiogroup" style={{ position: "relative", display: "grid", "grid-template-columns": "repeat(3, 52px)", padding: "2px", "border-radius": "7px", background: "var(--input-bg)", border: "1px solid var(--border)" }}>
          <div style={{ position: "absolute", top: "2px", bottom: "2px", left: `${2 + idx() * 52}px`, width: "52px", "border-radius": "5px", background: v().hasTag === "any" ? "var(--hover-bg)" : ACCENT, transition: "left 180ms cubic-bezier(.3,.7,.4,1), background-color 180ms ease" }} />
          <For each={["yes", "any", "no"] as TagFilter[]}>
            {(k) => (
              <div role="radio" aria-checked={v().hasTag === k} onClick={() => set({ hasTag: k })}
                style={{ position: "relative", padding: "4px 0", "text-align": "center", "font-size": "12px", "font-weight": 500, color: v().hasTag === k ? "var(--accent-fg)" : "var(--text-dim)", cursor: "pointer", transition: "color 180ms ease" }}>
                {k[0].toUpperCase() + k.slice(1)}
              </div>
            )}
          </For>
        </div>
      </div>
    </PopoverShell>
  );
}

/* ───────────── BranchFilterPopover ───────────── */

export function BranchFilterPopover(props: { value: BranchFilters; onChange: (v: BranchFilters) => void; branches: BranchOption[]; onDone: () => void; style?: JSX.CSSProperties }) {
  const v = () => props.value;
  const set = (p: Partial<BranchFilters>) => props.onChange({ ...v(), ...p });
  const [q, setQ] = createSignal("");
  const list = createMemo(() => { const s = q().trim().toLowerCase(); return props.branches.filter((b) => !s || b.name.toLowerCase().includes(s)); });
  const total = () => props.branches.length;
  return (
    <PopoverShell title="Filter branches" meta={`${v().branches.length || total()} of ${total()} branches`} resetEnabled={countBranchFilters(v()) > 0}
      onReset={() => { setQ(""); props.onChange(emptyBranchFilters); }} onDone={props.onDone} style={props.style}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
        <Label hint={v().branches.length ? `${v().branches.length} checked` : "All branches"}>Branches</Label>
        <input placeholder="Find branch…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} onFocus={focusOn} onBlur={focusOff} style={inputStyle} />
        <div style={{ display: "flex", "flex-direction": "column", "max-height": "168px", "overflow-y": "auto", "border-radius": "6px", border: "1px solid var(--border)", background: "var(--input-bg)", padding: "3px" }}>
          <For each={list()}>
            {(b) => {
              const on = () => v().branches.includes(b.name);
              const [h, setH] = createSignal(false);
              return (
                <div role="checkbox" aria-checked={on()} onClick={() => set({ branches: on() ? v().branches.filter((x) => x !== b.name) : [...v().branches, b.name] })}
                  onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
                  style={{ display: "flex", "align-items": "center", gap: "9px", padding: "5px 8px", "border-radius": "4px", background: h() ? "var(--hover-bg)" : "transparent", cursor: "pointer" }}>
                  <span style={{ flex: "none", width: "14px", height: "14px", "box-sizing": "border-box", "border-radius": "4px", border: `1px solid ${on() ? ACCENT : "var(--text-dim)"}`, background: on() ? ACCENT : "transparent", color: "var(--accent-fg)", "font-size": "10px", "line-height": "12px", "text-align": "center" }}>{on() ? "✓" : ""}</span>
                  <span style={{ flex: "none", width: "8px", height: "8px", "border-radius": "4px", background: b.color ?? "var(--text-dim)" }} />
                  <span style={{ flex: 1, "min-width": 0, "font-family": MONO, "font-size": "11px", color: "var(--text)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{b.name}</span>
                  <Show when={b.lastActive}><span style={{ flex: "none", "font-family": MONO, "font-size": "10px", color: "var(--text-dim)" }}>{b.lastActive}</span></Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
        <Label>Active since</Label>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <div role="radiogroup" style={{ display: "flex", padding: "2px", gap: "2px", "border-radius": "7px", background: "var(--input-bg)", border: "1px solid var(--border)" }}>
            <For each={[["any", "Any"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"]] as [SincePreset, string][]}>
              {([k, l]) => {
                const on = () => v().since === k && !v().sinceDate;
                return (
                  <div role="radio" aria-checked={on()} onClick={() => set({ since: k, sinceDate: "" })}
                    style={{ padding: "4px 9px", "border-radius": "5px", background: on() ? "var(--hover-bg)" : "transparent", color: on() ? "var(--text-h)" : "var(--text-dim)", "font-size": "12px", "font-weight": 500, cursor: "pointer", transition: "background-color 150ms ease" }}>{l}</div>
                );
              }}
            </For>
          </div>
          <input type="date" value={v().sinceDate} onInput={(e) => set({ sinceDate: e.currentTarget.value, since: "any" })} onFocus={focusOn} onBlur={focusOff}
            style={{ ...inputStyle, flex: 1, "min-width": 0, padding: "0 8px", color: v().sinceDate ? "var(--text)" : "var(--text-dim)", "font-family": MONO, "font-size": "11px", "color-scheme": "dark" }} />
        </div>
      </div>
      <div style={{ "font-size": "11px", "line-height": "16px", color: "var(--text-dim)" }}>A branch is shown only if it matches both: checked above (when any are) and has a commit in the chosen period.</div>
    </PopoverShell>
  );
}

/* ───────────── GraphToolbar (all together) ───────────── */

export interface GraphToolbarProps {
  tabs: RepoTab[]; activeTab?: string; onSelectTab?: (n: string) => void; onCloseTab?: (n: string) => void;
  query: string; onQuery: (v: string) => void;
  commitFilters: CommitFilters; onCommitFilters: (v: CommitFilters) => void; authors: AuthorOption[]; matchLabel?: string;
  branchFilters: BranchFilters; onBranchFilters: (v: BranchFilters) => void; branches: BranchOption[];
}

export function GraphToolbar(props: GraphToolbarProps) {
  const [open, setOpen] = createSignal<FilterPanel>(null);
  const pop: JSX.CSSProperties = { position: "absolute", top: "calc(100% + 6px)", right: "10px", "z-index": 20 };
  return (
    <div style={{ position: "relative", display: "flex", "align-items": "stretch", height: "44px", background: "var(--panel-bg)", "border-bottom": "1px solid var(--border)" }}>
      <RepoTabs tabs={props.tabs} active={props.activeTab} onSelect={props.onSelectTab} onClose={props.onCloseTab} />
      <div style={{ flex: "none", display: "flex", "align-items": "center", gap: "6px", padding: "0 10px 0 12px", "border-left": "1px solid var(--border)" }}>
        <CommitSearch value={props.query} onInput={props.onQuery} />
        <FilterButtons open={open()} onToggle={(p) => setOpen(open() === p ? null : p)} commitCount={countCommitFilters(props.commitFilters)} branchCount={countBranchFilters(props.branchFilters)} />
      </div>
      <Show when={open() === "commit"}>
        <CommitFilterPopover style={pop} value={props.commitFilters} onChange={props.onCommitFilters} authors={props.authors} matchLabel={props.matchLabel} onDone={() => setOpen(null)} />
      </Show>
      <Show when={open() === "branch"}>
        <BranchFilterPopover style={pop} value={props.branchFilters} onChange={props.onBranchFilters} branches={props.branches} onDone={() => setOpen(null)} />
      </Show>
    </div>
  );
}

export default GraphToolbar;

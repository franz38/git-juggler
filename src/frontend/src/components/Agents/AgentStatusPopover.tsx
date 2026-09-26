import { For, Show, type JSX } from "solid-js";

/* Agent status popover — idle / working / waiting. SolidJS, inline styles, no deps.
   Every colour is a theme token (index.css / the active theme), so the card
   follows whichever theme is on; fonts are the app's own. */

export type AgentState = "idle" | "working" | "waiting";

export interface AgentRepo {
  /** Worktree folder name: the repo's own name for its main checkout. */
  name: string;
  branch: string;
  commit: string;
  /** The worktree the session was started in (only marked when several are listed). */
  home?: boolean;
  /** Pre-formatted time of the last tool call, e.g. "19:58:12" or "just now". */
  lastAt?: string;
  tool?: { name: string; command: string };
}

export interface AgentSession {
  /** Session title, e.g. "ci hover panel success state". */
  title: string;
  /** Display name, e.g. "Claude Code" or "opencode". */
  agent: string;
  state: AgentState;
  model?: string;
  /** e.g. "auto · bg". */
  mode?: string;
  pid?: number | string;
  version?: string;
  sessionId?: string;
  /** Big right-hand timer, pre-formatted: "19h", "2m 14s". */
  timer: string;
  /** Caption under the timer: "idle · started 21h ago", "this turn", "waiting". */
  timerLabel: string;
  lastPrompt?: string;
  /** Worktrees the session is on at this commit, most recent first. */
  repos: AgentRepo[];
  /** Shown in the amber box when state === "waiting". */
  permission?: { title: string; tool?: string; command?: string };
}

export interface AgentStatusPopoverProps {
  session: AgentSession;
  /** Agent logo element (img/svg). Rendered in a 36×36 box, contained. */
  agentIcon?: JSX.Element;
  /** When given, the waiting box shows an "Open terminal" button. */
  onOpenTerminal?: () => void;
  class?: string;
}

const MONO = "ui-monospace, Menlo, Consolas, monospace";
const SANS = "inherit";
// Faint neutral wash for the prompt box and the section band: visible on every theme.
const WASH = "color-mix(in srgb, var(--text-dim) 8%, transparent)";

const STATE: Record<AgentState, { label: string; color: string; toolLabel: string }> = {
  idle: { label: "Idle", color: "var(--text-dim)", toolLabel: "last tool" },
  working: { label: "Working", color: "var(--success)", toolLabel: "running now" },
  waiting: { label: "Needs input", color: "var(--warning)", toolLabel: "requested" },
};

/** Keep the command verb and path ends; drop the middle of long paths. */
export function shortenCommand(c: string, max = 56): string {
  if (c.length <= max) return c;
  const sp = c.indexOf(" /");
  const head = sp > -1 ? c.slice(0, sp + 1) : "";
  const parts = c.slice(head.length).split("/");
  if (parts.length < 5) return c;
  return head + parts.slice(0, 3).join("/") + "/…/" + parts.slice(-2).join("/");
}

const sectionLabel: JSX.CSSProperties = {
  "font-family": MONO, "font-size": "10px", "letter-spacing": "0.08em", color: "var(--text-dim)", "text-transform": "uppercase",
};

function RepoBlock(props: { repo: AgentRepo; toolLabel: string }) {
  const r = () => props.repo;
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
          <div style={{ "font-size": "13px", "font-weight": 600, color: "var(--text-h)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{r().name}</div>
          <div style={{ "font-family": MONO, "font-size": "11px", color: "var(--text-dim)", "white-space": "nowrap" }}>{r().branch} · {r().commit}</div>
          <Show when={r().home}>
            <div title="The worktree this session was started in" style={{ "font-family": MONO, "font-size": "10px", color: "var(--text-dim)", border: "1px solid var(--border)", "border-radius": "4px", padding: "0 5px" }}>home</div>
          </Show>
        </div>
        <Show when={r().lastAt}>
          <div style={{ flex: "none", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>{r().lastAt}</div>
        </Show>
      </div>
      <Show when={r().tool}>
        {(t) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <div style={{ padding: "1px 6px", "border-radius": "4px", background: WASH, "font-family": MONO, "font-size": "11px", color: "var(--text-h)" }}>{t().name}</div>
              <div style={{ "font-size": "12px", color: "var(--text-dim)" }}>{props.toolLabel}</div>
            </div>
            <div title={t().command} style={{ "font-family": MONO, "font-size": "12px", "line-height": 1.5, color: "var(--text)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
              {shortenCommand(t().command)}
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export function AgentStatusPopover(props: AgentStatusPopoverProps) {
  const s = () => props.session;
  const look = () => STATE[s().state];
  const chips = () =>
    [
      s().model && { k: "model", v: s().model! },
      s().mode && { k: "mode", v: s().mode! },
      s().pid != null && { k: "pid", v: String(s().pid) },
      s().version && { k: "v", v: s().version!, title: s().sessionId ? `session ${s().sessionId}` : undefined },
    ].filter(Boolean) as { k: string; v: string; title?: string }[];

  return (
    <div class={props.class} style={{ width: "100%", "max-width": "440px", background: "var(--menu-bg)", color: "var(--text)", border: "1px solid var(--border)", "border-radius": "12px", "box-shadow": "0 24px 64px var(--shadow-soft, rgba(0, 0, 0, 0.18))", overflow: "hidden", "font-family": SANS }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "18px 20px 16px 20px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Show when={props.agentIcon}>
            <div style={{ flex: "none", width: "36px", height: "36px", display: "flex", "align-items": "center", "justify-content": "center", "border-radius": "6px", overflow: "hidden" }}>
              {props.agentIcon}
            </div>
          </Show>
          <div style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: "2px" }}>
            <div style={{ "font-size": "14px", "font-weight": 600, "line-height": "18px", color: "var(--text-h)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{s().title}</div>
            <div style={{ display: "flex", "align-items": "center", gap: "6px", "font-size": "12px", "line-height": "16px", color: "var(--text-dim)" }}>
              <span>{s().agent}</span>
              <span>·</span>
              <span style={{ display: "flex", "align-items": "center", gap: "5px", color: look().color }}>
                <span style={{ width: "6px", height: "6px", "border-radius": "3px", background: look().color }} />
                {look().label}
              </span>
            </div>
          </div>
          <div style={{ flex: "none", display: "flex", "flex-direction": "column", "align-items": "flex-end", gap: "2px" }}>
            <div style={{ "font-family": MONO, "font-size": "13px", "line-height": "18px", color: "var(--text-h)" }}>{s().timer}</div>
            <div style={{ "font-size": "12px", "line-height": "16px", color: "var(--text-dim)" }}>{s().timerLabel}</div>
          </div>
        </div>

        <Show when={chips().length}>
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
            <For each={chips()}>
              {(c) => (
                <div title={c.title} style={{ display: "flex", "align-items": "center", gap: "6px", padding: "3px 8px", "border-radius": "5px", border: "1px solid var(--border)", "font-family": MONO, "font-size": "11px", color: "var(--text)" }}>
                  <span style={{ color: "var(--text-dim)" }}>{c.k}</span>
                  {c.v}
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={s().lastPrompt}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px", padding: "10px 12px", "border-radius": "8px", background: WASH, border: "1px solid var(--border)" }}>
            <div style={sectionLabel}>Last prompt</div>
            <div style={{ "font-size": "13px", "line-height": 1.5, color: "var(--text)", display: "-webkit-box", "-webkit-line-clamp": 2, "-webkit-box-orient": "vertical", overflow: "hidden", "overflow-wrap": "anywhere" }}>
              “{s().lastPrompt}”
            </div>
          </div>
        </Show>

        <Show when={s().state === "waiting" && s().permission}>
          {(p) => (
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px", padding: "10px 12px", "border-radius": "8px", background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)" }}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
                <div style={{ "font-size": "12px", "font-weight": 600, color: "var(--text-h)" }}>{p().title}</div>
                <Show when={p().command}>
                  <div style={{ "font-family": MONO, "font-size": "11px", color: "var(--text)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                    {p().tool ? `${p().tool} · ` : ""}{shortenCommand(p().command!)}
                  </div>
                </Show>
              </div>
              <Show when={props.onOpenTerminal}>
                <button
                  type="button"
                  onClick={() => props.onOpenTerminal?.()}
                  style={{ flex: "none", padding: "6px 10px", "border-radius": "6px", border: "1px solid color-mix(in srgb, var(--warning) 50%, transparent)", background: "transparent", color: "var(--text-h)", "font-family": SANS, "font-size": "12px", "font-weight": 500, cursor: "pointer" }}
                >
                  Open terminal
                </button>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <Show when={s().repos.length}>
        <div style={{ padding: "8px 20px", "border-top": "1px solid var(--border)", "border-bottom": "1px solid var(--border)", background: WASH }}>
          <div style={sectionLabel}>{s().repos.length > 1 ? "Worktrees" : "Repository"}</div>
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "14px", padding: "14px 20px 18px 20px" }}>
          <For each={s().repos}>{(repo) => <RepoBlock repo={repo} toolLabel={look().toolLabel} />}</For>
        </div>
      </Show>
    </div>
  );
}

export default AgentStatusPopover;

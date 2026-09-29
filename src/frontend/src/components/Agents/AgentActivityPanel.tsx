import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AgentRepositoryScan, AgentWorktreeActivity, RepoSummary } from "../../api/types";
import { agentActivity, agentActivityError, agentShowWorktrees, repos } from "../../state/store";
import { Disclosure, EmptyNote, GroupHeading, Hoverable, LiveDot, MONO, PanelHeader, Segmented } from "../Sidebar/panelKit";
import { type AgentSessionGroup, formatAge, formatTime, groupSubagentScans, pathBasename, sessionLastActivity, sessionTitle, shortCommit, subagentParentLabel } from "./agentFormat";

/* Agents sidebar panel: sessions grouped by repo, All/Active/Idle filter,
   rows expanding to the session's details. Colors come from the theme. */

type Filter = "all" | "active" | "idle";

const EVENTS_DIR = "~/.local/share/git-juggler/agent-sessions/";
const AGENT_LOGO: Record<string, string> = { claude: "/agent-logos/claude.png", opencode: "/agent-logos/opencode.webp" };
const AGENT_NAME: Record<string, string> = { claude: "Claude Code", opencode: "opencode" };
const agentName = (provider: string) => AGENT_NAME[provider] ?? (provider || "agent");
const home = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

/** Working, waiting on the user, or idle (with for how long). */
function sessionState(scan: AgentRepositoryScan): { color: string; label: string } {
  if (scan.waiting_for) return { color: "var(--warning)", label: "needs input" };
  if (scan.state === "active") return { color: "var(--success)", label: "working" };
  const last = sessionLastActivity(scan);
  return { color: "var(--text-dim)", label: last ? `idle ${formatAge(last)}` : "idle" };
}
const isActive = (scan: AgentRepositoryScan) => scan.state === "active" || !!scan.waiting_for;

/** The worktree a session started in (else its most recent one). */
function homeWorktree(scan: AgentRepositoryScan): AgentWorktreeActivity | undefined {
  return scan.worktrees.find((worktree) => worktree.is_home) ?? [...scan.worktrees].sort((a, b) => b.last_activity - a.last_activity)[0];
}

function repoFor(worktree: AgentWorktreeActivity | undefined, all: RepoSummary[]): RepoSummary | undefined {
  if (!worktree) return undefined;
  return all.find((repo) => repo.path === worktree.worktree_path) ?? all.find((repo) => repo.repository_id === worktree.repository_id);
}

function AgentIcon(props: { provider: string }) {
  return (
    <span
      title={agentName(props.provider)}
      style={{ flex: "none", width: "18px", height: "18px", display: "flex", "align-items": "center", "justify-content": "center", "border-radius": "4px", background: "var(--input-bg)" }}
    >
      <Show when={AGENT_LOGO[props.provider]}>
        {(src) => <img src={src()} alt={agentName(props.provider)} style={{ width: "13px", height: "13px", "object-fit": "contain", display: "block" }} />}
      </Show>
    </span>
  );
}

function DetailRow(props: { label: string; value: string; title?: string }) {
  return (
    <div style={{ display: "flex", "align-items": "baseline", gap: "10px", "min-width": 0 }}>
      <span style={{ flex: "none", width: "64px", "font-family": MONO, "font-size": "10px", "letter-spacing": "0.06em", color: "var(--text-dim)", "text-transform": "uppercase" }}>
        {props.label}
      </span>
      <span
        title={props.title ?? props.value}
        style={{ flex: 1, "min-width": 0, "font-family": MONO, "font-size": "11px", color: "var(--text)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}
      >
        {props.value}
      </span>
    </div>
  );
}

function SessionRow(props: { scan: AgentRepositoryScan; open: boolean; onToggle: () => void; nested?: boolean }) {
  const scan = () => props.scan;
  const state = () => sessionState(scan());
  const worktree = () => homeWorktree(scan());
  const summary = () =>
    [
      agentName(scan().provider),
      scan().details?.model?.replace(/^claude-/, ""),
      scan().details?.agent,
      scan().details?.permission_mode,
      scan().details?.kind,
    ]
      .filter(Boolean)
      .join(" · ");
  const commandLine = () => agentActivity()?.agents.find((agent) => agent.pid === scan().agent_pid)?.command_line;
  const details = createMemo(() => {
    const d = scan().details;
    const rows: { label: string; value: string; title?: string }[] = [];
    if (scan().is_subagent) rows.push({ label: "parent", value: subagentParentLabel(scan()) });
    if (d?.started_at) rows.push({ label: "started", value: `${formatAge(d.started_at)} ago`, title: new Date(d.started_at).toLocaleString() });
    const session = [scan().session_id?.slice(0, 8), scan().process_pid !== null ? `pid ${scan().process_pid}` : null].filter(Boolean).join(" · ");
    if (session) rows.push({ label: "session", value: session, title: scan().session_id ?? undefined });
    if (d?.version) rows.push({ label: "version", value: `v${d.version}` });
    const path = worktree()?.worktree_path;
    if (path) rows.push({ label: "path", value: home(path), title: path });
    if (d?.last_prompt) rows.push({ label: "prompt", value: d.last_prompt });
    if (commandLine()) rows.push({ label: "command", value: commandLine() as string });
    if (scan().session_directory) rows.push({ label: "sessions", value: home(scan().session_directory as string), title: scan().session_directory as string });
    return rows;
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", "border-radius": "8px", background: props.open ? "var(--active-bg)" : "transparent", "margin-left": props.nested ? "18px" : "0" }}>
      <Hoverable
        onClick={props.onToggle}
        ariaExpanded={props.open}
        title={scan().details?.last_prompt ? `Last prompt: ${scan().details?.last_prompt}` : undefined}
        style={{ display: "flex", "flex-direction": "column", gap: "5px", padding: "9px 10px", "border-radius": "8px", cursor: "pointer" }}
        hover={{ background: "var(--hover-bg)" }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Disclosure open={props.open} />
          <AgentIcon provider={scan().provider} />
          <span style={{ flex: 1, "min-width": 0, "font-size": "13px", "font-weight": 500, color: "var(--text-h)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
            {sessionTitle(scan())}
          </span>
          <Show when={scan().is_subagent}>
            <span
              title={subagentParentLabel(scan())}
              style={{ flex: "none", padding: "0 5px", "border-radius": "4px", border: "1px solid var(--border)", "font-family": MONO, "font-size": "10px", "line-height": "14px", color: "var(--text-dim)" }}
            >
              subagent
            </span>
          </Show>
          <span
            title={scan().waiting_for ?? undefined}
            style={{ flex: "none", display: "flex", "align-items": "center", gap: "5px", "font-family": MONO, "font-size": "11px", color: state().color, "white-space": "nowrap" }}
          >
            <LiveDot color={state().color} />
            {state().label}
          </span>
        </div>
        <div style={{ "padding-left": "36px", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {summary()}
        </div>
      </Hoverable>
      <Show when={props.open}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "5px", padding: "2px 10px 10px 46px" }}>
          <For each={details()}>{(row) => <DetailRow label={row.label} value={row.value} title={row.title} />}</For>
          <Show when={agentShowWorktrees()}>
            <For each={scan().worktrees}>
              {(item) => (
                <DetailRow
                  label={item.is_home ? "home" : "worktree"}
                  value={`${pathBasename(item.worktree_path)} · ${item.branch ?? "detached"} · ${shortCommit(item.commit)} · ${item.state} ${formatTime(item.last_activity)}`}
                  title={[item.worktree_path, item.process_ids.length ? `processes ${item.process_ids.join(", ")}` : null, [...new Set(item.evidence.map((e) => e.type))].join(", ")].filter(Boolean).join("\n")}
                />
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Agent sessions working in Git worktrees (from the hook events), grouped by
// the repo they work in; subagents sit under their parent session.
export function AgentActivityPanel() {
  const [filter, setFilter] = createSignal<Filter>("all");
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const keyOf = (scan: AgentRepositoryScan) => scan.session_id ?? `pid:${scan.agent_pid}`;
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const activeScans = createMemo(() => agentActivity()?.scans.filter((scan) => scan.worktrees.length > 0) ?? []);
  const sessionGroups = createMemo(() => groupSubagentScans(activeScans()));
  const inactiveAgentCount = createMemo(() => Math.max(0, (agentActivity()?.agents.length ?? 0) - activeScans().length));
  const worktreeCount = createMemo(() => activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0));

  const counts = createMemo(() => ({
    all: sessionGroups().length,
    active: sessionGroups().filter((group) => isActive(group.scan)).length,
    idle: sessionGroups().filter((group) => !isActive(group.scan)).length,
  }));
  const shown = createMemo(() =>
    sessionGroups().filter((group) => filter() === "all" || (filter() === "active" ? isActive(group.scan) : !isActive(group.scan))),
  );
  const groupsByRepo = createMemo(() => {
    const byRepo = new Map<string, AgentSessionGroup[]>();
    for (const group of shown()) {
      const worktree = homeWorktree(group.scan);
      const name = repoFor(worktree, repos())?.name ?? (worktree ? pathBasename(worktree.worktree_path) : "other");
      byRepo.set(name, [...(byRepo.get(name) ?? []), group]);
    }
    return [...byRepo.entries()].map(([name, groups]) => ({ name, groups }));
  });

  // Open the first session once, when the first data arrives.
  let openedInitial = false;
  createEffect(() => {
    if (openedInitial || !agentActivity()) return;
    openedInitial = true;
    const first = sessionGroups()[0];
    if (first) setOpen(new Set([keyOf(first.scan)]));
  });

  const liveTitle = () =>
    [
      `Reading hook events from ${EVENTS_DIR}`,
      `${worktreeCount()} worktree${worktreeCount() === 1 ? "" : "s"} watched`,
      agentActivity()?.scanned_at ? `last scan ${formatTime(agentActivity()!.scanned_at)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section style={{ display: "flex", "flex-direction": "column", "min-height": "100%", background: "var(--panel-bg)" }}>
      <PanelHeader
        title="Agents"
        liveTitle={liveTitle()}
        live={
          <>
            <LiveDot color={agentActivityError() ? "var(--danger)" : "var(--success)"} />
            hooks · live
          </>
        }
      >
        <Segmented<Filter>
          value={filter()}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts().all },
            { id: "active", label: "Active", count: counts().active, tone: "var(--success)" },
            { id: "idle", label: "Idle", count: counts().idle },
          ]}
        />
      </PanelHeader>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "12px 8px 16px 8px" }}>
        <Show when={agentActivityError()}>
          <div style={{ padding: "0 8px", "font-size": "12px", color: "var(--danger)" }}>{agentActivityError()}</div>
        </Show>
        <Show when={agentActivity()} fallback={<Show when={!agentActivityError()}><EmptyNote>Loading…</EmptyNote></Show>}>
          <For each={groupsByRepo()}>
            {(repoGroup) => (
              <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <GroupHeading label={repoGroup.name} count={repoGroup.groups.length} />
                <For each={repoGroup.groups}>
                  {(group) => (
                    <>
                      <SessionRow scan={group.scan} open={open().has(keyOf(group.scan))} onToggle={() => toggle(keyOf(group.scan))} />
                      <For each={group.subagents}>
                        {(subagent) => <SessionRow scan={subagent} nested open={open().has(keyOf(subagent))} onToggle={() => toggle(keyOf(subagent))} />}
                      </For>
                    </>
                  )}
                </For>
              </div>
            )}
          </For>
          <Show when={shown().length === 0}>
            <EmptyNote>{filter() === "idle" ? "No idle agents." : "No agents working right now."}</EmptyNote>
          </Show>
          <Show when={inactiveAgentCount() > 0}>
            <div style={{ padding: "0 8px", "font-family": MONO, "font-size": "10px", color: "var(--text-dim)" }}>
              {inactiveAgentCount()} hook session{inactiveAgentCount() === 1 ? "" : "s"} with no Git worktree activity hidden
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
}

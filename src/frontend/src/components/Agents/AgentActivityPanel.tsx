import { For, Show, createMemo } from "solid-js";
import type { AgentRepositoryScan } from "../../api/types";
import { agentActivity, agentActivityError, agentShowWorktrees } from "../../state/store";
import { formatTime, groupSubagentScans, pathBasename, sessionDetailsLine, sessionIdentity, sessionTitle, shortCommit, subagentParentLabel } from "./agentFormat";

function AgentScanCard(props: { scan: AgentRepositoryScan; nested?: boolean }) {
  const scan = () => props.scan;
  return (
    <div class="agent-scan-card" classList={{ active: scan().state === "active", nested: !!props.nested }}>
      <div class="agent-scan-title" title={scan().details?.last_prompt ? `Last prompt: ${scan().details?.last_prompt}` : (scan().session_id ?? undefined)}>
        {sessionTitle(scan())}
        <Show when={scan().is_subagent}>
          <span class="agent-state-pill subagent" title={subagentParentLabel(scan())}>subagent</span>
        </Show>
        <span class="agent-state-pill" classList={{ idle: scan().state === "idle" }}>{scan().state}</span>
      </div>
      <div class="agent-worktree-meta">{scan().is_subagent ? subagentParentLabel(scan()) : sessionIdentity(scan())}</div>
      <Show when={scan().is_subagent}>
        <div class="agent-worktree-meta">{sessionIdentity(scan())}</div>
      </Show>
      <Show when={sessionDetailsLine(scan())}>
        <div class="agent-worktree-meta">{sessionDetailsLine(scan())}</div>
      </Show>
      <For each={agentActivity()?.agents.filter((agent) => agent.pid === scan().agent_pid) ?? []}>
        {(agent) => <div class="agent-command" title={agent.command_line}>{agent.command_line}</div>}
      </For>
      <Show when={scan().session_directory}>
        {(sessionDirectory) => <div class="agent-session-directory" title={sessionDirectory()}>Session: {sessionDirectory()}</div>}
      </Show>
      <Show when={agentShowWorktrees()}>
        <For each={scan().worktrees} fallback={<div class="agent-empty">No Git worktrees detected</div>}>
          {(worktree) => (
            <div class="agent-worktree-card" classList={{ active: worktree.state === "active" }} title={worktree.worktree_path}>
              <div class="agent-worktree-title">
                {pathBasename(worktree.worktree_path)}
                <Show when={worktree.is_home}>
                  <span class="agent-state-pill" title="The worktree this session was started in">home</span>
                </Show>
              </div>
              <div class="agent-worktree-meta">
                {worktree.branch ?? "detached"} · {shortCommit(worktree.commit)}
              </div>
              <div class="agent-worktree-meta">Processes: {worktree.process_ids.join(", ")}</div>
              <div class="agent-worktree-meta">Last: {formatTime(worktree.last_activity)} · {worktree.state}</div>
              <div class="agent-evidence-row">
                <For each={[...new Set(worktree.evidence.map((item) => item.type))]}>
                  {(type) => <span class="agent-evidence-pill">{type}</span>}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export function AgentActivityPanel() {
  const activeScans = createMemo(() =>
    agentActivity()?.scans.filter((scan) => scan.worktrees.length > 0) ?? [],
  );
  const sessionGroups = createMemo(() => groupSubagentScans(activeScans()));
  const runningCount = createMemo(() => activeScans().filter((scan) => scan.state === "active").length);
  const idleCount = createMemo(() => activeScans().length - runningCount());
  const inactiveAgentCount = createMemo(() => Math.max(0, (agentActivity()?.agents.length ?? 0) - activeScans().length));

  return (
    <section class="agent-activity-panel">
      <div class="agent-activity-heading">
        <span>Agent activity</span>
        <Show when={agentActivity()}>
          {(activity) => <span class="agent-scan-time">{activity().scanned_at > 0 ? formatTime(activity().scanned_at) : "no agents"}</span>}
        </Show>
      </div>
      <div class="agent-discovery-row">
        <span>Reading hook events from <span class="mono">~/.local/share/git-juggler/agent-events.jsonl</span></span>
      </div>
      <Show when={agentActivityError()}>
        <div class="agent-error">{agentActivityError()}</div>
      </Show>
      <Show when={agentActivity()}>
        <div class="agent-results">
          <div class="agent-summary">
            {runningCount()} active · {idleCount()} idle · {activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0)} worktree{activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0) === 1 ? "" : "s"}
          </div>
          <Show when={inactiveAgentCount() > 0}>
            <div class="agent-empty">{inactiveAgentCount()} hook session{inactiveAgentCount() === 1 ? "" : "s"} with no Git worktree activity hidden</div>
          </Show>
          <For each={sessionGroups()} fallback={<div class="agent-empty">No active Git worktrees detected</div>}>
            {(group) => (
              <>
                <AgentScanCard scan={group.scan} />
                <For each={group.subagents}>
                  {(subagent) => <AgentScanCard scan={subagent} nested />}
                </For>
              </>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

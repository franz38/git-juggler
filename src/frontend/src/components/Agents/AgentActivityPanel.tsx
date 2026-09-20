import { For, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js";
import {
  agentActivity,
  agentActivityError,
  agentActivityLoading,
  agentActivityPolling,
  refreshAgentActivity,
  setAgentActivityPollingEnabled,
} from "../../state/store";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

export function AgentActivityPanel() {
  const activeScans = createMemo(() => agentActivity()?.scans.filter((scan) => scan.worktrees.length > 0) ?? []);
  const inactiveAgentCount = createMemo(() => Math.max(0, (agentActivity()?.agents.length ?? 0) - activeScans().length));

  onMount(() => {
    void refreshAgentActivity();
  });

  createEffect(() => {
    if (!agentActivityPolling()) return;
    const timer = window.setInterval(() => {
      void refreshAgentActivity();
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <section class="agent-activity-panel">
      <div class="agent-activity-heading">
        <span>Agent activity</span>
        <Show when={agentActivity()}>
          {(activity) => <span class="agent-scan-time">{activity().scanned_at > 0 ? formatTime(activity().scanned_at) : "no agents"}</span>}
        </Show>
      </div>
      <div class="agent-discovery-row">
        <span>Auto-discovering <span class="mono">claude</span> and <span class="mono">opencode</span> processes</span>
      </div>
      <div class="agent-refresh-row">
        <button type="button" disabled={agentActivityLoading()} onClick={() => void refreshAgentActivity()}>
          {agentActivityLoading() ? "..." : "Refresh"}
        </button>
      </div>
      <label class="agent-poll-toggle">
        <input
          type="checkbox"
          checked={agentActivityPolling()}
          onChange={(e) => setAgentActivityPollingEnabled(e.currentTarget.checked)}
        />
        <span>Poll every second</span>
      </label>
      <Show when={agentActivityError()}>
        <div class="agent-error">{agentActivityError()}</div>
      </Show>
      <Show when={agentActivity()}>
        {(activity) => (
          <div class="agent-results">
            <div class="agent-summary">
              {activeScans().length} active agent{activeScans().length === 1 ? "" : "s"}, {activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0)} worktree{activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0) === 1 ? "" : "s"}
            </div>
            <Show when={inactiveAgentCount() > 0}>
              <div class="agent-empty">{inactiveAgentCount()} discovered agent process{inactiveAgentCount() === 1 ? "" : "es"} with no Git worktree activity hidden</div>
            </Show>
            <For each={activeScans()} fallback={<div class="agent-empty">No active Git worktrees detected</div>}>
              {(scan) => (
                <div class="agent-scan-card">
                  <div class="agent-scan-title">PID {scan.agent_pid}</div>
                  <For each={activity().agents.filter((agent) => agent.pid === scan.agent_pid)}>
                    {(agent) => <div class="agent-command" title={agent.command_line}>{agent.command_line}</div>}
                  </For>
                  <Show when={scan.session_directory}>
                    {(sessionDirectory) => <div class="agent-session-directory" title={sessionDirectory()}>Session: {sessionDirectory()}</div>}
                  </Show>
                  <For each={scan.worktrees} fallback={<div class="agent-empty">No Git worktrees detected</div>}>
                    {(worktree) => (
                      <div class="agent-worktree-card" title={worktree.worktree_path}>
                        <div class="agent-worktree-title">{worktree.worktree_path.split("/").pop() || worktree.worktree_path}</div>
                        <div class="agent-worktree-meta">
                          {worktree.branch ?? "detached"} · {shortCommit(worktree.commit)}
                        </div>
                        <div class="agent-worktree-meta">Processes: {worktree.process_ids.join(", ")}</div>
                        <div class="agent-worktree-meta">Last: {formatTime(worktree.last_activity)}</div>
                        <div class="agent-evidence-row">
                          <For each={[...new Set(worktree.evidence.map((item) => item.type))]}>
                            {(type) => <span class="agent-evidence-pill">{type}</span>}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </section>
  );
}

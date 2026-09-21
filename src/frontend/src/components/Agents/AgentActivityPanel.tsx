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

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

export function AgentActivityPanel() {
  const activeScans = createMemo(() => agentActivity()?.scans.filter((scan) => scan.worktrees.length > 0) ?? []);
  const runningCount = createMemo(() => activeScans().filter((scan) => scan.state === "active").length);
  const idleCount = createMemo(() => activeScans().length - runningCount());
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
        <span>Reading hook events from <span class="mono">~/.local/share/git-juggler/agent-events.jsonl</span></span>
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
              {runningCount()} active · {idleCount()} idle · {activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0)} worktree{activeScans().reduce((sum, scan) => sum + scan.worktrees.length, 0) === 1 ? "" : "s"}
            </div>
            <Show when={inactiveAgentCount() > 0}>
              <div class="agent-empty">{inactiveAgentCount()} hook session{inactiveAgentCount() === 1 ? "" : "s"} with no Git worktree activity hidden</div>
            </Show>
            <For each={activeScans()} fallback={<div class="agent-empty">No active Git worktrees detected</div>}>
              {(scan) => (
                <div class="agent-scan-card">
                  <div class="agent-scan-title" title={scan.details?.last_prompt ? `Last prompt: ${scan.details.last_prompt}` : (scan.session_id ?? undefined)}>
                    {scan.details?.title ?? scan.name ?? scan.session_id?.slice(0, 8) ?? `session ${Math.abs(scan.agent_pid)}`}
                    <span class="agent-state-pill" classList={{ idle: scan.state === "idle" }}>{scan.state}</span>
                  </div>
                  <div class="agent-worktree-meta">
                    {scan.provider || "agent"}
                    {scan.process_pid !== null ? ` · pid ${scan.process_pid}` : ""}
                    {scan.session_id ? ` · ${scan.session_id.slice(0, 8)}` : ""}
                  </div>
                  <Show when={scan.details}>
                    {(details) => (
                      <div class="agent-worktree-meta">
                        {[
                          details().model,
                          details().permission_mode,
                          details().kind,
                          details().started_at ? `started ${formatAge(details().started_at!)} ago` : null,
                          details().status_updated_at ? `${scan.state} for ${formatAge(details().status_updated_at!)}` : null,
                          details().version ? `v${details().version}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </Show>
                  <For each={activity().agents.filter((agent) => agent.pid === scan.agent_pid)}>
                    {(agent) => <div class="agent-command" title={agent.command_line}>{agent.command_line}</div>}
                  </For>
                  <Show when={scan.session_directory}>
                    {(sessionDirectory) => <div class="agent-session-directory" title={sessionDirectory()}>Session: {sessionDirectory()}</div>}
                  </Show>
                  <For each={scan.worktrees} fallback={<div class="agent-empty">No Git worktrees detected</div>}>
                    {(worktree) => (
                      <div class="agent-worktree-card" title={worktree.worktree_path}>
                        <div class="agent-worktree-title">
                          {worktree.worktree_path.split("/").pop() || worktree.worktree_path}
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
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </section>
  );
}

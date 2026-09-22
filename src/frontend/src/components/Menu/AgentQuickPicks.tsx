import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AgentHookProviderStatus } from "../../api/types";
import {
  agentHooks,
  agentHooksError,
  agentHooksLoading,
  installAgentHooks,
  refreshAgentHooks,
  setAgentsEnabled,
} from "../../state/store";

type Provider = "claude" | "opencode";

const AGENTS: { provider: Provider; label: string; initial: string }[] = [
  { provider: "claude", label: "Claude Code", initial: "C" },
  { provider: "opencode", label: "opencode", initial: "O" },
];

function AgentCard(props: { label: string; initial: string; status: AgentHookProviderStatus | undefined; onStart: () => void }) {
  const [manualOpen, setManualOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const installed = () => props.status?.installed ?? false;

  const copySnippet = async () => {
    const snippet = props.status?.snippet;
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="agent-quickpick-card">
      <div class="agent-quickpick-heading">
        <span class="agent-quickpick-logo">{props.initial}</span>
        <span class="menu-setting-label">{props.label}</span>
      </div>
      <Show when={props.status?.error}>{(error) => <div class="menu-error">{error()}</div>}</Show>
      <div class="agent-quickpick-actions">
        <Show
          when={!installed()}
          fallback={
            <span class="agent-quickpick-tracking" aria-live="polite">
              Tracking &#10003;
            </span>
          }
        >
          <button type="button" class="menu-primary-button" disabled={agentHooksLoading() || !props.status} onClick={props.onStart}>
            Start tracking
          </button>
        </Show>
        <button type="button" class="menu-secondary-button" onClick={() => setManualOpen((v) => !v)}>
          Manual setup
        </button>
      </div>
      <Show when={manualOpen() && props.status}>
        {(status) => (
          <div class="agent-quickpick-manual">
            <p class="menu-hint">Add this configuration globally, then restart existing agent sessions.</p>
            <div class="agent-hook-meta">
              Config: <span class="mono">{status().config_path}</span>
            </div>
            <div class="agent-hook-meta">
              Events: <span class="mono">{status().event_path}</span>
            </div>
            <div class="menu-actions">
              <button type="button" class="menu-secondary-button" onClick={() => void copySnippet()}>
                {copied() ? "Copied" : "Copy config"}
              </button>
            </div>
            <pre class="agent-hook-snippet">
              <code>{status().snippet}</code>
            </pre>
          </div>
        )}
      </Show>
    </div>
  );
}

// The wizard's slimmed Agents step: a track/skip card per known coding
// agent (Claude Code, opencode), 0-n selectable — doing nothing is a valid
// exit. Detection on/off, worktrees and polling interval stay in
// Settings > Agents (AgentsSettings); this step is only about which agents
// to track.
export function AgentQuickPicks() {
  createEffect(() => {
    if (!agentHooks() && !agentHooksLoading()) void refreshAgentHooks();
  });

  const trackedCount = createMemo(() => {
    const hooks = agentHooks();
    if (!hooks) return 0;
    return AGENTS.filter(({ provider }) => hooks[provider].installed).length;
  });

  const startTracking = (provider: Provider) => {
    setAgentsEnabled(true);
    void installAgentHooks(provider);
  };

  return (
    <div class="agent-quickpicks">
      <Show when={agentHooksError()}>{(error) => <div class="menu-error">{error()}</div>}</Show>
      <div class="agent-quickpick-grid">
        <For each={AGENTS}>
          {(agent) => (
            <AgentCard
              label={agent.label}
              initial={agent.initial}
              status={agentHooks()?.[agent.provider]}
              onStart={() => startTracking(agent.provider)}
            />
          )}
        </For>
      </div>
      <p class="menu-hint">
        {trackedCount() === 0
          ? "Nothing will be tracked. You can turn this on any time from Settings → Agents."
          : `Tracking ${trackedCount()} agent${trackedCount() > 1 ? "s" : ""}.`}
      </p>
    </div>
  );
}

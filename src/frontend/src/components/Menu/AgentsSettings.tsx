import { Show, createEffect, createSignal } from "solid-js";
import type { AgentHookProviderStatus } from "../../api/types";
import { NumberField } from "../inputs/NumberField";
import { ToggleField } from "../inputs/ToggleField";
import {
  DEFAULT_AGENT_POLL_SECONDS,
  MAX_AGENT_POLL_SECONDS,
  agentHooks,
  agentHooksError,
  agentHooksLoading,
  agentPollSeconds,
  agentShowWorktrees,
  agentsEnabled,
  installAgentHooks,
  refreshAgentHooks,
  setAgentPollSeconds,
  setAgentShowWorktrees,
  setAgentsEnabled,
} from "../../state/store";

function HookSetupCard(props: { title: string; status: AgentHookProviderStatus; onInstall: () => void }) {
  const [copied, setCopied] = createSignal(false);
  const copySnippet = async () => {
    await navigator.clipboard.writeText(props.status.snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="agent-hook-card">
      <div class="agent-hook-card-heading">
        <div>
          <div class="menu-setting-label">{props.title}</div>
          <p class="menu-hint">{props.status.description}</p>
        </div>
        <span class={props.status.installed ? "agent-hook-status installed" : "agent-hook-status"}>{props.status.installed ? "Installed" : "Not installed"}</span>
      </div>
      <div class="agent-hook-meta">Config: <span class="mono">{props.status.config_path}</span></div>
      <div class="agent-hook-meta">Events: <span class="mono">{props.status.event_path}</span></div>
      <Show when={props.status.error}>
        {(error) => <div class="menu-error">{error()}</div>}
      </Show>
      <div class="menu-actions">
        <button type="button" class="menu-primary-button" disabled={agentHooksLoading()} onClick={props.onInstall}>
          Auto-install
        </button>
        <button type="button" class="menu-secondary-button" onClick={() => void copySnippet()}>
          {copied() ? "Copied" : "Copy config"}
        </button>
      </div>
      <p class="menu-hint">Manual setup: add this configuration globally, then restart existing agent sessions.</p>
      <pre class="agent-hook-snippet"><code>{props.status.snippet}</code></pre>
    </div>
  );
}

// The "Agents" settings: detection on/off plus the hook install cards.
// Loads hook status the first time it's mounted (both the settings menu and
// the welcome wizard mount this lazily via <Show>, so this fires once per
// time it actually becomes visible).
export function AgentsSettings() {
  createEffect(() => {
    if (!agentHooks() && !agentHooksLoading()) void refreshAgentHooks();
  });

  return (
    <>
      <ToggleField
        label="Enable agent activity detection"
        description="When disabled, no agent data is fetched or shown anywhere in the app."
        checked={agentsEnabled()}
        onChange={setAgentsEnabled}
      />

      <ToggleField
        label="Show worktrees in the agents panel"
        description="Lists each session's worktrees (branch, commit, last activity) under the session. Off by default."
        checked={agentShowWorktrees()}
        disabled={!agentsEnabled()}
        onChange={setAgentShowWorktrees}
      />

      <NumberField
        label="Polling interval"
        description={`How often agent activity is refreshed. Default ${DEFAULT_AGENT_POLL_SECONDS}.`}
        unit="sec"
        min={1}
        max={MAX_AGENT_POLL_SECONDS}
        value={agentPollSeconds()}
        disabled={!agentsEnabled()}
        onChange={(value) => setAgentPollSeconds(value ?? DEFAULT_AGENT_POLL_SECONDS)}
      />

      <div class="agent-hooks-section">
        <div class="menu-setting-main">
          <div class="menu-setting-label">High-confidence hooks</div>
          <p class="menu-hint">
            Hooks append JSONL events to git-juggler so short-lived tool calls can be attributed to the worktree they actually
            touch. Agent activity is sourced from these hook events only.
          </p>
        </div>
        <div class="menu-actions">
          <button type="button" class="menu-secondary-button" disabled={agentHooksLoading()} onClick={() => void refreshAgentHooks()}>
            {agentHooksLoading() ? "Loading..." : "Refresh hook status"}
          </button>
        </div>
        <Show when={agentHooksError()}>
          {(error) => <div class="menu-error">{error()}</div>}
        </Show>
        <Show when={agentHooks()} fallback={<div class="menu-hint">Open this section to load hook setup status.</div>}>
          {(hooks) => (
            <div class="agent-hook-grid">
              <HookSetupCard title="Claude" status={hooks().claude} onInstall={() => void installAgentHooks("claude")} />
              <HookSetupCard title="OpenCode" status={hooks().opencode} onInstall={() => void installAgentHooks("opencode")} />
            </div>
          )}
        </Show>
      </div>
    </>
  );
}

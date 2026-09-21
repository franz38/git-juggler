import { Show, createMemo } from "solid-js";
import { agentActivity, agentsEnabled, ciEnabled, pipelines, setSidebarTab, sidebarTab, sidebarWidth } from "../../state/store";
import { AgentActivityPanel } from "../Agents/AgentActivityPanel";
import { PipelinesPanel } from "../Pipelines/PipelinesPanel";
import { RepoList } from "./RepoList";

// The left panel: the active tab's content on top, the tab menu at the bottom.
// All panes stay mounted and the inactive ones are just hidden: the repo list
// keeps its filter text and scroll position, and the agents/pipelines panels
// stay mounted (their polling is driven from App).
export function Sidebar() {
  const activeAgentCount = createMemo(() => (agentActivity()?.scans ?? []).filter((scan) => scan.state === "active").length);
  const runningPipelineCount = createMemo(() => pipelines().length);

  return (
    <aside class="sidebar" style={{ width: `${sidebarWidth()}px` }}>
      <div class="sidebar-content">
        <div class="sidebar-pane" style={{ display: sidebarTab() === "repos" ? "block" : "none" }}>
          <RepoList />
        </div>
        <Show when={agentsEnabled()}>
          <div class="sidebar-pane" style={{ display: sidebarTab() === "agents" ? "block" : "none" }}>
            <AgentActivityPanel />
          </div>
        </Show>
        <Show when={ciEnabled()}>
          <div class="sidebar-pane" style={{ display: sidebarTab() === "pipelines" ? "block" : "none" }}>
            <PipelinesPanel />
          </div>
        </Show>
      </div>
      <Show when={agentsEnabled() || ciEnabled()}>
        <div class="sidebar-tabs" role="tablist">
          <button type="button" role="tab" class="sidebar-tab" classList={{ active: sidebarTab() === "repos" }} aria-selected={sidebarTab() === "repos"} onClick={() => setSidebarTab("repos")}>
            Repos
          </button>
          <Show when={agentsEnabled()}>
            <button type="button" role="tab" class="sidebar-tab" classList={{ active: sidebarTab() === "agents" }} aria-selected={sidebarTab() === "agents"} onClick={() => setSidebarTab("agents")}>
              Agents
              <Show when={activeAgentCount() > 0}>
                <span class="sidebar-tab-badge" title={`${activeAgentCount()} active agent session${activeAgentCount() === 1 ? "" : "s"}`}>
                  {activeAgentCount()}
                </span>
              </Show>
            </button>
          </Show>
          <Show when={ciEnabled()}>
            <button type="button" role="tab" class="sidebar-tab" classList={{ active: sidebarTab() === "pipelines" }} aria-selected={sidebarTab() === "pipelines"} onClick={() => setSidebarTab("pipelines")}>
              Pipelines
              {/* Only meaningful while the tab has been polled (it polls only when open). */}
              <Show when={runningPipelineCount() > 0}>
                <span class="sidebar-tab-badge" title={`${runningPipelineCount()} running pipeline${runningPipelineCount() === 1 ? "" : "s"} (as of the last check)`}>
                  {runningPipelineCount()}
                </span>
              </Show>
            </button>
          </Show>
        </div>
      </Show>
    </aside>
  );
}

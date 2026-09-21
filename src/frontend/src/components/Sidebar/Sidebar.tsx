import { Show, createMemo } from "solid-js";
import { agentActivity, agentsEnabled, setSidebarTab, sidebarTab, sidebarWidth } from "../../state/store";
import { AgentActivityPanel } from "../Agents/AgentActivityPanel";
import { RepoList } from "./RepoList";

// The left panel: the active tab's content on top, the tab menu at the bottom.
// Both panes stay mounted and the inactive one is just hidden: the repo list
// keeps its filter text and scroll position, and the agents panel stays
// mounted (agent polling itself is driven from App).
export function Sidebar() {
  const activeAgentCount = createMemo(() => (agentActivity()?.scans ?? []).filter((scan) => scan.state === "active").length);

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
      </div>
      <Show when={agentsEnabled()}>
        <div class="sidebar-tabs" role="tablist">
          <button type="button" role="tab" class="sidebar-tab" classList={{ active: sidebarTab() === "repos" }} aria-selected={sidebarTab() === "repos"} onClick={() => setSidebarTab("repos")}>
            Repos
          </button>
          <button type="button" role="tab" class="sidebar-tab" classList={{ active: sidebarTab() === "agents" }} aria-selected={sidebarTab() === "agents"} onClick={() => setSidebarTab("agents")}>
            Agents
            <Show when={activeAgentCount() > 0}>
              <span class="sidebar-tab-badge" title={`${activeAgentCount()} active agent session${activeAgentCount() === 1 ? "" : "s"}`}>
                {activeAgentCount()}
              </span>
            </Show>
          </button>
        </div>
      </Show>
    </aside>
  );
}

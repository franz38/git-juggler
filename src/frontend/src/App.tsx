import { For, Show, createEffect, onCleanup, onMount, untrack } from "solid-js";
import "./App.css";
import { GraphPanel } from "./components/Graph/GraphPanel";
import { DeleteBranchModal } from "./components/Branches/DeleteBranchModal";
import { BranchContextMenu } from "./components/ContextMenu/BranchContextMenu";
import { CommitContextMenu } from "./components/ContextMenu/CommitContextMenu";
import { CreateBranchModal } from "./components/ContextMenu/CreateBranchModal";
import { CreateTagModal } from "./components/ContextMenu/CreateTagModal";
import { NewGroupModal } from "./components/Sidebar/NewGroupModal";
import { FileDiffModal } from "./components/Diff/FileDiffModal";
import { RepoContextMenu } from "./components/ContextMenu/RepoContextMenu";
import { TagContextMenu } from "./components/ContextMenu/TagContextMenu";
import { CommitList } from "./components/Commits/CommitList";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { DirectoryBrowserModal } from "./components/Menu/DirectoryBrowserModal";
import { MainMenu } from "./components/Menu/MainMenu";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { SearchBox } from "./components/Search/SearchBox";
import { TabsBar } from "./components/Tabs/TabsBar";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { DeleteTagModal } from "./components/Tags/DeleteTagModal";
import { WelcomeWizard } from "./components/Welcome/WelcomeWizard";
import {
  activeRepo,
  activateAdjacentTab,
  agentPollSeconds,
  agentsEnabled,
  keyBindings,
  loadActiveTabGraph,
  matchesKeyBinding,
  PIPELINE_POLL_MS,
  pollRepoStatus,
  refreshAgentActivity,
  refreshPipelines,
  refreshActiveRepoCiRuns,
  CI_COMPLETED_REFRESH_INTERVAL_MS,
  repoUnavailable,
  setSidebarWidth,
  sidebarTab,
  setTerminalHeight,
  sidebarWidth,
  tabs,
  terminalHeight,
  terminalOpen,
  toggleCommandPalette,
  toggleMenu,
  toggleTerminalOpen,
} from "./state/store";
import { closeTopOverlay } from "./state/overlayStack";
import { loadPreferences } from "./state/preferences";
import { activeTheme, loadThemes } from "./state/themes";

function App() {
  // Applies the active theme: `data-theme` picks color-scheme, and each
  // resolved variable is set inline so it overrides the stylesheet defaults.
  createEffect(() => {
    const active = activeTheme();
    const root = document.documentElement;
    root.dataset.theme = active.kind;
    for (const [name, value] of Object.entries(active.vars)) {
      root.style.setProperty(name, value);
    }
  });

  createEffect(() => {
    const repo = activeRepo();
    if (!repo || repoUnavailable(repo)) return;
    const timer = window.setInterval(() => {
      void pollRepoStatus(repo);
    }, 2500);
    onCleanup(() => window.clearInterval(timer));
  });

  // Agent activity feeds the agents tab, the repo-tab badges and the graph's
  // agent markers, so it is polled here rather than by any one panel. The
  // interval is configurable (Menu > Agents) and nothing runs while agent
  // detection is off. The immediate refresh is untracked so its own loading
  // flag doesn't re-trigger this effect.
  createEffect(() => {
    if (!agentsEnabled()) return;
    const intervalMs = agentPollSeconds() * 1000;
    untrack(() => void refreshAgentActivity());
    const timer = window.setInterval(() => {
      void refreshAgentActivity();
    }, intervalMs);
    onCleanup(() => window.clearInterval(timer));
  });

  // Having the Pipelines tab open forces polling of all repos' active
  // pipelines; switching away stops it (the last result stays on screen). The
  // immediate refresh is untracked, like the agent one above.
  createEffect(() => {
    if (sidebarTab() !== "pipelines") return;
    untrack(() => void refreshPipelines());
    const timer = window.setInterval(() => {
      void refreshPipelines();
    }, PIPELINE_POLL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  // Completed CI runs of the open repo refresh on their own slow clock.
  createEffect(() => {
    const timer = window.setInterval(refreshActiveRepoCiRuns, CI_COMPLETED_REFRESH_INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  onMount(() => {
    loadActiveTabGraph();
    void loadThemes();
    void loadPreferences();
    const handleKeydown = (e: KeyboardEvent) => {
      const bindings = keyBindings();
      if (matchesKeyBinding(e, bindings.nextTab)) {
        e.preventDefault();
        activateAdjacentTab(1);
      } else if (matchesKeyBinding(e, bindings.prevTab)) {
        e.preventDefault();
        activateAdjacentTab(-1);
      } else if (matchesKeyBinding(e, bindings.toggleMenu)) {
        e.preventDefault();
        toggleMenu();
      } else if (matchesKeyBinding(e, bindings.commandPalette)) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (e.key === "Escape") {
        closeTopOverlay();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleKeydown));
  });

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight();
    const onMove = (ev: MouseEvent) => {
      setTerminalHeight(startHeight + (startY - ev.clientY));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startSidebarResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth();
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(startWidth + (ev.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div class="app">
      <WelcomeWizard />
      <MainMenu />
      <CommandPalette />
      <BranchContextMenu />
      <CommitContextMenu />
      <CreateBranchModal />
      <CreateTagModal />
      <NewGroupModal />
      <FileDiffModal />
      <DeleteBranchModal />
      <DeleteTagModal />
      <DirectoryBrowserModal />
      <RepoContextMenu />
      <TagContextMenu />
      <Sidebar />
      <div class="sidebar-resize-handle" onMouseDown={startSidebarResize} />
      <main class="main">
        <Show when={tabs().length > 0}>
          <div class="main-header">
            <TabsBar />
            <SearchBox />
          </div>
        </Show>
        <div class="content">
          <Show when={activeRepo()} fallback={<div class="empty-state">Select a repository to see its graph</div>}>
            <Show when={!repoUnavailable(activeRepo()!)} fallback={<div class="empty-state unavailable-state">Repository is no longer in the configured scan paths.</div>}>
              <div class="graph-and-list">
                <div class="graph-column">
                  <GraphPanel />
                </div>
                <div class="list-column">
                  <CommitList />
                </div>
              </div>
            </Show>
          </Show>
        </div>
        <div
          class="terminal-container"
          classList={{ collapsed: !terminalOpen() }}
          style={{ height: terminalOpen() ? `${terminalHeight()}px` : undefined }}
        >
          <Show when={terminalOpen()}>
            <div class="terminal-resize-handle" onMouseDown={startResize} />
          </Show>
          <div class="terminal-header" onClick={() => toggleTerminalOpen()}>
            <span>Terminal</span>
            <span class="chevron">{terminalOpen() ? "▾" : "▸"}</span>
          </div>
          {/* Each open repo keeps its own persistent shell — instances stay
              mounted (hidden via CSS, not unmounted) so switching tabs or
              collapsing the drawer never kills a running shell. */}
          <div class="terminal-body">
            <div class="terminal-instance" classList={{ hidden: tabs().length > 0 }}>
              <TerminalPanel repo={null} />
            </div>
            <For each={tabs()}>
              {(tab) => (
                <div class="terminal-instance" classList={{ hidden: activeRepo() !== tab.id }}>
                  <TerminalPanel repo={tab.id} />
                </div>
              )}
            </For>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

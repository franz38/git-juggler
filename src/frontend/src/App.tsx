import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
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
import { ConflictsPanel } from "./components/Conflicts/ConflictsPanel";
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
  activeRepoForPane,
  activateAdjacentTab,
  activateTab,
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
  conflictStateForRepo,
  repoUnavailable,
  leftTabs,
  rightTabs,
  setSidebarWidth,
  setSplitRatio,
  sidebarTab,
  setTerminalHeight,
  sidebarWidth,
  splitActive,
  splitRatio,
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
  const [terminalDrawerTab, setTerminalDrawerTab] = createSignal<"terminal" | "conflicts">("terminal");
  const activeConflictState = createMemo(() => {
    const repo = activeRepo();
    return repo ? conflictStateForRepo(repo) : null;
  });
  const conflictTabVisible = createMemo(() => {
    const state = activeConflictState();
    return !!state && (state.files.length > 0 || state.can_continue);
  });

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

  createEffect(() => {
    if (!conflictTabVisible() && terminalDrawerTab() === "conflicts") {
      setTerminalDrawerTab("terminal");
    }
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

  const startSplitResize = (e: MouseEvent) => {
    e.preventDefault();
    const main = (e.currentTarget as HTMLElement).closest(".workspace-panes") as HTMLElement | null;
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      setSplitRatio((ev.clientX - rect.left) / rect.width);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const renderPane = (pane: "left" | "right") => {
    const paneTabs = () => (pane === "right" ? rightTabs() : leftTabs());
    const paneRepo = () => activeRepoForPane(pane);
    return (
      <section
        class="workspace-pane"
        data-tab-pane={pane}
        style={splitActive() ? { flex: pane === "left" ? `${splitRatio()} 1 0` : `${1 - splitRatio()} 1 0` } : undefined}
        onMouseDown={() => {
          const repo = paneRepo();
          if (repo && activeRepo() !== repo) activateTab(repo);
        }}
      >
        <Show when={paneTabs().length > 0}>
          <div class="main-header">
            <TabsBar pane={pane} tabs={paneTabs()} />
            <Show when={pane === (splitActive() ? "right" : "left")}>
              <SearchBox />
            </Show>
          </div>
        </Show>
        <div class="content">
          <Show when={paneRepo()} fallback={<div class="empty-state">{tabs().length === 0 ? "Select a repository to see its graph" : "Drop a tab here to split the view"}</div>}>
            {(repo) => (
              <Show when={!repoUnavailable(repo())} fallback={<div class="empty-state unavailable-state">Repository is no longer in the configured scan paths.</div>}>
                <div class="graph-and-list">
                  <div class="graph-column">
                    <GraphPanel repoId={repo()} />
                  </div>
                  <div class="list-column">
                    <CommitList repoId={repo()} />
                  </div>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </section>
    );
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
        <div class="workspace-panes" classList={{ split: splitActive() }}>
          {renderPane("left")}
          <Show when={splitActive()}>
            <div class="split-resize-handle" onMouseDown={startSplitResize} />
            {renderPane("right")}
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
            <div class="terminal-tabs" onClick={(e) => e.stopPropagation()}>
              <button type="button" class="terminal-tab" classList={{ active: terminalDrawerTab() === "terminal" }} onClick={() => setTerminalDrawerTab("terminal")}>
                Terminal
              </button>
              <Show when={conflictTabVisible()}>
                <button type="button" class="terminal-tab" classList={{ active: terminalDrawerTab() === "conflicts" }} onClick={() => setTerminalDrawerTab("conflicts")}>
                  Conflicts<span class="terminal-tab-badge">{activeConflictState()?.files.length || "ready"}</span>
                </button>
              </Show>
            </div>
            <span class="chevron">{terminalOpen() ? "▾" : "▸"}</span>
          </div>
          {/* Each open repo keeps its own persistent shell — instances stay
              mounted (hidden via CSS, not unmounted) so switching tabs or
              collapsing the drawer never kills a running shell. */}
          <div class="terminal-body">
            <div class="terminal-tab-body" classList={{ hidden: terminalDrawerTab() !== "terminal" }}>
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
            <Show when={terminalDrawerTab() === "conflicts" && activeRepo()}>
              {(repo) => <ConflictsPanel repoId={repo()} />}
            </Show>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

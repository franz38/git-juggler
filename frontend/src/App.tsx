import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import "./App.css";
import { GraphPanel } from "./components/Graph/GraphPanel";
import { CommitContextMenu } from "./components/ContextMenu/CommitContextMenu";
import { CreateTagModal } from "./components/ContextMenu/CreateTagModal";
import { RepoContextMenu } from "./components/ContextMenu/RepoContextMenu";
import { CommitList } from "./components/Commits/CommitList";
import { MainMenu } from "./components/Menu/MainMenu";
import { RepoList } from "./components/Sidebar/RepoList";
import { SearchBox } from "./components/Search/SearchBox";
import { TabsBar } from "./components/Tabs/TabsBar";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import {
  activeRepo,
  activateAdjacentTab,
  closeMenu,
  loadActiveTabGraph,
  menuOpen,
  pollRepoStatus,
  setTerminalHeight,
  tabs,
  terminalHeight,
  terminalOpen,
  theme,
  toggleMenu,
  toggleTerminalOpen,
} from "./state/store";

function App() {
  createEffect(() => {
    document.documentElement.dataset.theme = theme();
  });

  createEffect(() => {
    const repo = activeRepo();
    if (!repo) return;
    const timer = window.setInterval(() => {
      void pollRepoStatus(repo);
    }, 2500);
    onCleanup(() => window.clearInterval(timer));
  });

  onMount(() => {
    loadActiveTabGraph();
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        activateAdjacentTab(1);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        activateAdjacentTab(-1);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === "Escape" && menuOpen()) {
        closeMenu();
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

  return (
    <div class="app">
      <MainMenu />
      <CommitContextMenu />
      <CreateTagModal />
      <RepoContextMenu />
      <aside class="sidebar">
        <RepoList />
      </aside>
      <main class="main">
        <Show when={tabs().length > 0}>
          <div class="main-header">
            <TabsBar />
            <SearchBox />
          </div>
        </Show>
        <div class="content">
          <Show when={activeRepo()} fallback={<div class="empty-state">Select a repository to see its graph</div>}>
            <div class="graph-and-list">
              <div class="graph-column">
                <GraphPanel />
              </div>
              <div class="list-column">
                <CommitList />
              </div>
            </div>
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

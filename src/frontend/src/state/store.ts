import { createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { branchNames, startOfDayMs, visibleCommitHashes } from "../lib/branchVisibility";
import { browseDirectory, fetchAgentActivity, fetchAgentHooks, fetchCiRuns, fetchCommitDetail, fetchConfig, fetchGraph, fetchRepoStatus, fetchRepos, installAgentHook, updateConfig } from "../api/client";
import type { AgentActivityResponse, AgentHookProviderStatus, AgentHooksResponse, AgentWorktreeActivity, BrowseEntry, CiRunInfo, CommitDetail, CommitSummary, FileChange, GitHubConfig, JenkinsConfig, Preferences, RepoGroupConfig, RepoSummary } from "../api/types";
import { savePreference } from "./preferenceSync";

export const COLLAPSED_ROW_HEIGHT = 28;
export const EXPANDED_BASE_HEIGHT = 168;
export const FILE_ROW_HEIGHT = 20;
// The commit message block in an expanded row; only used for the first-frame
// height estimate (the real height is measured once the row mounts).
export const MESSAGE_LINE_HEIGHT = 18;
export const MESSAGE_BLOCK_PADDING = 12;
export const DETAIL_LOADING_HEIGHT = 40;
export const UNCOMMITTED_ROW_KEY = "__git-juggler-uncommitted__";

export interface TabInfo {
  id: string;
  name: string;
  pinned: boolean;
}

interface PersistedTabsState {
  tabs: TabInfo[];
  activeRepo: string | null;
}

interface RepoState {
  commits: CommitSummary[];
  currentBranch: string | null;
  checkedOutBranches: string[];
  headCommit: string | null;
  upstreamCommit: string | null;
  refsSignature: string | null;
  isDirty: boolean;
  uncommittedFiles: FileChange[];
  uncommittedExpanded: boolean;
  expanded: Set<string>;
  details: Record<string, CommitDetail>;
  ciRuns: Record<string, CiRunInfo[]>;
  ciLoading: boolean;
  ciError: string | null;
  loading: boolean;
  error: string | null;
}

const TABS_STATE_KEY = "git-juggler:tabs";

function loadTabsState(): PersistedTabsState {
  try {
    const raw = localStorage.getItem(TABS_STATE_KEY);
    if (!raw) return { tabs: [], activeRepo: null };
    const parsed = JSON.parse(raw) as PersistedTabsState;
    const parsedTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const restoredTabs = parsedTabs
      .filter((tab) => typeof tab.id === "string" && typeof tab.name === "string")
      .map((tab) => ({ id: tab.id, name: tab.name, pinned: Boolean(tab.pinned) }));
    const restoredActive = typeof parsed.activeRepo === "string" && restoredTabs.some((tab) => tab.id === parsed.activeRepo) ? parsed.activeRepo : restoredTabs[0]?.id ?? null;
    return { tabs: restoredTabs, activeRepo: restoredActive };
  } catch {
    return { tabs: [], activeRepo: null };
  }
}

const restoredTabsState = loadTabsState();
const [repos, setRepos] = createSignal<RepoSummary[]>([]);
const [reposLoading, setReposLoading] = createSignal(false);
const [tabs, setTabsSignal] = createSignal<TabInfo[]>(restoredTabsState.tabs);
const [activeRepo, setActiveRepoSignal] = createSignal<string | null>(restoredTabsState.activeRepo);
const [repoStates, setRepoStates] = createStore<Record<string, RepoState>>({});
const inFlightDetailRequests = new Set<string>();
const pendingGraphRefreshes = new Set<string>();

function persistTabsState(nextTabs = tabs(), nextActiveRepo = activeRepo()): void {
  try {
    localStorage.setItem(TABS_STATE_KEY, JSON.stringify({ tabs: nextTabs, activeRepo: nextActiveRepo }));
  } catch {
    // Not critical — tabs just won't survive a reload.
  }
}

function setTabs(nextTabs: TabInfo[]): void {
  setTabsSignal(nextTabs);
  persistTabsState(nextTabs, activeRepo());
}

function setActiveRepo(nextActiveRepo: string | null): void {
  setActiveRepoSignal(nextActiveRepo);
  persistTabsState(tabs(), nextActiveRepo);
}

// Actual rendered row heights (in px), reported by each CommitRow via
// ResizeObserver. The estimate constants below are only a placeholder for
// the one frame before a row's real height is measured — using estimates
// for layout was the previous approach, but any drift between an estimate
// and the true DOM height (borders, font metrics, ...) accumulates down the
// list and throws the graph's dots out of alignment with their rows.
const [measuredHeights, setMeasuredHeights] = createStore<Record<string, number>>({});

export function reportRowHeight(hash: string, height: number): void {
  if (measuredHeights[hash] !== height) {
    setMeasuredHeights(hash, height);
  }
}

export { repos, reposLoading, tabs, activeRepo };

// --- Repos sidebar -------------------------------------------------------

const SIDEBAR_WIDTH_KEY = "git-juggler:sidebarWidth";
export const SIDEBAR_DEFAULT_WIDTH = 250;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n)) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

const [sidebarWidth, setSidebarWidthSignal] = createSignal(loadSidebarWidth());
export { sidebarWidth };

export function setSidebarWidth(width: number): void {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
  setSidebarWidthSignal(clamped);
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  } catch {
    // Not critical — the size just won't survive a reload.
  }
}

export async function loadRepos(): Promise<void> {
  setReposLoading(true);
  try {
    setRepos(await fetchRepos());
  } catch {
    // The sidebar just stays empty; nowhere good to surface this yet.
  } finally {
    setReposLoading(false);
  }
}

// --- Directory browser -----------------------------------------------------
// A read-only folder picker (backed by GET /api/browse) for filling in a
// repo search path without typing an absolute path by hand.

export interface DirectoryBrowserState {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  onSelect: (path: string) => void;
}

const [directoryBrowser, setDirectoryBrowser] = createSignal<DirectoryBrowserState | null>(null);
export { directoryBrowser };

async function loadBrowseDirectory(path: string | undefined, onSelect: (path: string) => void): Promise<void> {
  setDirectoryBrowser((current) =>
    current ? { ...current, loading: true, error: null } : { path: path ?? "", parent: null, entries: [], loading: true, error: null, onSelect },
  );
  try {
    const data = await browseDirectory(path);
    setDirectoryBrowser({ path: data.path, parent: data.parent, entries: data.entries, loading: false, error: null, onSelect });
  } catch (e) {
    setDirectoryBrowser((current) => (current ? { ...current, loading: false, error: (e as Error).message } : current));
  }
}

export function openDirectoryBrowser(onSelect: (path: string) => void): void {
  void loadBrowseDirectory(undefined, onSelect);
}

export function navigateDirectoryBrowser(path: string): void {
  const state = directoryBrowser();
  if (!state) return;
  void loadBrowseDirectory(path, state.onSelect);
}

export function closeDirectoryBrowser(): void {
  setDirectoryBrowser(null);
}

export function selectDirectoryBrowserPath(): void {
  const state = directoryBrowser();
  if (!state) return;
  state.onSelect(state.path);
  setDirectoryBrowser(null);
}

// --- Key bindings ----------------------------------------------------------

export interface KeyBinding {
  key: string;
  mod: boolean; // Cmd on mac, Ctrl elsewhere -- treated as one interchangeable modifier
  shift: boolean;
  alt: boolean;
}

export type KeyBindingAction = "nextTab" | "prevTab" | "toggleMenu";

export const KEY_BINDING_ACTIONS: { id: KeyBindingAction; label: string }[] = [
  { id: "nextTab", label: "Next tab" },
  { id: "prevTab", label: "Previous tab" },
  { id: "toggleMenu", label: "Open/close main menu" },
];

const DEFAULT_KEY_BINDINGS: Record<KeyBindingAction, KeyBinding> = {
  nextTab: { key: "ArrowRight", mod: true, shift: true, alt: false },
  prevTab: { key: "ArrowLeft", mod: true, shift: true, alt: false },
  toggleMenu: { key: "p", mod: true, shift: false, alt: false },
};

const KEY_BINDINGS_KEY = "git-juggler:keyBindings";

function loadKeyBindings(): Record<KeyBindingAction, KeyBinding> {
  try {
    const raw = localStorage.getItem(KEY_BINDINGS_KEY);
    if (!raw) return { ...DEFAULT_KEY_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<Record<KeyBindingAction, KeyBinding>>;
    return { ...DEFAULT_KEY_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_KEY_BINDINGS };
  }
}

const [keyBindings, setKeyBindingsSignal] = createSignal(loadKeyBindings());
export { keyBindings };

export function setKeyBinding(action: KeyBindingAction, binding: KeyBinding): void {
  const next = { ...keyBindings(), [action]: binding };
  setKeyBindingsSignal(next);
  try {
    localStorage.setItem(KEY_BINDINGS_KEY, JSON.stringify(next));
  } catch {
    // Not critical — the binding just won't survive a reload.
  }
  savePreference({ key_bindings: next });
}

export function resetKeyBinding(action: KeyBindingAction): void {
  setKeyBinding(action, DEFAULT_KEY_BINDINGS[action]);
}

export function matchesKeyBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  return (
    e.key.toLowerCase() === binding.key.toLowerCase() &&
    (e.metaKey || e.ctrlKey) === binding.mod &&
    e.shiftKey === binding.shift &&
    e.altKey === binding.alt
  );
}

const KEY_DISPLAY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push("Cmd/Ctrl");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  const keyName = KEY_DISPLAY_NAMES[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  parts.push(keyName);
  return parts.join("+");
}

// Pinned repos are persisted server-side (~/.config/git-juggler/config.json)
// keyed by full path, since that's stable across restarts regardless of how
// the scan-root list gets edited.
const [pinnedRepos, setPinnedRepos] = createSignal<Set<string>>(new Set());
const [repoGroups, setRepoGroups] = createSignal<RepoGroupConfig[]>([]);
export { pinnedRepos, repoGroups };

const AGENTS_ENABLED_KEY = "git-juggler:agentsEnabled";
const AGENT_WORKTREES_KEY = "git-juggler:agentShowWorktrees";

function loadBoolean(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function saveBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not critical — the setting just won't survive a reload.
  }
}

const [agentsEnabled, setAgentsEnabledSignal] = createSignal(loadBoolean(AGENTS_ENABLED_KEY));
export { agentsEnabled };

// Whether the agents panel lists each session's worktrees (off by default).
const [agentShowWorktrees, setAgentShowWorktreesSignal] = createSignal(loadBoolean(AGENT_WORKTREES_KEY));
export { agentShowWorktrees };
export function setAgentShowWorktrees(show: boolean): void {
  setAgentShowWorktreesSignal(show);
  saveBoolean(AGENT_WORKTREES_KEY, show);
  savePreference({ agent_show_worktrees: show });
}

// Left panel tabs: the repo list (default) and the agents list. The agents tab
// only exists while agent detection is on, so it falls back to the repos tab.
export type SidebarTab = "repos" | "agents";
const [requestedSidebarTab, setSidebarTab] = createSignal<SidebarTab>("repos");
export const sidebarTab = createMemo<SidebarTab>(() => (requestedSidebarTab() === "agents" && agentsEnabled() ? "agents" : "repos"));
export { setSidebarTab };

const [agentActivity, setAgentActivity] = createSignal<AgentActivityResponse | null>(null);
const [agentActivityLoading, setAgentActivityLoading] = createSignal(false);
const [agentActivityError, setAgentActivityError] = createSignal<string | null>(null);
export { agentActivity, agentActivityLoading, agentActivityError };

// How often agent activity is polled, in seconds (Menu > Agents). Polling
// itself is driven from App and only runs while agent detection is enabled.
export const DEFAULT_AGENT_POLL_SECONDS = 1;
export const MAX_AGENT_POLL_SECONDS = 3600;
const AGENT_POLL_SECONDS_KEY = "git-juggler:agentPollSeconds";

function clampPollSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_POLL_SECONDS;
  return Math.min(MAX_AGENT_POLL_SECONDS, Math.max(1, Math.round(value)));
}

function loadAgentPollSeconds(): number {
  try {
    const stored = localStorage.getItem(AGENT_POLL_SECONDS_KEY);
    return stored === null ? DEFAULT_AGENT_POLL_SECONDS : clampPollSeconds(Number(stored));
  } catch {
    return DEFAULT_AGENT_POLL_SECONDS;
  }
}

const [agentPollSeconds, setAgentPollSecondsSignal] = createSignal(loadAgentPollSeconds());
export { agentPollSeconds };
export function setAgentPollSeconds(seconds: number): void {
  const next = clampPollSeconds(seconds);
  setAgentPollSecondsSignal(next);
  try {
    localStorage.setItem(AGENT_POLL_SECONDS_KEY, String(next));
  } catch {
    // Not critical — the setting just won't survive a reload.
  }
  savePreference({ agent_poll_seconds: next });
}

const [agentHooks, setAgentHooks] = createSignal<AgentHooksResponse | null>(null);
const [agentHooksLoading, setAgentHooksLoading] = createSignal(false);
const [agentHooksError, setAgentHooksError] = createSignal<string | null>(null);
export { agentHooks, agentHooksLoading, agentHooksError };

// When disabled, no agent data is fetched (refreshAgentActivity below
// no-ops) or shown (AgentActivityPanel isn't rendered at all) anywhere.
function applyAgentsEnabled(enabled: boolean): void {
  setAgentsEnabledSignal(enabled);
  saveBoolean(AGENTS_ENABLED_KEY, enabled);
  if (!enabled) {
    setAgentActivity(null);
    setAgentActivityError(null);
  }
}

export function setAgentsEnabled(enabled: boolean): void {
  applyAgentsEnabled(enabled);
  savePreference({ agents_enabled: enabled });
}

export const agentActivityByWorktreePath = createMemo<Map<string, AgentWorktreeActivity>>(() => {
  const byPath = new Map<string, AgentWorktreeActivity>();
  for (const scan of agentActivity()?.scans ?? []) {
    for (const activity of scan.worktrees) {
      const existing = byPath.get(activity.worktree_path);
      if (!existing || activity.last_activity > existing.last_activity) {
        byPath.set(activity.worktree_path, activity);
      }
    }
  }
  return byPath;
});

export const agentActivityByRepositoryId = createMemo<Map<string, AgentWorktreeActivity[]>>(() => {
  const byRepository = new Map<string, AgentWorktreeActivity[]>();
  for (const scan of agentActivity()?.scans ?? []) {
    for (const activity of scan.worktrees) {
      const items = byRepository.get(activity.repository_id) ?? [];
      items.push(activity);
      byRepository.set(activity.repository_id, items);
    }
  }
  for (const items of byRepository.values()) {
    items.sort((a, b) => b.last_activity - a.last_activity);
  }
  return byRepository;
});

// Number of active agent sessions touching each repository (keyed by
// repository_id), for the badges on the repo tabs.
export const activeAgentSessionsByRepositoryId = createMemo<Map<string, number>>(() => {
  const counts = new Map<string, number>();
  for (const scan of agentActivity()?.scans ?? []) {
    if (scan.state !== "active") continue;
    for (const repositoryId of new Set(scan.worktrees.map((worktree) => worktree.repository_id))) {
      counts.set(repositoryId, (counts.get(repositoryId) ?? 0) + 1);
    }
  }
  return counts;
});

export async function refreshAgentActivity(): Promise<void> {
  if (!agentsEnabled() || agentActivityLoading()) return;
  setAgentActivityLoading(true);
  setAgentActivityError(null);
  try {
    setAgentActivity(await fetchAgentActivity());
  } catch (e) {
    setAgentActivityError((e as Error).message);
  } finally {
    setAgentActivityLoading(false);
  }
}

export async function refreshAgentHooks(): Promise<void> {
  if (agentHooksLoading()) return;
  setAgentHooksLoading(true);
  setAgentHooksError(null);
  try {
    setAgentHooks(await fetchAgentHooks());
  } catch (e) {
    setAgentHooksError((e as Error).message);
  } finally {
    setAgentHooksLoading(false);
  }
}

export async function installAgentHooks(provider: "claude" | "opencode"): Promise<void> {
  if (agentHooksLoading()) return;
  setAgentHooksLoading(true);
  setAgentHooksError(null);
  try {
    const status: AgentHookProviderStatus = await installAgentHook(provider);
    const current = agentHooks();
    if (!current) {
      setAgentHooks(await fetchAgentHooks());
      return;
    }
    setAgentHooks({
      claude: provider === "claude" ? status : current.claude,
      opencode: provider === "opencode" ? status : current.opencode,
    });
  } catch (e) {
    setAgentHooksError((e as Error).message);
  } finally {
    setAgentHooksLoading(false);
  }
}

function updateGroupsFromConfig(groups: RepoGroupConfig[]): void {
  setRepoGroups(groups.map((group) => ({ ...group, repo_paths: [...group.repo_paths] })));
}

export async function toggleRepoPinned(path: string): Promise<void> {
  const next = new Set(pinnedRepos());
  if (next.has(path)) next.delete(path);
  else next.add(path);
  try {
    const data = await updateConfig({ pinned_repo_paths: [...next] });
    setPinnedRepos(new Set(data.pinned_repo_paths));
  } catch {
    // Pin just won't stick this time; nowhere good to surface it from here.
  }
}

export async function setRepoPinned(path: string, pinned: boolean): Promise<void> {
  const next = new Set(pinnedRepos());
  if (pinned) next.add(path);
  else next.delete(path);
  try {
    const data = await updateConfig({ pinned_repo_paths: [...next] });
    setPinnedRepos(new Set(data.pinned_repo_paths));
  } catch {
    // Pin just won't stick this time; nowhere good to surface it from here.
  }
}

async function saveRepoGroups(next: RepoGroupConfig[]): Promise<void> {
  try {
    const data = await updateConfig({ repo_groups: next });
    updateGroupsFromConfig(data.repo_groups);
  } catch {
    // Group changes are UI organization only; ignore transient save failures.
  }
}

export async function createRepoGroup(name: string, repoPath?: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const group: RepoGroupConfig = {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    repo_paths: repoPath ? [repoPath] : [],
  };
  await saveRepoGroups([...repoGroups(), group]);
}

export async function setRepoInGroup(groupId: string, repoPath: string, inGroup: boolean): Promise<void> {
  const next = repoGroups().map((group) => {
    if (group.id !== groupId) return group;
    const repoPaths = group.repo_paths.filter((path) => path !== repoPath);
    if (inGroup) repoPaths.push(repoPath);
    return { ...group, repo_paths: repoPaths };
  });
  await saveRepoGroups(next);
}

export async function moveRepoGroup(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const next = [...repoGroups()];
  const fromIndex = next.findIndex((group) => group.id === fromId);
  const toIndex = next.findIndex((group) => group.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  await saveRepoGroups(next);
}

export async function moveRepoGroupToIndex(fromId: string, toIndex: number): Promise<void> {
  const next = [...repoGroups()];
  const fromIndex = next.findIndex((group) => group.id === fromId);
  if (fromIndex < 0) return;
  const [moved] = next.splice(fromIndex, 1);
  const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(Math.max(0, Math.min(adjustedIndex, next.length)), 0, moved);
  await saveRepoGroups(next);
}

export async function moveRepoInGroup(groupId: string, fromRepoPath: string, toRepoPath: string): Promise<void> {
  if (fromRepoPath === toRepoPath) return;
  const next = repoGroups().map((group) => {
    if (group.id !== groupId) return group;
    const repoPaths = [...group.repo_paths];
    const fromIndex = repoPaths.indexOf(fromRepoPath);
    const toIndex = repoPaths.indexOf(toRepoPath);
    if (fromIndex < 0 || toIndex < 0) return group;
    const [moved] = repoPaths.splice(fromIndex, 1);
    repoPaths.splice(toIndex, 0, moved);
    return { ...group, repo_paths: repoPaths };
  });
  await saveRepoGroups(next);
}

// --- Tabs ------------------------------------------------------------------
// Open tabs are local UI state and persist across sessions, including tabs
// opened with a single click. Double-click still marks a tab as pinned visually.

function ensureRepoState(name: string): void {
  if (!repoStates[name]) {
    setRepoStates(name, {
      commits: [],
      currentBranch: null,
      checkedOutBranches: [],
      headCommit: null,
      upstreamCommit: null,
      refsSignature: null,
      isDirty: false,
      uncommittedFiles: [],
      uncommittedExpanded: false,
      expanded: new Set(),
      details: {},
      ciRuns: {},
      ciLoading: false,
      ciError: null,
      loading: false,
      error: null,
    });
  }
}

async function loadGraphInto(name: string): Promise<void> {
  setRepoStates(name, "loading", true);
  setRepoStates(name, "error", null);
  try {
    const data = await fetchGraph(name);
    setRepoStates(name, "commits", data.commits);
    setRepoStates(name, "currentBranch", data.current_branch);
    setRepoStates(name, "checkedOutBranches", data.checked_out_branches);
    setRepoStates(name, "headCommit", data.head_commit);
    setRepoStates(name, "upstreamCommit", data.upstream_commit);
    // Re-seeded by the next status poll.
    setRepoStates(name, "refsSignature", null);
    setRepoStates(name, "isDirty", data.is_dirty);
    setRepoStates(name, "uncommittedFiles", data.uncommitted_files);
    void loadCiRunsInto(name);
  } catch (e) {
    setRepoStates(name, "error", (e as Error).message);
  } finally {
    setRepoStates(name, "loading", false);
    if (pendingGraphRefreshes.has(name)) {
      pendingGraphRefreshes.delete(name);
      void refreshRepoGraph(name);
    }
  }
}

async function loadRepoGraphIfNeeded(name: string): Promise<void> {
  ensureRepoState(name);
  if (repoStates[name].commits.length > 0 || repoStates[name].loading) return;
  await loadGraphInto(name);
}

// Re-fetches a repo's graph regardless of whether it's already loaded — used
// to pick up HEAD moving after a checkout (see the terminal's command
// detection), since the initial load only happens once per repo otherwise.
export async function refreshRepoGraph(repoId: string): Promise<void> {
  ensureRepoState(repoId);
  if (repoStates[repoId].loading) {
    pendingGraphRefreshes.add(repoId);
    return;
  }
  await loadGraphInto(repoId);
}

export async function pollRepoStatus(repoId: string): Promise<void> {
  const state = repoStates[repoId];
  if (!state || state.loading || state.commits.length === 0) return;
  try {
    const status = await fetchRepoStatus(repoId);
    if (status.head_commit !== state.headCommit || status.current_branch !== state.currentBranch) {
      await refreshRepoGraph(repoId);
      return;
    }
    // New/moved/deleted branches, tags or worktrees don't move HEAD.
    const known = state.refsSignature;
    setRepoStates(repoId, "refsSignature", status.refs_signature);
    if (known !== null && known !== status.refs_signature) {
      await refreshRepoGraph(repoId);
      return;
    }
    setRepoStates(repoId, "upstreamCommit", status.upstream_commit);
    setRepoStates(repoId, "isDirty", status.is_dirty);
    setRepoStates(repoId, "uncommittedFiles", status.uncommitted_files);
  } catch {
    // Status polling is opportunistic; the next graph load can surface errors.
  }
}

const graphRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const checkoutRefreshTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
const CHECKOUT_REFRESH_DEBOUNCE_MS = 600;
const CHECKOUT_REFRESH_DELAYS_MS = [600, 1500];
const COMMIT_REFRESH_DELAYS_MS = [600, 1500, 3000];

// Debounced so a burst of output from one checkout command only triggers a
// single refresh, once things settle.
export function scheduleGraphRefresh(repoId: string): void {
  const existing = graphRefreshTimers.get(repoId);
  if (existing) clearTimeout(existing);
  graphRefreshTimers.set(
    repoId,
    setTimeout(() => {
      graphRefreshTimers.delete(repoId);
      void refreshRepoGraph(repoId);
    }, CHECKOUT_REFRESH_DEBOUNCE_MS),
  );
}

export function scheduleCheckoutRefresh(repoId: string): void {
  const existing = checkoutRefreshTimers.get(repoId) ?? [];
  for (const timer of existing) clearTimeout(timer);
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const delay of CHECKOUT_REFRESH_DELAYS_MS) {
    const timer = setTimeout(() => {
      const current = checkoutRefreshTimers.get(repoId) ?? [];
      const remaining = current.filter((item) => item !== timer);
      if (remaining.length > 0) checkoutRefreshTimers.set(repoId, remaining);
      else checkoutRefreshTimers.delete(repoId);
      void refreshRepoGraph(repoId);
    }, delay);
    timers.push(timer);
  }
  checkoutRefreshTimers.set(repoId, timers);
}

export function scheduleCommitRefresh(repoId: string): void {
  scheduleTimedGraphRefreshes(repoId, COMMIT_REFRESH_DELAYS_MS);
}

function scheduleTimedGraphRefreshes(repoId: string, delays: number[]): void {
  const existing = checkoutRefreshTimers.get(repoId) ?? [];
  for (const timer of existing) clearTimeout(timer);
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const delay of delays) {
    const timer = setTimeout(() => {
      const current = checkoutRefreshTimers.get(repoId) ?? [];
      const remaining = current.filter((item) => item !== timer);
      if (remaining.length > 0) checkoutRefreshTimers.set(repoId, remaining);
      else checkoutRefreshTimers.delete(repoId);
      void refreshRepoGraph(repoId);
    }, delay);
    timers.push(timer);
  }
  checkoutRefreshTimers.set(repoId, timers);
}

export function openRepoTab(id: string, name: string): void {
  const current = tabs();
  if (!current.some((t) => t.id === id)) {
    setTabs([...current, { id, name, pinned: false }]);
  }
  setActiveRepo(id);
  void loadRepoGraphIfNeeded(id);
}

export function activateTab(id: string): void {
  setActiveRepo(id);
  void loadRepoGraphIfNeeded(id);
}

export function loadActiveTabGraph(): void {
  const active = activeRepo();
  if (active) void loadRepoGraphIfNeeded(active);
}

export function pinTab(id: string): void {
  setTabs(tabs().map((t) => (t.id === id ? { ...t, pinned: true } : t)));
}

export function moveTab(draggedId: string, targetId: string, placement: "before" | "after" = "before"): void {
  if (draggedId === targetId) return;
  const current = tabs();
  const from = current.findIndex((tab) => tab.id === draggedId);
  const to = current.findIndex((tab) => tab.id === targetId);
  if (from === -1 || to === -1) return;
  const next = [...current];
  const [dragged] = next.splice(from, 1);
  const targetIndex = next.findIndex((tab) => tab.id === targetId);
  next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, dragged);
  setTabs(next);
}

export function activateAdjacentTab(direction: 1 | -1): void {
  const current = tabs();
  if (current.length === 0) return;
  const active = activeRepo();
  const index = Math.max(0, current.findIndex((tab) => tab.id === active));
  const nextIndex = (index + direction + current.length) % current.length;
  activateTab(current[nextIndex].id);
}

export function closeTab(id: string): void {
  const current = tabs();
  const idx = current.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const next = current.filter((t) => t.id !== id);
  setTabs(next);
  if (activeRepo() === id) {
    const fallback = next[idx] ?? next[idx - 1];
    setActiveRepo(fallback ? fallback.id : null);
  }
}

// --- Active repo's commit graph ---------------------------------------------

export const commits = createMemo<CommitSummary[]>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.commits ?? [] : [];
});

const [authorFilter, setAuthorFilterSignal] = createSignal<string[]>([]);
const [commentFilter, setCommentFilterSignal] = createSignal("");
export { authorFilter, commentFilter };

export function setAuthorFilter(authors: string[]): void {
  setAuthorFilterSignal(authors);
}

export function setCommentFilter(value: string): void {
  setCommentFilterSignal(value);
}

// Authors from every open tab's repo, not just the active one — opening a
// tab always loads its commits (see openRepoTab), so this covers every repo
// the user currently has open, letting them filter the active repo by an
// author they only recognize from another tab.
export const commitAuthors = createMemo<string[]>(() => {
  const authors = new Set<string>();
  for (const tab of tabs()) {
    for (const commit of repoStates[tab.id]?.commits ?? []) {
      if (commit.author.name) authors.add(commit.author.name);
    }
  }
  return [...authors].sort((a, b) => a.localeCompare(b));
});

// --- Branch visibility filter (the eye button next to the commit filter) ---
// The checked branches are remembered per repo (branch names differ between
// repos); the "commits since" date applies to whichever repo is active.

const [branchSelections, setBranchSelections] = createSignal<Record<string, string[]>>({});
const [branchSince, setBranchSinceSignal] = createSignal("");
export { branchSince };

export function setBranchSince(date: string): void {
  setBranchSinceSignal(date);
}

export const commitBranches = createMemo<string[]>(() => branchNames(commits()));

// Checked branches of the active repo, ignoring ones that no longer exist.
export const branchFilter = createMemo<string[]>(() => {
  const name = activeRepo();
  const selected = name ? branchSelections()[name] ?? [] : [];
  const existing = new Set(commitBranches());
  return selected.filter((branch) => existing.has(branch));
});

export function setBranchFilter(branches: string[]): void {
  const name = activeRepo();
  if (name) setBranchSelections((current) => ({ ...current, [name]: branches }));
}

export function clearBranchFilters(): void {
  setBranchFilter([]);
  setBranchSince("");
}

const visibleBranchHashes = createMemo<Set<string> | null>(() => visibleCommitHashes(commits(), branchFilter(), startOfDayMs(branchSince())));

export const filteredCommits = createMemo<CommitSummary[]>(() => {
  const authors = authorFilter();
  const comment = commentFilter().trim().toLowerCase();
  const visibleByBranch = visibleBranchHashes();
  return commits().filter((commit) => {
    if (visibleByBranch && !visibleByBranch.has(commit.hash)) return false;
    if (authors.length > 0 && !authors.includes(commit.author.name)) return false;
    if (comment && !commit.subject.toLowerCase().includes(comment)) return false;
    return true;
  });
});

export const currentBranch = createMemo<string | null>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.currentBranch ?? null : null;
});

// Branches checked out in any worktree of the repo (including the one this
// repo path points at) — see computeColumns, which gives each of these its
// own stable lane instead of packing it like an ordinary branch.
export const checkedOutBranches = createMemo<string[]>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.checkedOutBranches ?? [] : [];
});

export const headCommit = createMemo<string | null>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.headCommit ?? null : null;
});

export const upstreamCommit = createMemo<string | null>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.upstreamCommit ?? null : null;
});

export const isDirty = createMemo<boolean>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.isDirty ?? false : false;
});

// The working-tree row belongs to HEAD, so it goes away with HEAD's branch
// when the branch filter hides it.
export const workingTreeVisible = createMemo<boolean>(() => {
  const head = headCommit();
  if (head === null || !isDirty()) return false;
  const visible = visibleBranchHashes();
  return visible === null || visible.has(head);
});

export const uncommittedFiles = createMemo<FileChange[]>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.uncommittedFiles ?? [] : [];
});

export const uncommittedExpanded = createMemo<boolean>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.uncommittedExpanded ?? false : false;
});

export function toggleUncommittedExpanded(): void {
  const name = activeRepo();
  if (!name) return;
  ensureRepoState(name);
  setRepoStates(name, "uncommittedExpanded", !repoStates[name].uncommittedExpanded);
}

// For displaying a tab's branch without it being the active repo.
export function repoCurrentBranch(name: string): string | null {
  return repoStates[name]?.currentBranch ?? null;
}

export const expandedHashes = createMemo<Set<string>>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.expanded ?? new Set<string>() : new Set<string>();
});

export const commitDetails = createMemo<Record<string, CommitDetail>>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.details ?? {} : {};
});

export const ciRuns = createMemo<Record<string, CiRunInfo[]>>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.ciRuns ?? {} : {};
});

export const graphLoading = createMemo<boolean>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.loading ?? false : false;
});

export const errorMessage = createMemo<string | null>(() => {
  const name = activeRepo();
  return name ? repoStates[name]?.error ?? null : null;
});

export function toggleExpand(hash: string): void {
  const name = activeRepo();
  if (!name) return;
  ensureRepoState(name);
  const next = new Set(repoStates[name].expanded);
  if (next.has(hash)) {
    next.delete(hash);
  } else {
    next.add(hash);
    void ensureDetail(name, hash);
  }
  setRepoStates(name, "expanded", next);
}

async function ensureDetail(repo: string, hash: string): Promise<void> {
  const key = `${repo}:${hash}`;
  if (repoStates[repo]?.details[hash] || inFlightDetailRequests.has(key)) return;
  inFlightDetailRequests.add(key);
  try {
    const detail = await fetchCommitDetail(repo, hash);
    setRepoStates(repo, "details", hash, detail);
  } catch {
    // Row just stays without file details; not worth a global error banner.
  } finally {
    inFlightDetailRequests.delete(key);
  }
}

function rowHeight(name: string, hash: string): number {
  const measured = measuredHeights[hash];
  if (measured !== undefined) return measured;

  // Estimate for the single frame before ResizeObserver reports the real
  // height on mount.
  const state = repoStates[name];
  if (!state?.expanded.has(hash)) return COLLAPSED_ROW_HEIGHT;
  const detail = state.details[hash];
  if (!detail) return COLLAPSED_ROW_HEIGHT + DETAIL_LOADING_HEIGHT;
  const messageLines = detail.message.trimEnd().split("\n").length;
  return COLLAPSED_ROW_HEIGHT + EXPANDED_BASE_HEIGHT + MESSAGE_BLOCK_PADDING + messageLines * MESSAGE_LINE_HEIGHT + detail.files.length * FILE_ROW_HEIGHT;
}

export const uncommittedRowHeight = createMemo<number>(() => {
  const name = activeRepo();
  if (!name || !isDirty() || headCommit() === null) return 0;
  const measured = measuredHeights[UNCOMMITTED_ROW_KEY];
  if (measured !== undefined) return measured;
  if (!repoStates[name]?.uncommittedExpanded) return COLLAPSED_ROW_HEIGHT;
  return COLLAPSED_ROW_HEIGHT + 16 + uncommittedFiles().length * FILE_ROW_HEIGHT;
});

// Single source of truth for vertical layout, shared by the graph SVG and
// the commit list so expanding a row shifts both in lockstep. Newest first,
// which is the reverse of the backend's replay order.
export const rowLayout = createMemo(() => {
  const name = activeRepo();
  const order = [...filteredCommits()].reverse();
  const offsetByHash = new Map<string, number>();
  let y = 0;
  for (const c of order) {
    offsetByHash.set(c.hash, y);
    y += name ? rowHeight(name, c.hash) : COLLAPSED_ROW_HEIGHT;
  }
  return { order, offsetByHash, total: y };
});

// --- Commit search -----------------------------------------------------
// Searches the active repo's commit subject and hash. Matching rows are
// highlighted; the search box scrolls to a single unambiguous match on Enter.

const [searchQuery, setSearchQuery] = createSignal("");
export { searchQuery, setSearchQuery };

export const matchingHashes = createMemo<Set<string>>(() => {
  const query = searchQuery().trim().toLowerCase();
  if (!query) return new Set();
  const matches = new Set<string>();
  for (const c of filteredCommits()) {
    if (c.hash.toLowerCase().includes(query) || c.subject.toLowerCase().includes(query)) {
      matches.add(c.hash);
    }
  }
  return matches;
});

// --- Settings (Cmd/Ctrl+P main menu) ---------------------------------------

const [menuOpen, setMenuOpen] = createSignal(false);
export { menuOpen };

export function openMenu(): void {
  setMenuOpen(true);
  void loadConfig();
}

export function closeMenu(): void {
  setMenuOpen(false);
}

export function toggleMenu(): void {
  if (menuOpen()) closeMenu();
  else openMenu();
}

const [repoPaths, setRepoPaths] = createSignal<string[]>([]);
const [repoPathsError, setRepoPathsError] = createSignal<string | null>(null);
export { repoPaths, repoPathsError };

const [excludedPaths, setExcludedPaths] = createSignal<string[]>([]);
const [excludedPathsError, setExcludedPathsError] = createSignal<string | null>(null);
export { excludedPaths, excludedPathsError };

const defaultGitHubConfig: GitHubConfig = {
  enabled: true,
  auto_detect: true,
  api_base_url: "https://api.github.com",
  token_env: "GITHUB_TOKEN",
  repos: [],
};

const defaultJenkinsConfig: JenkinsConfig = {
  enabled: true,
  base_url: "",
  username: "",
  api_token_env: "JENKINS_API_TOKEN",
  build_limit: 50,
  jobs: [],
};

const [githubConfig, setGitHubConfig] = createSignal<GitHubConfig>(defaultGitHubConfig);
const [githubConfigError, setGitHubConfigError] = createSignal<string | null>(null);
export { githubConfig, githubConfigError };

const [jenkinsConfig, setJenkinsConfig] = createSignal<JenkinsConfig>(defaultJenkinsConfig);
const [jenkinsConfigError, setJenkinsConfigError] = createSignal<string | null>(null);
export { jenkinsConfig, jenkinsConfigError };

const CI_POLL_MS = 10000;
const CI_PUSH_REFRESH_DELAYS_MS = [1000, 5000, 15000, 30000];
const ciPollTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ciPushRefreshTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

function hasRunningCiRuns(runsByHash: Record<string, CiRunInfo[]>): boolean {
  return Object.values(runsByHash).some((runs) => runs.some((run) => run.status === "running"));
}

function clearCiPoll(repoId: string): void {
  const timer = ciPollTimers.get(repoId);
  if (timer) clearTimeout(timer);
  ciPollTimers.delete(repoId);
}

function scheduleCiPollIfNeeded(repoId: string, runsByHash: Record<string, CiRunInfo[]>): void {
  clearCiPoll(repoId);
  if (!hasRunningCiRuns(runsByHash)) return;
  ciPollTimers.set(
    repoId,
    setTimeout(() => {
      ciPollTimers.delete(repoId);
      void loadCiRunsInto(repoId);
    }, CI_POLL_MS),
  );
}

function clearCiPushRefresh(repoId: string): void {
  const timers = ciPushRefreshTimers.get(repoId) ?? [];
  for (const timer of timers) clearTimeout(timer);
  ciPushRefreshTimers.delete(repoId);
}

function applyGitHubConfig(config: GitHubConfig | null): void {
  const nextConfig = config ?? defaultGitHubConfig;
  setGitHubConfig(nextConfig);
  if (nextConfig.enabled || jenkinsConfig().enabled) return;

  for (const repoId of Object.keys(repoStates)) {
    clearCiPoll(repoId);
    clearCiPushRefresh(repoId);
    setRepoStates(repoId, "ciRuns", {});
    setRepoStates(repoId, "ciLoading", false);
    setRepoStates(repoId, "ciError", null);
  }
}

function applyJenkinsConfig(config: JenkinsConfig | null): void {
  const nextConfig = config ?? defaultJenkinsConfig;
  setJenkinsConfig(nextConfig);
  if (nextConfig.enabled || githubConfig().enabled) return;

  for (const repoId of Object.keys(repoStates)) {
    clearCiPoll(repoId);
    clearCiPushRefresh(repoId);
    setRepoStates(repoId, "ciRuns", {});
    setRepoStates(repoId, "ciLoading", false);
    setRepoStates(repoId, "ciError", null);
  }
}

export async function loadConfig(): Promise<void> {
  try {
    const data = await fetchConfig();
    setRepoPaths(data.repo_paths);
    setPinnedRepos(new Set(data.pinned_repo_paths));
    updateGroupsFromConfig(data.repo_groups);
    setExcludedPaths(data.excluded_paths);
    applyGitHubConfig(data.github);
    applyJenkinsConfig(data.jenkins);
    setRepoPathsError(null);
    setExcludedPathsError(null);
    setGitHubConfigError(null);
    setJenkinsConfigError(null);
  } catch (e) {
    setRepoPathsError((e as Error).message);
  }
}

async function loadCiRunsInto(repoId: string): Promise<void> {
  ensureRepoState(repoId);
  if (!githubConfig().enabled && !jenkinsConfig().enabled) {
    clearCiPoll(repoId);
    setRepoStates(repoId, "ciRuns", {});
    setRepoStates(repoId, "ciLoading", false);
    setRepoStates(repoId, "ciError", null);
    return;
  }
  if (repoStates[repoId].ciLoading) return;
  setRepoStates(repoId, "ciLoading", true);
  setRepoStates(repoId, "ciError", null);
  try {
    const runs = await fetchCiRuns(repoId);
    setRepoStates(repoId, "ciRuns", runs);
    scheduleCiPollIfNeeded(repoId, runs);
  } catch (e) {
    setRepoStates(repoId, "ciError", (e as Error).message);
    clearCiPoll(repoId);
  } finally {
    setRepoStates(repoId, "ciLoading", false);
  }
}

export function scheduleCiRefreshAfterPush(repoId: string): void {
  scheduleGraphRefresh(repoId);
  if (!githubConfig().enabled && !jenkinsConfig().enabled) return;
  clearCiPushRefresh(repoId);
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const delay of CI_PUSH_REFRESH_DELAYS_MS) {
    const timer = setTimeout(() => {
      const current = ciPushRefreshTimers.get(repoId) ?? [];
      const remaining = current.filter((item) => item !== timer);
      if (remaining.length > 0) ciPushRefreshTimers.set(repoId, remaining);
      else ciPushRefreshTimers.delete(repoId);
      void loadCiRunsInto(repoId);
    }, delay);
    timers.push(timer);
  }
  ciPushRefreshTimers.set(repoId, timers);
}

export async function saveGitHubConfig(next: GitHubConfig): Promise<void> {
  try {
    const data = await updateConfig({ github: next });
    applyGitHubConfig(data.github);
    setGitHubConfigError(null);
    const current = activeRepo();
    if (current && ((data.github ?? defaultGitHubConfig).enabled || jenkinsConfig().enabled)) void loadCiRunsInto(current);
  } catch (e) {
    setGitHubConfigError((e as Error).message);
  }
}

export async function saveJenkinsConfig(next: JenkinsConfig): Promise<void> {
  try {
    const data = await updateConfig({ jenkins: next });
    applyJenkinsConfig(data.jenkins);
    setJenkinsConfigError(null);
    const current = activeRepo();
    if (current && ((data.jenkins ?? defaultJenkinsConfig).enabled || githubConfig().enabled)) void loadCiRunsInto(current);
  } catch (e) {
    setJenkinsConfigError((e as Error).message);
  }
}

async function saveRepoPaths(next: string[]): Promise<void> {
  try {
    const data = await updateConfig({ repo_paths: next });
    setRepoPaths(data.repo_paths);
    setRepoPathsError(null);
    void loadRepos();
  } catch (e) {
    setRepoPathsError((e as Error).message);
  }
}

export async function addRepoPath(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed || repoPaths().includes(trimmed)) return;
  await saveRepoPaths([...repoPaths(), trimmed]);
}

export async function removeRepoPath(path: string): Promise<void> {
  await saveRepoPaths(repoPaths().filter((p) => p !== path));
}

export async function saveExcludedPaths(next: string[]): Promise<void> {
  try {
    const data = await updateConfig({ excluded_paths: next });
    setExcludedPaths(data.excluded_paths);
    setExcludedPathsError(null);
    // The exclusion list affects every loaded repo's uncommitted-change
    // detection, not just the active tab, so refresh all of them now
    // instead of waiting for each one's next 2.5s status poll.
    for (const repoId of Object.keys(repoStates)) {
      void pollRepoStatus(repoId);
    }
  } catch (e) {
    setExcludedPathsError((e as Error).message);
  }
}

// --- Terminal ---------------------------------------------------------
// Each open repo owns a persistent shell (see TerminalPanel); this is just
// the shared drawer chrome (open/collapsed, height) plus a registry so other
// parts of the UI (e.g. the commit context menu) can type a command into
// whichever repo's terminal is relevant, without owning the WebSocket.

const TERMINAL_HEIGHT_KEY = "git-juggler:terminalHeight";
export const TERMINAL_MIN_HEIGHT = 26;

function loadTerminalHeight(): number {
  try {
    const raw = localStorage.getItem(TERMINAL_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= TERMINAL_MIN_HEIGHT ? n : 260;
  } catch {
    return 260;
  }
}

const [terminalOpen, setTerminalOpen] = createSignal(true);
const [terminalHeight, setTerminalHeightSignal] = createSignal(loadTerminalHeight());
export { terminalHeight, terminalOpen };

export function toggleTerminalOpen(): void {
  setTerminalOpen((v) => !v);
}

export function openTerminal(): void {
  setTerminalOpen(true);
}

export function setTerminalHeight(height: number): void {
  const clamped = Math.max(TERMINAL_MIN_HEIGHT, height);
  setTerminalHeightSignal(clamped);
  try {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, String(clamped));
  } catch {
    // Not critical — the size just won't survive a reload.
  }
}

const terminalSenders = new Map<string, (data: string) => void>();
// Commands sent before a repo's terminal has finished connecting (e.g. right
// after opening its tab) are queued here and flushed once it registers.
const pendingCommands = new Map<string, string[]>();

export function registerTerminalSender(repoId: string, send: (data: string) => void): void {
  terminalSenders.set(repoId, send);
}

export function unregisterTerminalSender(repoId: string): void {
  terminalSenders.delete(repoId);
}

// Call once the socket is confirmed open — registration alone isn't enough,
// since the sender itself may still no-op while the connection is pending.
export function flushPendingCommands(repoId: string): void {
  const pending = pendingCommands.get(repoId);
  if (!pending) return;
  pendingCommands.delete(repoId);
  const send = terminalSenders.get(repoId);
  if (send) for (const command of pending) send(command);
}

export function runInTerminal(repoId: string, command: string): void {
  openTerminal();
  const data = `${command}\n`;
  const send = terminalSenders.get(repoId);
  if (send) {
    send(data);
  } else {
    const pending = pendingCommands.get(repoId) ?? [];
    pending.push(data);
    pendingCommands.set(repoId, pending);
  }
}

// --- Create tag modal -----------------------------------------------------
// Same constraint as everywhere else in this file: no structured "command
// finished" signal exists for a real terminal. Unlike Checkout (fire and
// forget, assume success), this feature needs a real success/failure
// result, so the command we send is extended with a plain shell `&&`/`||`
// tail that echoes a distinct marker line depending on `git tag`'s actual
// exit code. It's still the literal command that runs in the visible
// terminal — just a normal shell idiom — and we watch the WebSocket output
// for that repo for either marker to resolve a promise with the outcome.

export interface CreateTagTarget {
  hash: string;
  shortHash: string;
  subject: string;
}

const [createTagModal, setCreateTagModal] = createSignal<CreateTagTarget | null>(null);
export { createTagModal };

export function openCreateTagModal(target: CreateTagTarget): void {
  setCreateTagModal(target);
}

export function closeCreateTagModal(): void {
  setCreateTagModal(null);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const TAG_COMMAND_TIMEOUT_MS = 15000;

interface TerminalOutputWatcher {
  repoId: string;
  onChunk: (chunk: string) => void;
}

const terminalOutputWatchers = new Map<string, TerminalOutputWatcher>();

export function feedTerminalOutput(repoId: string, chunk: string): void {
  for (const watcher of terminalOutputWatchers.values()) {
    if (watcher.repoId === repoId) watcher.onChunk(chunk);
  }
}

// We can't reconstruct a clean, human-readable copy of *what git printed*
// from the raw PTY byte stream here: real interactive shells (prompt
// themes, syntax highlighting) redraw lines and emit control sequences with
// no accompanying newlines, so naively stripping ANSI codes out of the raw
// stream produces garbled text (verified against a real zsh session). A
// plain substring search for one of these two literal marker strings is
// robust instead — `echo` never colors or wraps its own output — so that's
// all this resolves: whether the tag was created, not what git said. The
// real output is always visible in the (already-open) terminal pane itself,
// which is the one place this repo's guideline says git output should be
// shown.
//
// The interactive shell echoes back exactly what we send it, *before*
// running it — so if the marker text appeared literally inside the command
// we send (as the argument to `echo`), that echoed *input* line would
// itself contain both markers, and a naive substring search would resolve
// "success" immediately, regardless of the real outcome (verified against a
// real pty: this was the actual behavior). `echoSafe` splits each marker
// across two adjacently-quoted shell strings ("git-juggler: tag ""created")
// — the shell concatenates them into the intact marker in its *evaluated
// output*, but the raw *echoed input* text still has the `""` in the
// middle, so it never contains the marker as a contiguous substring.
function echoSafe(marker: string): string {
  const mid = Math.ceil(marker.length / 2);
  return `"${marker.slice(0, mid)}""${marker.slice(mid)}"`;
}

function runTrackedTagCommand(repoId: string, gitTagCommand: string): Promise<boolean> {
  return new Promise((resolve) => {
    const watcherId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const successMarker = "git-juggler: tag created";
    const failureMarker = "git-juggler: tag failed";
    const fullCommand = `${gitTagCommand} && echo ${echoSafe(successMarker)} || echo ${echoSafe(failureMarker)}`;

    let buffer = "";
    let settled = false;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      terminalOutputWatchers.delete(watcherId);
      resolve(success);
    };

    const timeoutHandle = setTimeout(() => finish(false), TAG_COMMAND_TIMEOUT_MS);

    terminalOutputWatchers.set(watcherId, {
      repoId,
      onChunk: (chunk) => {
        buffer += chunk;
        if (buffer.includes(successMarker)) finish(true);
        else if (buffer.includes(failureMarker)) finish(false);
      },
    });

    runInTerminal(repoId, fullCommand);
  });
}

export function createLightweightTagInTerminal(repoId: string, hash: string, name: string): Promise<boolean> {
  return runTrackedTagCommand(repoId, `git tag ${shellQuote(name)} ${hash}`);
}

export function createAnnotatedTagInTerminal(
  repoId: string,
  hash: string,
  name: string,
  message: string,
): Promise<boolean> {
  return runTrackedTagCommand(repoId, `git tag -a ${shellQuote(name)} -m ${shellQuote(message)} ${hash}`);
}

// --- Commit context menu ------------------------------------------------

export interface ContextMenuState {
  x: number;
  y: number;
  hash: string;
}

const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
export { contextMenu };

export function openContextMenu(x: number, y: number, hash: string): void {
  setContextMenu({ x, y, hash });
}

export function closeContextMenu(): void {
  setContextMenu(null);
}

// --- Ref context menus / delete modals -----------------------------------

export interface BranchContextMenuState {
  x: number;
  y: number;
  name: string;
  remote: boolean;
}

export interface DeleteBranchModalState {
  name: string;
  remote: boolean;
}

export interface TagContextMenuState {
  x: number;
  y: number;
  name: string;
}

export interface DeleteTagModalState {
  name: string;
}

const [branchContextMenu, setBranchContextMenu] = createSignal<BranchContextMenuState | null>(null);
const [deleteBranchModal, setDeleteBranchModal] = createSignal<DeleteBranchModalState | null>(null);
const [tagContextMenu, setTagContextMenu] = createSignal<TagContextMenuState | null>(null);
const [deleteTagModal, setDeleteTagModal] = createSignal<DeleteTagModalState | null>(null);
export { branchContextMenu, deleteBranchModal, tagContextMenu, deleteTagModal };

export function openBranchContextMenu(x: number, y: number, name: string, remote: boolean): void {
  setBranchContextMenu({ x, y, name, remote });
}

export function closeBranchContextMenu(): void {
  setBranchContextMenu(null);
}

export function openDeleteBranchModal(target: DeleteBranchModalState): void {
  setDeleteBranchModal(target);
}

export function closeDeleteBranchModal(): void {
  setDeleteBranchModal(null);
}

export function openTagContextMenu(x: number, y: number, name: string): void {
  setTagContextMenu({ x, y, name });
}

export function closeTagContextMenu(): void {
  setTagContextMenu(null);
}

export function openDeleteTagModal(target: DeleteTagModalState): void {
  setDeleteTagModal(target);
}

export function closeDeleteTagModal(): void {
  setDeleteTagModal(null);
}

// --- Repo context menu ---------------------------------------------------

export interface RepoContextMenuState {
  x: number;
  y: number;
  repoId: string;
  repoName: string;
}

const [repoContextMenu, setRepoContextMenu] = createSignal<RepoContextMenuState | null>(null);
export { repoContextMenu };

export function openRepoContextMenu(x: number, y: number, repoId: string, repoName: string): void {
  setRepoContextMenu({ x, y, repoId, repoName });
}

export function closeRepoContextMenu(): void {
  setRepoContextMenu(null);
}

// --- Fetch-in-progress ("ghost commit") state --------------------------
// We have no structured signal for when a terminal command finishes (it's a
// real shell, not a one-shot command runner) — and per this repo's own
// guideline, git actions may only be invoked via the terminal, so we can't
// just ask the backend "is fetch done?" either. So: a repo counts as
// "fetching" from the moment its Fetch command is sent, and stays that way
// while its terminal keeps producing output, plus a short quiet-period
// grace, capped at a hard timeout as a safety net.
const FETCH_OUTPUT_QUIET_MS = 1200;
const FETCH_MAX_DURATION_MS = 30000;
const PUSH_OUTPUT_QUIET_MS = 1200;
const PUSH_MAX_DURATION_MS = 30000;

const [fetchingRepos, setFetchingRepos] = createSignal<Set<string>>(new Set());
const [pushingRepos, setPushingRepos] = createSignal<Set<string>>(new Set());
const [pushingTargetCommits, setPushingTargetCommits] = createSignal<Record<string, string>>({});
export { fetchingRepos, pushingRepos, pushingTargetCommits };

const fetchQuietTimers = new Map<string, ReturnType<typeof setTimeout>>();
const fetchMaxTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pushQuietTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pushMaxTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearFetchTimers(repoId: string): void {
  const quiet = fetchQuietTimers.get(repoId);
  if (quiet) clearTimeout(quiet);
  fetchQuietTimers.delete(repoId);
  const max = fetchMaxTimers.get(repoId);
  if (max) clearTimeout(max);
  fetchMaxTimers.delete(repoId);
}

export function stopFetch(repoId: string): void {
  clearFetchTimers(repoId);
  if (!fetchingRepos().has(repoId)) return;
  const next = new Set(fetchingRepos());
  next.delete(repoId);
  setFetchingRepos(next);
}

export function startFetch(repoId: string): void {
  const next = new Set(fetchingRepos());
  next.add(repoId);
  setFetchingRepos(next);
  clearFetchTimers(repoId);
  fetchMaxTimers.set(
    repoId,
    setTimeout(() => stopFetch(repoId), FETCH_MAX_DURATION_MS),
  );
}

function clearPushTimers(repoId: string): void {
  const quiet = pushQuietTimers.get(repoId);
  if (quiet) clearTimeout(quiet);
  pushQuietTimers.delete(repoId);
  const max = pushMaxTimers.get(repoId);
  if (max) clearTimeout(max);
  pushMaxTimers.delete(repoId);
}

export function stopPush(repoId: string): void {
  clearPushTimers(repoId);
  if (pushingRepos().has(repoId)) {
    const next = new Set(pushingRepos());
    next.delete(repoId);
    setPushingRepos(next);
  }
  if (pushingTargetCommits()[repoId]) {
    const next = { ...pushingTargetCommits() };
    delete next[repoId];
    setPushingTargetCommits(next);
  }
  void refreshRepoGraph(repoId);
}

export function startPush(repoId: string, targetCommit?: string): void {
  const next = new Set(pushingRepos());
  next.add(repoId);
  setPushingRepos(next);
  if (targetCommit) {
    setPushingTargetCommits({ ...pushingTargetCommits(), [repoId]: targetCommit });
  }
  clearPushTimers(repoId);
  pushMaxTimers.set(
    repoId,
    setTimeout(() => stopPush(repoId), PUSH_MAX_DURATION_MS),
  );
}

// Called with every chunk of terminal output; resets quiet-period timers for
// long-running terminal-driven git states such as fetch/push.
export function noteTerminalOutput(repoId: string): void {
  if (fetchingRepos().has(repoId)) {
    const quiet = fetchQuietTimers.get(repoId);
    if (quiet) clearTimeout(quiet);
    fetchQuietTimers.set(
      repoId,
      setTimeout(() => stopFetch(repoId), FETCH_OUTPUT_QUIET_MS),
    );
  }
  if (pushingRepos().has(repoId)) {
    const quiet = pushQuietTimers.get(repoId);
    if (quiet) clearTimeout(quiet);
    pushQuietTimers.set(
      repoId,
      setTimeout(() => stopPush(repoId), PUSH_OUTPUT_QUIET_MS),
    );
  }
}

export function fetchRepo(repoId: string, repoName: string): void {
  openRepoTab(repoId, repoName);
  startFetch(repoId);
  runInTerminal(repoId, "git fetch");
}

// --- Appearance settings --------------------------------------------------

// Theme selection (built-in + VS Code themes) lives in ./themes.

export type BranchColorMode = "hash" | "sequential";

const BRANCH_COLOR_MODE_KEY = "git-juggler:branchColorMode";
const DYNAMIC_BRANCH_COLORS_KEY = "git-juggler:dynamicBranchColors";

function loadBranchColorMode(): BranchColorMode {
  try {
    const mode = localStorage.getItem(BRANCH_COLOR_MODE_KEY);
    if (mode === "hash" || mode === "sequential") return mode;

    // Migrate the old hash-color on/off toggle into the new two-mode setting.
    const legacy = localStorage.getItem(DYNAMIC_BRANCH_COLORS_KEY);
    return legacy === "false" ? "sequential" : "hash";
  } catch {
    return "hash";
  }
}

const [branchColorMode, setBranchColorModeSignal] = createSignal<BranchColorMode>(loadBranchColorMode());
export { branchColorMode };

export function setBranchColorMode(next: BranchColorMode): void {
  setBranchColorModeSignal(next);
  try {
    localStorage.setItem(BRANCH_COLOR_MODE_KEY, next);
  } catch {
    // Not critical — the setting just won't survive a reload.
  }
  savePreference({ branch_color_mode: next });
}

// --- Syncing preferences with the backend ------------------------------------
// The settings above start from localStorage (instant, no flash) and are then
// reconciled with the backend's copy so every browser shows the same setup.

function isStoredLocally(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function isKeyBinding(value: unknown): value is KeyBinding {
  const b = value as KeyBinding | null;
  return !!b && typeof b.key === "string" && b.key.length > 0 && typeof b.mod === "boolean" && typeof b.shift === "boolean" && typeof b.alt === "boolean";
}

/**
 * Applies the backend's values for these settings (they win, so browsers
 * converge) and returns the ones set only in this browser, so the caller can
 * upload them: that's how an existing browser's setup seeds a fresh backend.
 * Applying doesn't write back to the server, so it can't echo.
 */
export function applyRemotePreferences(remote: Preferences): Preferences {
  const seed: Preferences = {};

  if (remote.branch_color_mode) {
    setBranchColorModeSignal(remote.branch_color_mode);
    try {
      localStorage.setItem(BRANCH_COLOR_MODE_KEY, remote.branch_color_mode);
    } catch {
      // Cache only.
    }
  } else if (isStoredLocally(BRANCH_COLOR_MODE_KEY)) {
    seed.branch_color_mode = branchColorMode();
  }

  if (typeof remote.agents_enabled === "boolean") applyAgentsEnabled(remote.agents_enabled);
  else if (isStoredLocally(AGENTS_ENABLED_KEY)) seed.agents_enabled = agentsEnabled();

  if (typeof remote.agent_show_worktrees === "boolean") {
    setAgentShowWorktreesSignal(remote.agent_show_worktrees);
    saveBoolean(AGENT_WORKTREES_KEY, remote.agent_show_worktrees);
  } else if (isStoredLocally(AGENT_WORKTREES_KEY)) {
    seed.agent_show_worktrees = agentShowWorktrees();
  }

  if (typeof remote.agent_poll_seconds === "number") {
    const seconds = clampPollSeconds(remote.agent_poll_seconds);
    setAgentPollSecondsSignal(seconds);
    try {
      localStorage.setItem(AGENT_POLL_SECONDS_KEY, String(seconds));
    } catch {
      // Cache only.
    }
  } else if (isStoredLocally(AGENT_POLL_SECONDS_KEY)) {
    seed.agent_poll_seconds = agentPollSeconds();
  }

  if (remote.key_bindings) {
    const merged = { ...DEFAULT_KEY_BINDINGS };
    for (const action of Object.keys(DEFAULT_KEY_BINDINGS) as KeyBindingAction[]) {
      const candidate = remote.key_bindings[action];
      if (isKeyBinding(candidate)) merged[action] = candidate;
    }
    setKeyBindingsSignal(merged);
    try {
      localStorage.setItem(KEY_BINDINGS_KEY, JSON.stringify(merged));
    } catch {
      // Cache only.
    }
  } else if (isStoredLocally(KEY_BINDINGS_KEY)) {
    seed.key_bindings = keyBindings();
  }

  return seed;
}

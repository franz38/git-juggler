import type { RawVscodeTheme } from "../lib/appTheme";

export interface KeyBindingPreference {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

// UI preferences shared across browsers (stored by the backend). Every field
// is optional: null/undefined means "not set on the server yet".
export interface Preferences {
  theme_id?: string | null;
  pinned_themes?: string[] | null;
  branch_color_mode?: "hash" | "sequential" | null;
  agents_enabled?: boolean | null;
  agent_show_worktrees?: boolean | null;
  agent_poll_seconds?: number | null;
  diff_full_file?: boolean | null;
  key_bindings?: Record<string, KeyBindingPreference> | null;
  onboarding_complete?: boolean | null;
}

export interface ThemesResponse {
  installed: RawVscodeTheme[];
  imported: RawVscodeTheme[];
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  repository_id: string;
  current_branch: string | null;
}

export interface RepoScanProgress {
  found: number;
  scanning: boolean;
}

export type TerminalShell = "posix" | "cmd";

export interface ConfigResponse {
  repo_paths: string[];
  pinned_repo_paths: string[];
  repo_groups: RepoGroupConfig[];
  excluded_paths: string[];
  graph_page_size: number;
  github: GitHubConfig | null;
  jenkins: JenkinsConfig | null;
  terminal_shell: TerminalShell;
}

export interface ConfigUpdateRequest {
  repo_paths?: string[];
  pinned_repo_paths?: string[];
  repo_groups?: RepoGroupConfig[];
  excluded_paths?: string[];
  graph_page_size?: number;
  github?: GitHubConfig | null;
  jenkins?: JenkinsConfig | null;
}

export interface RepoGroupConfig {
  id: string;
  name: string;
  repo_paths: string[];
}

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseDirectoryResponse {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export interface PickFolderResponse {
  path: string | null;
}

export interface GitHubRepoConfig {
  repo_path: string;
  owner: string;
  repo: string;
}

export interface GitHubConfig {
  enabled: boolean;
  auto_detect: boolean;
  api_base_url: string;
  token_env: string;
  repos: GitHubRepoConfig[];
}

export interface JenkinsRuleConfig {
  id: string;
  name: string;
  repo_paths: string[];
  job_url: string;
}

export interface JenkinsConfig {
  enabled: boolean;
  base_url: string;
  username: string;
  api_token_env: string;
  build_limit: number;
  detect_external_pushes: boolean;
  rules: JenkinsRuleConfig[];
}

export interface JenkinsRuleTestRequest {
  config: JenkinsConfig;
  rule: JenkinsRuleConfig;
  repo_path: string;
}

export interface CiConnectionTestResponse {
  ok: boolean;
  message: string;
}

export interface PersonInfo {
  name: string;
  email: string;
}

export interface RefsInfo {
  branches: string[];
  remote_branches: string[];
  tags: string[];
  stashes: string[];
}

export interface CommitSummary {
  hash: string;
  short_hash: string;
  parents: string[];
  author: PersonInfo;
  committer: PersonInfo;
  authored_date: string;
  committed_date: string;
  subject: string;
  branch: string;
  refs: RefsInfo;
}

export interface GraphResponse {
  commits: CommitSummary[];
  branches: string[];
  current_branch: string | null;
  head_commit: string | null;
  upstream_commit: string | null;
  upstream_remote: string | null;
  upstream_branch: string | null;
  is_dirty: boolean;
  uncommitted_files: FileChange[];
  checked_out_branches: string[];
  refs_signature: string;
  /** More (older) commits exist beyond this page; pass `next_cursor` as `before` to fetch them. */
  has_more: boolean;
  next_cursor: string | null;
}

export interface RepoStatusResponse {
  current_branch: string | null;
  head_commit: string | null;
  upstream_commit: string | null;
  upstream_remote: string | null;
  upstream_branch: string | null;
  is_dirty: boolean;
  uncommitted_files: FileChange[];
  refs_signature: string;
}

export interface FileChange {
  path: string;
  status: string;
  old_path?: string | null;
  /** Changed line counts; null when unknown (binary, too large). */
  additions?: number | null;
  deletions?: number | null;
}

export interface FileDiff {
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export interface CommitDetail {
  hash: string;
  short_hash: string;
  parents: string[];
  author: PersonInfo;
  committer: PersonInfo;
  authored_date: string;
  committed_date: string;
  subject: string;
  message: string;
  files: FileChange[];
}

export type CiRunProvider = "github_actions" | "jenkins";

export type CiRunStatus = "success" | "failure" | "running" | "cancelled" | "skipped" | "action_required" | "neutral" | "unstable" | "aborted" | "unknown";

export interface CiRunInfo {
  provider: CiRunProvider;
  status: CiRunStatus;
  name: string;
  number: number;
  url: string;
  branch: string | null;
  event: string | null;
  created_at: string | null;
  updated_at: string | null;
  duration_ms: number | null;
  /** Provider handle for fetching the run's stages (GitHub run id / Jenkins build URL). */
  run_id: string | null;
  /** Commit the run was triggered for (attaches a polled run to its graph row). */
  head_sha: string | null;
  /** Only filled in for active pipelines; otherwise fetched on demand. */
  stages: CiStage[] | null;
  /** Served from git-juggler's run cache: the CI server no longer has it, so `url` is dead. */
  archived?: boolean;
}

export type CiStageStatus = CiRunStatus | "pending";

/** A GitHub job / Jenkins pipeline stage; GitHub jobs carry their steps. */
export interface CiStage {
  name: string;
  status: CiStageStatus;
  started_at: string | null;
  duration_ms: number | null;
  steps: CiStage[] | null;
}

export interface ActivePipeline {
  repo_id: string;
  repo_name: string;
  run: CiRunInfo;
}

export interface AgentActivityEvidence {
  type: "process-cwd" | "git-process" | "child-process" | string;
  pid: number | null;
  cwd: string | null;
  path: string | null;
  executable: string | null;
  command: string | null;
  process_role: "root" | "direct-child" | "descendant" | string | null;
  tool: string | null;
  score: number;
}

export interface AgentWorktreeActivity {
  repository_id: string;
  worktree_path: string;
  branch: string | null;
  commit: string;
  process_ids: number[];
  first_seen: number;
  last_seen: number;
  last_activity: number;
  evidence: AgentActivityEvidence[];
  activity_score: number;
  state: "active" | "idle";
  is_home: boolean;
}

export interface AgentSessionDetails {
  started_at: number | null;
  status_updated_at: number | null;
  version: string | null;
  kind: string | null;
  entrypoint: string | null;
  title: string | null;
  model: string | null;
  permission_mode: string | null;
  agent: string | null;
  last_prompt: string | null;
  worktree_path: string | null;
  worktree_name: string | null;
  worktree_branch: string | null;
}

export interface AgentRepositoryScan {
  agent_pid: number;
  session_directory: string | null;
  worktrees: AgentWorktreeActivity[];
  scanned_at: number;
  state: "active" | "idle";
  provider: string;
  session_id: string | null;
  process_pid: number | null;
  name: string | null;
  details: AgentSessionDetails | null;
  /** Set while the agent is blocked on the user: "permission prompt" or "input needed". */
  waiting_for?: string | null;
  is_subagent: boolean;
  parent_session_id: string | null;
  parent_title: string | null;
  parent_agent: string | null;
  parent_provider: string | null;
}

export interface AgentProcessCandidate {
  pid: number;
  command_line: string;
  matched_pattern: string;
}

export interface AgentActivityResponse {
  agents: AgentProcessCandidate[];
  scans: AgentRepositoryScan[];
  scanned_at: number;
}

export interface AgentHookProviderStatus {
  provider: "claude" | "opencode";
  installed: boolean;
  config_path: string;
  event_path: string;
  snippet: string;
  description: string;
  error: string | null;
}

export interface AgentHooksResponse {
  claude: AgentHookProviderStatus;
  opencode: AgentHookProviderStatus;
}

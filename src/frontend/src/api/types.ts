import type { RawVscodeTheme } from "../lib/appTheme";

export interface ThemesResponse {
  installed: RawVscodeTheme[];
  imported: RawVscodeTheme[];
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  current_branch: string | null;
}

export interface ConfigResponse {
  repo_paths: string[];
  pinned_repo_paths: string[];
  repo_groups: RepoGroupConfig[];
  excluded_paths: string[];
  github: GitHubConfig | null;
}

export interface ConfigUpdateRequest {
  repo_paths?: string[];
  pinned_repo_paths?: string[];
  repo_groups?: RepoGroupConfig[];
  excluded_paths?: string[];
  github?: GitHubConfig | null;
}

export interface RepoGroupConfig {
  id: string;
  name: string;
  repo_paths: string[];
}

export interface GitHubRepoConfig {
  repo_path: string;
  owner: string;
  repo: string;
}

export interface GitHubConfig {
  api_base_url: string;
  token_env: string;
  repos: GitHubRepoConfig[];
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
  is_dirty: boolean;
  uncommitted_files: FileChange[];
  checked_out_branches: string[];
}

export interface RepoStatusResponse {
  current_branch: string | null;
  head_commit: string | null;
  upstream_commit: string | null;
  is_dirty: boolean;
  uncommitted_files: FileChange[];
}

export interface FileChange {
  path: string;
  status: string;
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

export type GitHubActionsRunStatus = "success" | "failure" | "running" | "cancelled" | "skipped" | "action_required" | "neutral" | "unknown";

export interface GitHubActionsRunInfo {
  status: GitHubActionsRunStatus;
  workflow_name: string;
  run_number: number;
  run_id: number;
  url: string;
  branch: string | null;
  event: string | null;
  created_at: string | null;
  updated_at: string | null;
  duration_ms: number | null;
}

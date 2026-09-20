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
  jenkins: JenkinsConfig | null;
}

export interface ConfigUpdateRequest {
  repo_paths?: string[];
  pinned_repo_paths?: string[];
  repo_groups?: RepoGroupConfig[];
  excluded_paths?: string[];
  github?: GitHubConfig | null;
  jenkins?: JenkinsConfig | null;
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
  enabled: boolean;
  auto_detect: boolean;
  api_base_url: string;
  token_env: string;
  repos: GitHubRepoConfig[];
}

export interface JenkinsJobConfig {
  repo_path: string;
  job_url: string;
}

export interface JenkinsConfig {
  enabled: boolean;
  base_url: string;
  username: string;
  api_token_env: string;
  build_limit: number;
  jobs: JenkinsJobConfig[];
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
}

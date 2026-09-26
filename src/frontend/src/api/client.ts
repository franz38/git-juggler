import type { RawVscodeTheme } from "../lib/appTheme";
import type { ActivePipeline, AgentActivityResponse, AgentHookProviderStatus, AgentHooksResponse, BrowseDirectoryResponse, CiConnectionTestResponse, CiRunInfo, CiStage, CommitDetail, ConfigResponse, ConfigUpdateRequest, FileChange, FileDiff, GitHubConfig, GraphResponse, JenkinsConfig, PickFolderResponse, Preferences, RepoScanProgress, RepoStatusResponse, RepoSummary, ThemesResponse } from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(`request failed (${res.status}): ${url}`, res.status);
  }
  return res.json() as Promise<T>;
}

export function fetchRepos(): Promise<RepoSummary[]> {
  return getJson(`${API_BASE}/repos`);
}

export function fetchRepoScanProgress(): Promise<RepoScanProgress> {
  return getJson(`${API_BASE}/repos/scan-progress`);
}

export function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return getJson(`${API_BASE}/browse${query}`);
}

/**
 * Live poll of a repo's pipelines. Without `runRefs`: every active run (used to
 * discover a pipeline that just started; `headSha` narrows it where the
 * provider can filter). With `runRefs` (`<provider>:<run_id>`): only those
 * runs, including their final status once finished.
 */
export function pollCiRuns(repoId: string, runRefs?: string[], headSha?: string): Promise<CiRunInfo[]> {
  const params = new URLSearchParams();
  for (const ref of runRefs ?? []) params.append("run", ref);
  if (headSha) params.set("head_sha", headSha);
  const query = params.toString();
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/ci/poll${query ? `?${query}` : ""}`);
}

/** Opens the OS's native folder dialog on the backend's machine. Rejects with an
 * ApiError (status 501) when no native dialog is available. */
export async function pickFolderNative(): Promise<PickFolderResponse> {
  const res = await fetch(`${API_BASE}/pick-folder`, { method: "POST" });
  if (!res.ok) {
    throw new ApiError(`request failed (${res.status}): pick-folder`, res.status);
  }
  return res.json() as Promise<PickFolderResponse>;
}

/**
 * One page of the commit graph. Without `before` this is the newest page plus
 * the repo-wide state (branches, status, upstream); with `before` (a previous
 * page's `next_cursor`) it is the next, older page of commits only.
 */
export function fetchGraph(repoId: string, before?: string): Promise<GraphResponse> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/graph${query}`);
}

export function fetchRepoStatus(repoId: string): Promise<RepoStatusResponse> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/status`);
}

export function fetchCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}`);
}

export function fetchCommitFileDiff(repoId: string, hash: string, file: FileChange, full = false): Promise<FileDiff> {
  const query = new URLSearchParams({ path: file.path });
  if (file.old_path) query.set("old_path", file.old_path);
  if (full) query.set("full", "true");
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}/diff?${query}`);
}

export function fetchWorkingFileDiff(repoId: string, file: FileChange, full = false): Promise<FileDiff> {
  const query = new URLSearchParams({ path: file.path });
  if (file.old_path) query.set("old_path", file.old_path);
  if (full) query.set("full", "true");
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/diff?${query}`);
}

export function fetchCiRuns(repoId: string): Promise<Record<string, CiRunInfo[]>> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/ci/runs`);
}

export function fetchRunStages(repoId: string, provider: string, runId: string): Promise<CiStage[]> {
  const query = new URLSearchParams({ provider, run_id: runId });
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/ci/stages?${query}`);
}

export function fetchActivePipelines(): Promise<ActivePipeline[]> {
  return getJson(`${API_BASE}/ci/active`);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.detail ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function testGitHubConnection(config: GitHubConfig): Promise<CiConnectionTestResponse> {
  return postJson(`${API_BASE}/ci/github/test`, config);
}

export function testJenkinsConnection(config: JenkinsConfig): Promise<CiConnectionTestResponse> {
  return postJson(`${API_BASE}/ci/jenkins/test`, config);
}

export function fetchAgentActivity(): Promise<AgentActivityResponse> {
  return getJson(`${API_BASE}/agents/activity`);
}

export function fetchAgentHooks(): Promise<AgentHooksResponse> {
  return getJson(`${API_BASE}/agents/hooks`);
}

export async function installAgentHook(provider: "claude" | "opencode"): Promise<AgentHookProviderStatus> {
  const res = await fetch(`${API_BASE}/agents/hooks/${provider}/install`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`request failed (${res.status}): install ${provider} hooks`);
  }
  return res.json() as Promise<AgentHookProviderStatus>;
}

export function fetchConfig(): Promise<ConfigResponse> {
  return getJson(`${API_BASE}/config`);
}

export async function updateConfig(body: ConfigUpdateRequest): Promise<ConfigResponse> {
  const res = await fetch(`${API_BASE}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.detail ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<ConfigResponse>;
}

// Deletes the backend's whole config (repo paths, integrations, themes,
// preferences, ...) back to a first-run state.
export async function resetConfig(): Promise<ConfigResponse> {
  const res = await fetch(`${API_BASE}/config/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json() as Promise<ConfigResponse>;
}

export function fetchPreferences(): Promise<Preferences> {
  return getJson(`${API_BASE}/preferences`);
}

// Partial update: only the fields present in `patch` are changed on the server.
export async function updatePreferences(patch: Preferences): Promise<Preferences> {
  const res = await fetch(`${API_BASE}/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`request failed (${res.status})`);
  }
  return res.json() as Promise<Preferences>;
}

export function fetchThemes(): Promise<ThemesResponse> {
  return getJson(`${API_BASE}/themes`);
}

export async function saveImportedThemes(themes: RawVscodeTheme[]): Promise<ThemesResponse> {
  const res = await fetch(`${API_BASE}/themes/imported`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(themes),
  });
  if (!res.ok) {
    throw new Error(`request failed (${res.status})`);
  }
  return res.json() as Promise<ThemesResponse>;
}

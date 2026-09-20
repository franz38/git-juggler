import type { AgentActivityResponse, AgentRepositoryScan, BrowseDirectoryResponse, CiRunInfo, CommitDetail, ConfigResponse, ConfigUpdateRequest, GraphResponse, RepoStatusResponse, RepoSummary } from "./types";

const API_BASE = "/api";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`request failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

export function fetchRepos(): Promise<RepoSummary[]> {
  return getJson(`${API_BASE}/repos`);
}

export function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return getJson(`${API_BASE}/browse${query}`);
}

export function fetchGraph(repoId: string): Promise<GraphResponse> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/graph`);
}

export function fetchRepoStatus(repoId: string): Promise<RepoStatusResponse> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/status`);
}

export function fetchCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}`);
}

export function fetchCiRuns(repoId: string): Promise<Record<string, CiRunInfo[]>> {
  return getJson(`${API_BASE}/repos/${encodeURIComponent(repoId)}/ci/runs`);
}

export function fetchAgentRepositoryScan(agentPid: number): Promise<AgentRepositoryScan> {
  return getJson(`${API_BASE}/agents/${encodeURIComponent(String(agentPid))}/worktrees`);
}

export function fetchAgentActivity(): Promise<AgentActivityResponse> {
  return getJson(`${API_BASE}/agents/activity`);
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

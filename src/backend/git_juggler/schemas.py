from __future__ import annotations

from pydantic import BaseModel, Field


class RepoSummary(BaseModel):
    id: str
    name: str
    path: str
    repository_id: str
    current_branch: str | None = None


class GitHubRepoConfig(BaseModel):
    repo_path: str
    owner: str
    repo: str


class GitHubConfig(BaseModel):
    enabled: bool = True
    auto_detect: bool = True
    api_base_url: str = "https://api.github.com"
    token_env: str = "GITHUB_TOKEN"
    repos: list[GitHubRepoConfig] = Field(default_factory=list)


class JenkinsJobConfig(BaseModel):
    repo_path: str
    job_url: str


class JenkinsConfig(BaseModel):
    enabled: bool = True
    base_url: str = ""
    username: str = ""
    api_token_env: str = "JENKINS_API_TOKEN"
    build_limit: int = 50
    jobs: list[JenkinsJobConfig] = Field(default_factory=list)


class RepoGroupConfig(BaseModel):
    id: str
    name: str
    repo_paths: list[str] = Field(default_factory=list)


class ConfigResponse(BaseModel):
    repo_paths: list[str]
    pinned_repo_paths: list[str]
    repo_groups: list[RepoGroupConfig] = Field(default_factory=list)
    excluded_paths: list[str] = Field(default_factory=lambda: [".claude"])
    github: GitHubConfig | None = None
    jenkins: JenkinsConfig | None = None


class ConfigUpdateRequest(BaseModel):
    repo_paths: list[str] | None = None
    pinned_repo_paths: list[str] | None = None
    repo_groups: list[RepoGroupConfig] | None = None
    excluded_paths: list[str] | None = None
    github: GitHubConfig | None = None
    jenkins: JenkinsConfig | None = None


class BrowseEntry(BaseModel):
    name: str
    path: str


class BrowseDirectoryResponse(BaseModel):
    path: str
    parent: str | None
    entries: list[BrowseEntry]


class AgentHookProviderStatusResponse(BaseModel):
    provider: str
    installed: bool
    config_path: str
    event_path: str
    snippet: str
    description: str
    error: str | None = None


class AgentHooksResponse(BaseModel):
    claude: AgentHookProviderStatusResponse
    opencode: AgentHookProviderStatusResponse


class PersonInfo(BaseModel):
    name: str
    email: str


class RefsInfo(BaseModel):
    branches: list[str] = []
    remote_branches: list[str] = []
    tags: list[str] = []
    stashes: list[str] = []


class CommitSummary(BaseModel):
    hash: str
    short_hash: str
    parents: list[str]
    author: PersonInfo
    committer: PersonInfo
    authored_date: str
    committed_date: str
    subject: str
    branch: str
    refs: RefsInfo


class FileChange(BaseModel):
    path: str
    status: str


class GraphResponse(BaseModel):
    commits: list[CommitSummary]
    branches: list[str]
    current_branch: str | None = None
    head_commit: str | None = None
    upstream_commit: str | None = None
    is_dirty: bool = False
    uncommitted_files: list[FileChange] = Field(default_factory=list)
    checked_out_branches: list[str] = Field(default_factory=list)


class RepoStatusResponse(BaseModel):
    current_branch: str | None = None
    head_commit: str | None = None
    upstream_commit: str | None = None
    is_dirty: bool = False
    uncommitted_files: list[FileChange] = Field(default_factory=list)


class CommitDetail(BaseModel):
    hash: str
    short_hash: str
    parents: list[str]
    author: PersonInfo
    committer: PersonInfo
    authored_date: str
    committed_date: str
    subject: str
    message: str
    files: list[FileChange]


class CiRunInfo(BaseModel):
    provider: str
    status: str
    name: str
    number: int
    url: str
    branch: str | None = None
    event: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    duration_ms: int | None = None


class AgentActivityEvidence(BaseModel):
    type: str
    pid: int | None = None
    cwd: str | None = None
    path: str | None = None
    executable: str | None = None
    command: str | None = None
    process_role: str | None = None
    tool: str | None = None
    score: int = 0


class AgentWorktreeActivityResponse(BaseModel):
    repository_id: str
    worktree_path: str
    branch: str | None = None
    commit: str
    process_ids: list[int]
    first_seen: int
    last_seen: int
    last_activity: int
    evidence: list[AgentActivityEvidence] = Field(default_factory=list)
    activity_score: int = 0


class AgentRepositoryScanResponse(BaseModel):
    agent_pid: int
    session_directory: str | None = None
    worktrees: list[AgentWorktreeActivityResponse]
    scanned_at: int


class AgentProcessCandidateResponse(BaseModel):
    pid: int
    command_line: str
    matched_pattern: str


class AgentActivityResponse(BaseModel):
    agents: list[AgentProcessCandidateResponse]
    scans: list[AgentRepositoryScanResponse]
    scanned_at: int

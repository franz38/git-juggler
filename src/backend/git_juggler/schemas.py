from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class KeyBindingPreference(BaseModel):
    key: str = Field(min_length=1, max_length=32)
    mod: bool = False
    shift: bool = False
    alt: bool = False


class Preferences(BaseModel):
    """UI preferences shared by every browser talking to this backend.

    Every field is optional: ``None`` means "not set on the server", and the
    frontend falls back to its own default. Used as the PUT body too, where only
    the fields actually sent are applied (an explicit ``null`` clears one).
    """

    theme_id: str | None = Field(default=None, max_length=512)
    pinned_themes: list[str] | None = Field(default=None, max_length=500)
    branch_color_mode: Literal["hash", "sequential"] | None = None
    agents_enabled: bool | None = None
    agent_show_worktrees: bool | None = None
    agent_poll_seconds: int | None = Field(default=None, ge=1, le=3600)
    diff_full_file: bool | None = None
    key_bindings: dict[str, KeyBindingPreference] | None = Field(default=None, max_length=32)
    onboarding_complete: bool | None = None


class VscodeTheme(BaseModel):
    """A VS Code color theme with its ``include`` chain already merged."""

    id: str
    label: str
    uiTheme: str = "vs-dark"  # vs | vs-dark | hc-black | hc-light
    colors: dict[str, str] = Field(default_factory=dict)


class ThemesResponse(BaseModel):
    installed: list[VscodeTheme]
    imported: list[VscodeTheme]


class RepoSummary(BaseModel):
    id: str
    name: str
    path: str
    repository_id: str
    current_branch: str | None = None


class RepoScanProgress(BaseModel):
    found: int
    scanning: bool


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
    # The shell run_terminal_session actually spawns (see terminal.py) --
    # server-derived from sys.platform, not user-configurable. The frontend
    # needs this to know how to quote arguments for commands it sends through
    # the terminal (POSIX single-quoting is meaningless to cmd.exe).
    terminal_shell: Literal["posix", "cmd"] = "posix"


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


class PickFolderResponse(BaseModel):
    path: str | None  # None when the user cancelled the dialog


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
    old_path: str | None = None


class FileDiff(BaseModel):
    patch: str
    binary: bool = False
    truncated: bool = False


class GraphResponse(BaseModel):
    commits: list[CommitSummary]
    branches: list[str]
    current_branch: str | None = None
    head_commit: str | None = None
    upstream_commit: str | None = None
    upstream_remote: str | None = None
    upstream_branch: str | None = None
    is_dirty: bool = False
    uncommitted_files: list[FileChange] = Field(default_factory=list)
    checked_out_branches: list[str] = Field(default_factory=list)
    refs_signature: str = ""
    # Paging: commits are the newest page (oldest-first within it); when
    # has_more, pass next_cursor as `before` to fetch the next, older page.
    # Only the first page (no `before`) carries the repo-wide fields above.
    has_more: bool = False
    next_cursor: str | None = None


class RepoStatusResponse(BaseModel):
    current_branch: str | None = None
    head_commit: str | None = None
    upstream_commit: str | None = None
    upstream_remote: str | None = None
    upstream_branch: str | None = None
    is_dirty: bool = False
    uncommitted_files: list[FileChange] = Field(default_factory=list)
    refs_signature: str = ""


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


class CiStage(BaseModel):
    name: str
    status: str
    started_at: str | None = None
    duration_ms: int | None = None
    steps: list["CiStage"] | None = None


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
    # Provider-specific handle used to fetch the run's stages later: the
    # workflow run id for GitHub Actions, the build URL for Jenkins.
    run_id: str | None = None
    stages: list[CiStage] | None = None


class ActivePipeline(BaseModel):
    repo_id: str
    repo_name: str
    run: CiRunInfo


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
    state: str = "active"
    is_home: bool = False


class AgentSessionDetails(BaseModel):
    started_at: int | None = None
    status_updated_at: int | None = None
    version: str | None = None
    kind: str | None = None
    entrypoint: str | None = None
    title: str | None = None
    model: str | None = None
    permission_mode: str | None = None
    agent: str | None = None
    last_prompt: str | None = None
    worktree_path: str | None = None
    worktree_name: str | None = None
    worktree_branch: str | None = None


class AgentRepositoryScanResponse(BaseModel):
    agent_pid: int
    session_directory: str | None = None
    worktrees: list[AgentWorktreeActivityResponse]
    scanned_at: int
    state: str = "active"
    provider: str = ""
    session_id: str | None = None
    process_pid: int | None = None
    name: str | None = None
    details: AgentSessionDetails | None = None


class AgentProcessCandidateResponse(BaseModel):
    pid: int
    command_line: str
    matched_pattern: str


class AgentActivityResponse(BaseModel):
    agents: list[AgentProcessCandidateResponse]
    scans: list[AgentRepositoryScanResponse]
    scanned_at: int

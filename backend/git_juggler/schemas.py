from __future__ import annotations

from pydantic import BaseModel, Field


class RepoSummary(BaseModel):
    id: str
    name: str
    path: str
    current_branch: str | None = None


class GitHubRepoConfig(BaseModel):
    repo_path: str
    owner: str
    repo: str


class GitHubConfig(BaseModel):
    api_base_url: str = "https://api.github.com"
    token_env: str = "GITHUB_TOKEN"
    repos: list[GitHubRepoConfig] = Field(default_factory=list)


class ConfigResponse(BaseModel):
    repo_paths: list[str]
    pinned_repo_paths: list[str]
    github: GitHubConfig | None = None


class ConfigUpdateRequest(BaseModel):
    repo_paths: list[str] | None = None
    pinned_repo_paths: list[str] | None = None
    github: GitHubConfig | None = None


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


class GitHubActionsRunInfo(BaseModel):
    status: str
    workflow_name: str
    run_number: int
    run_id: int
    url: str
    branch: str | None = None
    event: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    duration_ms: int | None = None

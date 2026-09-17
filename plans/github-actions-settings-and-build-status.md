# GitHub Actions Settings And Build Status Plan

## Goal

Add GitHub Actions integration to git-juggler so the app can show, for each commit that triggered one or more GitHub Actions workflows, a status icon and hover details for the run.

The first implementation step is to add GitHub Actions settings to the existing app menu and persist them through the existing `~/.config/git-juggler/config.json` flow.

## Feasibility

This is doable and should be more predictable than Jenkins in many cases because GitHub exposes workflow runs by commit SHA.

The app already has the right attachment points:

- Backend graph generation returns a `CommitSummary` for each commit.
- Frontend renders each commit through `CommitRow`.
- The app menu already reads and writes config through `/api/config`.
- GitHub Actions access is read-only and does not conflict with the project rule that Git mutations must go through the terminal.

Recommended primary GitHub API source:

```http
GET /repos/{owner}/{repo}/actions/runs?per_page=100
```

The backend can group returned workflow runs by `head_sha` and match them against local commit hashes.

Alternative API options:

- `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}`
- `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`
- `GET /repos/{owner}/{repo}/commits/{ref}/status`

The latest workflow-runs list is the recommended first implementation because it avoids one API request per commit.

## Security Choice

Do not store the GitHub token in `~/.config/git-juggler/config.json`.

Store only the environment variable name that contains the token, for example `GITHUB_TOKEN`.

The backend will read the actual token from the process environment. The resolved token must never be sent back to the frontend.

The GitHub Actions menu should clearly tell the user that the env var must be set before starting the backend.

Example menu copy:

```text
GitHub token is not stored by git-juggler.
Set the environment variable below before starting the backend:
GITHUB_TOKEN=<your GitHub token>
```

For public repositories, an unauthenticated request may work, but authenticated requests have much better rate limits.

For private repositories, the token must have read access to Actions data for the configured repository.

For fine-grained GitHub tokens, recommended permissions are:

- Actions: read-only.
- Metadata: read-only.

## Config Shape

Persist GitHub Actions settings inside the existing config file:

```json
{
  "repo_paths": ["/Users/matteofranzino/Documents/2026"],
  "pinned_repo_paths": [],
  "github": {
    "api_base_url": "https://api.github.com",
    "token_env": "GITHUB_TOKEN",
    "repos": [
      {
        "repo_path": "/Users/matteofranzino/Documents/2026/my-repo",
        "owner": "my-org",
        "repo": "my-repo"
      }
    ]
  }
}
```

Fields:

- `api_base_url`: GitHub API URL, default `https://api.github.com`. This also supports GitHub Enterprise API URLs later.
- `token_env`: env var containing the GitHub token, default `GITHUB_TOKEN`.
- `repos`: manual local-repo-to-GitHub-repo mappings.

Optional later fields:

- `run_limit`: max recent workflow runs to inspect.
- `workflow_names`: allowlist of workflow names to display.
- `include_check_runs`: whether to also query check runs.

## Phase 1: GitHub Actions Settings In App Menu

### Backend Schema

Update `backend/git_juggler/schemas.py`:

```py
class GitHubRepoConfig(BaseModel):
    repo_path: str
    owner: str
    repo: str


class GitHubConfig(BaseModel):
    api_base_url: str = "https://api.github.com"
    token_env: str = "GITHUB_TOKEN"
    repos: list[GitHubRepoConfig] = []
```

Extend existing config models:

```py
class ConfigResponse(BaseModel):
    repo_paths: list[str]
    pinned_repo_paths: list[str]
    github: GitHubConfig | None = None


class ConfigUpdateRequest(BaseModel):
    repo_paths: list[str] | None = None
    pinned_repo_paths: list[str] | None = None
    github: GitHubConfig | None = None
```

If Jenkins support is implemented first, both integrations should be present together:

```py
class ConfigResponse(BaseModel):
    repo_paths: list[str]
    pinned_repo_paths: list[str]
    jenkins: JenkinsConfig | None = None
    github: GitHubConfig | None = None
```

### Backend Config Helpers

Update `backend/git_juggler/config.py`:

```py
def load_github_config() -> dict | None:
    raw = _load_raw().get("github")
    return raw if isinstance(raw, dict) else None


def save_github_config(github: dict | None) -> None:
    data = _load_raw()
    if github is None:
        data.pop("github", None)
    else:
        data["github"] = github
    _save_raw(data)
```

### Backend Config Route

Update `backend/git_juggler/app.py`:

- Include `github=config.load_github_config()` in `_current_config()`.
- In `api_update_config`, save `body.github` when it is provided.
- Preserve existing `repo_paths`, `pinned_repo_paths`, and Jenkins behavior if Jenkins exists.

### Frontend Types

Update `frontend/src/api/types.ts`:

```ts
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
```

Then extend:

```ts
export interface ConfigResponse {
  repo_paths: string[];
  pinned_repo_paths: string[];
  github: GitHubConfig | null;
}

export interface ConfigUpdateRequest {
  repo_paths?: string[];
  pinned_repo_paths?: string[];
  github?: GitHubConfig | null;
}
```

If Jenkins support is implemented first, keep both fields in these types.

### Frontend Store

Update `frontend/src/state/store.ts`:

- Add a default GitHub config.
- Add `githubConfig` signal.
- Load GitHub config in `loadConfig()`.
- Add `saveGitHubConfig(next: GitHubConfig)` that calls `updateConfig({ github: next })`.

Suggested default:

```ts
const defaultGitHubConfig: GitHubConfig = {
  api_base_url: "https://api.github.com",
  token_env: "GITHUB_TOKEN",
  repos: [],
};
```

### App Menu UI

Update `frontend/src/components/Menu/MainMenu.tsx`:

- Change section type from `"repos" | "appearance"` to `"repos" | "github" | "appearance"`.
- If Jenkins exists too, use `"repos" | "jenkins" | "github" | "appearance"`.
- Add a `GitHub Actions` sidebar item.
- Add a GitHub Actions section with fields for:
  - GitHub API base URL.
  - Token env var name.
  - Repo path, owner, and repo mappings.
- Add add/remove controls for repo mappings.
- Add a save button.
- Show the env-var warning/help text prominently.

Recommended first UI is intentionally manual and simple. Auto-detecting owner/repo from `origin` remote can come later.

## Phase 2: GitHub Actions Status API

Add `backend/git_juggler/github_actions.py`.

Responsibilities:

- Load GitHub Actions settings.
- Resolve token from `os.environ[token_env]`.
- Match the local repo path to a configured GitHub owner/repo.
- Gracefully return no data if GitHub is not configured, the repo is not mapped, or the token is missing for a private repo.
- Query GitHub Actions workflow runs.
- Group runs by `head_sha`.
- Normalize GitHub status/conclusion into frontend-friendly values.
- Avoid sending the resolved token to the frontend.

Recommended GitHub API call:

```http
GET /repos/{owner}/{repo}/actions/runs?per_page=100
```

Optional request headers:

```text
Accept: application/vnd.github+json
Authorization: Bearer <token>
X-GitHub-Api-Version: 2022-11-28
```

The `Authorization` header should be omitted if no token is configured or the env var is unset. This lets public repos work when possible.

Status mapping:

- `status` in `queued`, `in_progress`, `requested`, `waiting`, `pending` -> `running`
- `conclusion=success` -> `success`
- `conclusion=failure` -> `failure`
- `conclusion=timed_out` -> `failure`
- `conclusion=cancelled` -> `cancelled`
- `conclusion=skipped` -> `skipped`
- `conclusion=action_required` -> `action_required`
- `conclusion=neutral` -> `neutral`
- missing/unknown -> `unknown`

Add endpoint:

```http
GET /api/repos/{repo_id}/github/actions
```

Response shape:

```json
{
  "a1b2c3...": [
    {
      "status": "success",
      "workflow_name": "CI",
      "run_number": 42,
      "run_id": 123456789,
      "url": "https://github.com/my-org/my-repo/actions/runs/123456789",
      "branch": "main",
      "event": "push",
      "created_at": "2026-09-17T10:20:00Z",
      "updated_at": "2026-09-17T10:23:00Z",
      "duration_ms": 180000
    }
  ]
}
```

This should be separate from `/graph` so GitHub API latency, errors, and rate limits never block commit graph rendering.

## Phase 3: Frontend GitHub Actions State

Add frontend types:

```ts
export type GitHubActionsRunStatus =
  | "success"
  | "failure"
  | "running"
  | "cancelled"
  | "skipped"
  | "action_required"
  | "neutral"
  | "unknown";

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
```

Add API client:

```ts
export function fetchGitHubActionsRuns(repoId: string): Promise<Record<string, GitHubActionsRunInfo[]>>;
```

Extend repo state with:

```ts
githubActionsRuns: Record<string, GitHubActionsRunInfo[]>;
githubActionsLoading: boolean;
githubActionsError: string | null;
```

After graph load succeeds, fetch GitHub Actions runs in the background. If GitHub fails, keep the graph usable and do not show a global error banner.

## Phase 4: Commit Badge And Tooltip

Add `frontend/src/components/Badges/GitHubActionsBadge.tsx`.

Recommended UI:

- Green check for success.
- Red x for failure.
- Blue spinner/dot for running.
- Orange warning for action required.
- Gray dot for cancelled, skipped, neutral, or unknown.

Render the badge in `CommitRow`, inside `.commit-refs`, after branch/tag/stash badges.

Hover tooltip should show:

- Workflow name.
- Run number.
- Status/conclusion.
- Branch.
- Event.
- Created/updated time.
- Duration.
- GitHub Actions run URL.

Clicking the badge can open the GitHub Actions run URL in a new tab.

If multiple runs map to the same commit, show the worst/latest status as the icon and list all runs in the tooltip.

Suggested priority for multiple runs:

1. `failure`
2. `action_required`
3. `running`
4. `cancelled`
5. `unknown`
6. `neutral`
7. `skipped`
8. `success`

## Phase 5: Performance And Rate Limits

Avoid one GitHub API call per commit for normal graph loads.

Recommended first approach:

- Query the latest 100 workflow runs for the mapped GitHub repo.
- Group by `head_sha`.
- Return only entries whose SHA is present in the local graph.

Possible later improvements:

- In-memory backend cache per owner/repo for a short TTL.
- Manual refresh button.
- Respect GitHub rate-limit response headers.
- Add `run_limit` setting.
- Query by `head_sha` only for selected/visible commits when needed.

## Testing

Testing rules:

- Do not test mutating Git actions on real user repos.
- GitHub integration is read-only, but tokens and real private repo metadata should still be treated carefully.
- Prefer testing against a disposable GitHub repo or a public repo.
- Avoid real private projects unless the user explicitly configures them.

Suggested verification:

- Backend check that `/api/config` returns GitHub settings without a token.
- Backend check that `PUT /api/config` persists GitHub settings.
- Missing token env var does not crash backend.
- Public repo can return workflow runs without a token if rate limits allow it.
- Private repo with token returns workflow runs.
- Frontend build with `npm run build`.
- Manual menu test:
  - Open app menu.
  - Select GitHub Actions.
  - Edit env var field.
  - Confirm help text updates.
  - Add a repo mapping.
  - Save.
  - Confirm config file contains `token_env`, not token value.
- Commit rows show icons only when matching workflow runs exist.
- Graph still loads when GitHub API fails or rate limits.

## Notes

Do not add a backend route that performs Git mutations. GitHub API reads are acceptable because they do not mutate repositories.

Avoid hardcoding GitHub tokens, URLs, owners, or repo names in code.

Keep GitHub Actions loading separate from the commit graph request so the core graph remains fast and reliable.

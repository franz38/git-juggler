# Jenkins Settings And Build Status Plan

## Goal

Add Jenkins integration to git-juggler so the app can show, for each commit that triggered a Jenkins pipeline, a build outcome icon and hover details for the run.

The first implementation step is to add Jenkins settings to the existing app menu and persist them through the existing `~/.config/git-juggler/config.json` flow.

## Feasibility

This is doable.

The app already has the right attachment points:

- Backend graph generation returns a `CommitSummary` for each commit.
- Frontend renders each commit through `CommitRow`.
- The app menu already reads and writes config through `/api/config`.
- Jenkins access is read-only and does not conflict with the project rule that Git mutations must go through the terminal.

The main uncertainty is commit-to-build matching because Jenkins setups vary. Reliable matching usually comes from Jenkins Git plugin build data, `changeSet` entries, or a pipeline-provided `GIT_COMMIT` value.

## Security Choice

Do not store the Jenkins API token in `~/.config/git-juggler/config.json`.

Store only the environment variable name that contains the token, for example `JENKINS_API_TOKEN`.

The backend will read the actual token from the process environment. The resolved token must never be sent back to the frontend.

The Jenkins menu should clearly tell the user that the env var must be set before starting the backend.

Example menu copy:

```text
Jenkins API token is not stored by git-juggler.
Set the environment variable below before starting the backend:
JENKINS_API_TOKEN=<your Jenkins API token>
```

If the user changes the env var setting, the help text should reflect the configured name.

## Config Shape

Persist Jenkins settings inside the existing config file:

```json
{
  "repo_paths": ["/Users/matteofranzino/Documents/2026"],
  "pinned_repo_paths": [],
  "jenkins": {
    "base_url": "https://jenkins.example.com",
    "username": "matteo",
    "api_token_env": "JENKINS_API_TOKEN",
    "build_limit": 50,
    "jobs": [
      {
        "repo_path": "/Users/matteofranzino/Documents/2026/my-repo",
        "job_url": "https://jenkins.example.com/job/my-pipeline/job/main"
      }
    ]
  }
}
```

Fields:

- `base_url`: Jenkins instance base URL.
- `username`: Jenkins username.
- `api_token_env`: env var containing the Jenkins API token, default `JENKINS_API_TOKEN`.
- `build_limit`: max recent builds to inspect per configured job.
- `jobs`: manual repo-to-job mappings.

## Phase 1: Jenkins Settings In App Menu

### Backend Schema

Update `backend/git_juggler/schemas.py`:

```py
class JenkinsJobConfig(BaseModel):
    repo_path: str
    job_url: str


class JenkinsConfig(BaseModel):
    base_url: str = ""
    username: str = ""
    api_token_env: str = "JENKINS_API_TOKEN"
    build_limit: int = 50
    jobs: list[JenkinsJobConfig] = []
```

Extend existing config models:

```py
class ConfigResponse(BaseModel):
    repo_paths: list[str]
    pinned_repo_paths: list[str]
    jenkins: JenkinsConfig | None = None


class ConfigUpdateRequest(BaseModel):
    repo_paths: list[str] | None = None
    pinned_repo_paths: list[str] | None = None
    jenkins: JenkinsConfig | None = None
```

### Backend Config Helpers

Update `backend/git_juggler/config.py`:

```py
def load_jenkins_config() -> dict | None:
    raw = _load_raw().get("jenkins")
    return raw if isinstance(raw, dict) else None


def save_jenkins_config(jenkins: dict | None) -> None:
    data = _load_raw()
    if jenkins is None:
        data.pop("jenkins", None)
    else:
        data["jenkins"] = jenkins
    _save_raw(data)
```

### Backend Config Route

Update `backend/git_juggler/app.py`:

- Include `jenkins=config.load_jenkins_config()` in `_current_config()`.
- In `api_update_config`, save `body.jenkins` when it is provided.
- Preserve existing `repo_paths` and `pinned_repo_paths` behavior.

### Frontend Types

Update `frontend/src/api/types.ts`:

```ts
export interface JenkinsJobConfig {
  repo_path: string;
  job_url: string;
}

export interface JenkinsConfig {
  base_url: string;
  username: string;
  api_token_env: string;
  build_limit: number;
  jobs: JenkinsJobConfig[];
}
```

Then extend:

```ts
export interface ConfigResponse {
  repo_paths: string[];
  pinned_repo_paths: string[];
  jenkins: JenkinsConfig | null;
}

export interface ConfigUpdateRequest {
  repo_paths?: string[];
  pinned_repo_paths?: string[];
  jenkins?: JenkinsConfig | null;
}
```

### Frontend Store

Update `frontend/src/state/store.ts`:

- Add a default Jenkins config.
- Add `jenkinsConfig` signal.
- Load Jenkins config in `loadConfig()`.
- Add `saveJenkinsConfig(next: JenkinsConfig)` that calls `updateConfig({ jenkins: next })`.

Suggested default:

```ts
const defaultJenkinsConfig: JenkinsConfig = {
  base_url: "",
  username: "",
  api_token_env: "JENKINS_API_TOKEN",
  build_limit: 50,
  jobs: [],
};
```

### App Menu UI

Update `frontend/src/components/Menu/MainMenu.tsx`:

- Change section type from `"repos" | "appearance"` to `"repos" | "jenkins" | "appearance"`.
- Add a `Jenkins` sidebar item.
- Add a Jenkins section with fields for:
  - Jenkins base URL.
  - Username.
  - API token env var name.
  - Build limit.
  - Repo path and Jenkins job URL mappings.
- Add add/remove controls for job mappings.
- Add a save button.
- Show the env-var warning/help text prominently.

Recommended first UI is intentionally manual and simple. Auto-discovery of Jenkins jobs can come later.

## Phase 2: Jenkins Build Status API

Add `backend/git_juggler/jenkins.py`.

Responsibilities:

- Load Jenkins settings.
- Resolve token from `os.environ[api_token_env]`.
- Gracefully return no data if Jenkins is not configured or the env var is missing.
- Query configured job URLs using Jenkins Remote API.
- Inspect recent builds up to `build_limit`.
- Extract commit SHA from Jenkins data.
- Normalize Jenkins status.

Potential Jenkins sources for commit SHA:

- `actions[].lastBuiltRevision.SHA1` from Jenkins Git plugin.
- `changeSet.items[].commitId`.
- Build parameters like `GIT_COMMIT`, if available.

Status mapping:

- `building: true` -> `running`
- `SUCCESS` -> `success`
- `FAILURE` -> `failure`
- `UNSTABLE` -> `unstable`
- `ABORTED` -> `aborted`
- missing/unknown -> `unknown`

Add endpoint:

```http
GET /api/repos/{repo_id}/jenkins/builds
```

Response shape:

```json
{
  "a1b2c3...": [
    {
      "status": "success",
      "job_name": "my-pipeline/main",
      "build_number": 123,
      "url": "https://jenkins.example.com/job/my-pipeline/job/main/123/",
      "timestamp": "2026-09-17T10:20:00Z",
      "duration_ms": 82000,
      "branch": "main"
    }
  ]
}
```

This should be separate from `/graph` so Jenkins latency or failures never block commit graph rendering.

## Phase 3: Frontend Build Status State

Add frontend types:

```ts
export type JenkinsBuildStatus = "success" | "failure" | "unstable" | "aborted" | "running" | "unknown";

export interface JenkinsBuildInfo {
  status: JenkinsBuildStatus;
  job_name: string;
  build_number: number;
  url: string;
  timestamp: string | null;
  duration_ms: number | null;
  branch: string | null;
}
```

Add API client:

```ts
export function fetchJenkinsBuilds(repoId: string): Promise<Record<string, JenkinsBuildInfo[]>>;
```

Extend repo state with:

```ts
jenkinsBuilds: Record<string, JenkinsBuildInfo[]>;
jenkinsLoading: boolean;
jenkinsError: string | null;
```

After graph load succeeds, fetch Jenkins builds in the background. If Jenkins fails, keep the graph usable and do not show a global error banner.

## Phase 4: Commit Badge And Tooltip

Add `frontend/src/components/Badges/JenkinsBuildBadge.tsx`.

Recommended UI:

- Green check for success.
- Red x for failure.
- Yellow warning for unstable.
- Blue spinner/dot for running.
- Gray slash/dot for aborted or unknown.

Render the badge in `CommitRow`, inside `.commit-refs`, after branch/tag/stash badges.

Hover tooltip should show:

- Job name.
- Build number.
- Status.
- Timestamp.
- Duration.
- Jenkins URL.

Clicking the badge can open the Jenkins run URL in a new tab.

If multiple builds map to the same commit, show the worst/latest status as the icon and list all runs in the tooltip.

## Testing

Testing rules:

- Do not test mutating Git actions on real user repos.
- For Git-related UI checks, use `~/Documents/2026/demo-repo` or a scratch repo.
- Jenkins integration is read-only, but credentials and real job URLs should still be treated carefully.

Suggested verification:

- Backend unit/manual check that `/api/config` returns Jenkins settings without a token.
- Backend check that `PUT /api/config` persists Jenkins settings.
- Frontend build with `npm run build`.
- Manual menu test:
  - Open app menu.
  - Select Jenkins.
  - Edit env var field.
  - Confirm help text updates.
  - Save.
  - Confirm config file contains `api_token_env`, not token value.
- Later Jenkins status test against a safe Jenkins job or mocked local response.

## Notes

Do not add a backend route that performs Git mutations. Jenkins API reads are acceptable because they do not mutate repositories.

Avoid hardcoding Jenkins credentials, URLs, or job names in code.

import { Index, Show, createEffect, createSignal } from "solid-js";
import type { GitHubConfig } from "../../api/types";
import { TextField } from "../inputs/TextField";
import { ToggleField } from "../inputs/ToggleField";
import { githubConfig, githubConfigError, saveGitHubConfig } from "../../state/store";

const emptyGitHubConfig: GitHubConfig = {
  enabled: true,
  auto_detect: true,
  api_base_url: "https://api.github.com",
  token_env: "GITHUB_TOKEN",
  repos: [],
};

// The "GitHub Actions" settings: enable/detect toggles plus per-repo owner
// overrides. Keeps its own draft (synced from the saved config) so edits
// aren't committed until "Save GitHub settings" is clicked.
export function GitHubSettings() {
  const [draft, setDraft] = createSignal<GitHubConfig>(emptyGitHubConfig);

  createEffect(() => {
    const config = githubConfig();
    setDraft({ ...config, repos: config.repos.map((repo) => ({ ...repo })) });
  });

  const update = <K extends keyof GitHubConfig>(key: K, value: GitHubConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateRepo = (index: number, key: "repo_path" | "owner" | "repo", value: string) => {
    setDraft((current) => ({
      ...current,
      repos: current.repos.map((repo, i) => (i === index ? { ...repo, [key]: value } : repo)),
    }));
  };

  const addRepo = () => {
    setDraft((current) => ({
      ...current,
      repos: [...current.repos, { repo_path: "", owner: "", repo: "" }],
    }));
  };

  const removeRepo = (index: number) => {
    setDraft((current) => ({
      ...current,
      repos: current.repos.filter((_, i) => i !== index),
    }));
  };

  const handleSave = () => {
    void saveGitHubConfig({
      ...draft(),
      api_base_url: draft().api_base_url.trim() || "https://api.github.com",
      token_env: draft().token_env.trim() || "GITHUB_TOKEN",
      repos: draft().repos
        .map((repo) => ({ repo_path: repo.repo_path.trim(), owner: repo.owner.trim(), repo: repo.repo.trim() }))
        .filter((repo) => repo.repo_path && repo.owner && repo.repo),
    });
  };

  return (
    <>
      <p class="menu-hint">Workflow status is detected from each repo's origin remote by default.</p>

      <div class="menu-notice">
        GitHub token is not stored by git-juggler. Set <span class="mono">{draft().token_env || "GITHUB_TOKEN"}</span> before starting the backend.
      </div>

      <ToggleField
        label="Enable GitHub Actions integration"
        description="When disabled, workflow status is not requested or shown."
        checked={draft().enabled}
        onChange={(checked) => update("enabled", checked)}
      />

      <TextField label="API base URL" value={draft().api_base_url} onChange={(value) => update("api_base_url", value)} />

      <TextField label="Token env var" value={draft().token_env} onChange={(value) => update("token_env", value)} />

      <ToggleField
        label="Automatic GitHub Actions detection"
        description="Infer owner and repo from each local repo's origin remote."
        checked={draft().auto_detect}
        onChange={(checked) => update("auto_detect", checked)}
      />

      <div class="menu-field">
      <span>Advanced repo overrides</span>
      <p class="menu-hint">Only add mappings when origin cannot be used or should map to a different GitHub repo.</p>
      <div class="github-repo-mappings">
        <Show when={draft().repos.length > 0} fallback={<div class="menu-empty">No overrides configured</div>}>
          <Index each={draft().repos}>
            {(repo, index) => (
            <div class="github-repo-row">
              <input
                type="text"
                placeholder="/absolute/path/to/repo"
                value={repo().repo_path}
                onInput={(e) => updateRepo(index, "repo_path", e.currentTarget.value)}
              />
              <input
                type="text"
                placeholder="owner"
                value={repo().owner}
                onInput={(e) => updateRepo(index, "owner", e.currentTarget.value)}
              />
              <input
                type="text"
                placeholder="repo"
                value={repo().repo}
                onInput={(e) => updateRepo(index, "repo", e.currentTarget.value)}
              />
              <button type="button" class="menu-secondary-button" onClick={() => removeRepo(index)}>
                Remove
              </button>
            </div>
            )}
          </Index>
        </Show>
      </div>
      </div>

      <div class="menu-actions">
        <button type="button" class="menu-secondary-button" onClick={addRepo}>
          Add override
        </button>
        <button type="button" class="menu-primary-button" onClick={handleSave}>
          Save GitHub settings
        </button>
      </div>

      <Show when={githubConfigError()}>
        <div class="menu-error">{githubConfigError()}</div>
      </Show>
    </>
  );
}

import { For, Index, Show, createEffect, createSignal } from "solid-js";
import type { GitHubConfig } from "../../api/types";
import {
  addRepoPath,
  branchColorMode,
  closeMenu,
  githubConfig,
  githubConfigError,
  menuOpen,
  removeRepoPath,
  repoPaths,
  repoPathsError,
  saveGitHubConfig,
  setBranchColorMode,
  setTheme,
  theme,
} from "../../state/store";
import type { BranchColorMode, Theme } from "../../state/store";

type Section = "repos" | "github" | "appearance";

const emptyGitHubConfig: GitHubConfig = {
  api_base_url: "https://api.github.com",
  token_env: "GITHUB_TOKEN",
  repos: [],
};

export function MainMenu() {
  const [activeSection, setActiveSection] = createSignal<Section>("repos");
  const [newPath, setNewPath] = createSignal("");
  const [githubDraft, setGitHubDraft] = createSignal<GitHubConfig>(emptyGitHubConfig);

  createEffect(() => {
    const config = githubConfig();
    setGitHubDraft({ ...config, repos: config.repos.map((repo) => ({ ...repo })) });
  });

  const handleAdd = () => {
    const path = newPath().trim();
    if (!path) return;
    void addRepoPath(path);
    setNewPath("");
  };

  const updateGitHubDraft = <K extends keyof GitHubConfig>(key: K, value: GitHubConfig[K]) => {
    setGitHubDraft((current) => ({ ...current, [key]: value }));
  };

  const updateGitHubRepo = (index: number, key: "repo_path" | "owner" | "repo", value: string) => {
    setGitHubDraft((current) => ({
      ...current,
      repos: current.repos.map((repo, i) => (i === index ? { ...repo, [key]: value } : repo)),
    }));
  };

  const addGitHubRepo = () => {
    setGitHubDraft((current) => ({
      ...current,
      repos: [...current.repos, { repo_path: "", owner: "", repo: "" }],
    }));
  };

  const removeGitHubRepo = (index: number) => {
    setGitHubDraft((current) => ({
      ...current,
      repos: current.repos.filter((_, i) => i !== index),
    }));
  };

  const handleSaveGitHub = () => {
    void saveGitHubConfig({
      ...githubDraft(),
      api_base_url: githubDraft().api_base_url.trim() || "https://api.github.com",
      token_env: githubDraft().token_env.trim() || "GITHUB_TOKEN",
      repos: githubDraft().repos
        .map((repo) => ({ repo_path: repo.repo_path.trim(), owner: repo.owner.trim(), repo: repo.repo.trim() }))
        .filter((repo) => repo.repo_path && repo.owner && repo.repo),
    });
  };

  return (
    <Show when={menuOpen()}>
      <div class="menu-overlay" onClick={closeMenu}>
        <div class="menu-dialog" onClick={(e) => e.stopPropagation()}>
          <div class="menu-sidebar">
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "repos" }}
              onClick={() => setActiveSection("repos")}
            >
              Repos
            </div>
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "appearance" }}
              onClick={() => setActiveSection("appearance")}
            >
              Appearance
            </div>
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "github" }}
              onClick={() => setActiveSection("github")}
            >
              GitHub Actions
            </div>
          </div>
          <div class="menu-content">
            <Show when={activeSection() === "repos"}>
              <h3>Search paths</h3>
              <p class="menu-hint">Repos are found among the immediate children of each path below.</p>
              <div class="menu-path-list">
                <For each={repoPaths()} fallback={<div class="menu-empty">No paths configured</div>}>
                  {(path) => (
                    <div class="menu-path-row">
                      <span class="menu-path-text">{path}</span>
                      <span class="menu-path-remove" onClick={() => void removeRepoPath(path)}>
                        &times;
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <div class="menu-add-path">
                <input
                  type="text"
                  placeholder="/absolute/path/to/projects"
                  value={newPath()}
                  onInput={(e) => setNewPath(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                />
                <button onClick={handleAdd}>Add</button>
              </div>
              <Show when={repoPathsError()}>
                <div class="menu-error">{repoPathsError()}</div>
              </Show>
            </Show>
            <Show when={activeSection() === "github"}>
              <h3>GitHub Actions</h3>
              <p class="menu-hint">Map local repos to GitHub repos to show workflow run status on matching commits.</p>

              <div class="menu-notice">
                GitHub token is not stored by git-juggler. Set <span class="mono">{githubDraft().token_env || "GITHUB_TOKEN"}</span> before starting the backend.
              </div>

              <label class="menu-field">
                <span>API base URL</span>
                <input
                  type="text"
                  value={githubDraft().api_base_url}
                  onInput={(e) => updateGitHubDraft("api_base_url", e.currentTarget.value)}
                />
              </label>

              <label class="menu-field">
                <span>Token env var</span>
                <input
                  type="text"
                  value={githubDraft().token_env}
                  onInput={(e) => updateGitHubDraft("token_env", e.currentTarget.value)}
                />
              </label>

              <div class="menu-subheading">Repo mappings</div>
              <div class="github-repo-mappings">
                <Show when={githubDraft().repos.length > 0} fallback={<div class="menu-empty">No GitHub repos configured</div>}>
                  <Index each={githubDraft().repos}>
                    {(repo, index) => (
                    <div class="github-repo-row">
                      <input
                        type="text"
                        placeholder="/absolute/path/to/repo"
                        value={repo().repo_path}
                        onInput={(e) => updateGitHubRepo(index, "repo_path", e.currentTarget.value)}
                      />
                      <input
                        type="text"
                        placeholder="owner"
                        value={repo().owner}
                        onInput={(e) => updateGitHubRepo(index, "owner", e.currentTarget.value)}
                      />
                      <input
                        type="text"
                        placeholder="repo"
                        value={repo().repo}
                        onInput={(e) => updateGitHubRepo(index, "repo", e.currentTarget.value)}
                      />
                      <button type="button" class="menu-secondary-button" onClick={() => removeGitHubRepo(index)}>
                        Remove
                      </button>
                    </div>
                    )}
                  </Index>
                </Show>
              </div>

              <div class="menu-actions">
                <button type="button" class="menu-secondary-button" onClick={addGitHubRepo}>
                  Add mapping
                </button>
                <button type="button" class="menu-primary-button" onClick={handleSaveGitHub}>
                  Save GitHub settings
                </button>
              </div>

              <Show when={githubConfigError()}>
                <div class="menu-error">{githubConfigError()}</div>
              </Show>
            </Show>
            <Show when={activeSection() === "appearance"}>
              <h3>Appearance</h3>

              <div class="menu-setting">
                <div class="menu-setting-main">
                  <div class="menu-setting-label">Theme</div>
                </div>
                <div class="theme-options">
                  <For each={[["dark", "Dark"], ["light", "Light"]] as [Theme, string][]}>
                    {([value, label]) => (
                      <button classList={{ active: theme() === value }} onClick={() => setTheme(value)}>
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <div class="menu-setting">
                <div class="menu-setting-main">
                  <div class="menu-setting-label">Branch colors</div>
                  <p class="menu-hint">Choose whether branch colors come from the branch name or from discovery order.</p>
                </div>
                <div class="theme-options">
                  <For each={[["hash", "Name hash based"], ["sequential", "Sequential"]] as [BranchColorMode, string][]}>
                    {([value, label]) => (
                      <button classList={{ active: branchColorMode() === value }} onClick={() => setBranchColorMode(value)}>
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

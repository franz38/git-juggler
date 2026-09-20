import { For, Index, Show, createEffect, createSignal } from "solid-js";
import type { GitHubConfig, JenkinsConfig } from "../../api/types";
import {
  addRepoPath,
  agentsEnabled,
  branchColorMode,
  closeMenu,
  excludedPaths,
  excludedPathsError,
  githubConfig,
  githubConfigError,
  jenkinsConfig,
  jenkinsConfigError,
  menuOpen,
  removeRepoPath,
  repoPaths,
  repoPathsError,
  saveExcludedPaths,
  saveGitHubConfig,
  saveJenkinsConfig,
  setAgentsEnabled,
  setBranchColorMode,
  setTheme,
  theme,
} from "../../state/store";
import type { BranchColorMode, Theme } from "../../state/store";

type Section = "repos" | "github" | "jenkins" | "appearance" | "agents";

const emptyGitHubConfig: GitHubConfig = {
  enabled: true,
  auto_detect: true,
  api_base_url: "https://api.github.com",
  token_env: "GITHUB_TOKEN",
  repos: [],
};

const emptyJenkinsConfig: JenkinsConfig = {
  enabled: true,
  base_url: "",
  username: "",
  api_token_env: "JENKINS_API_TOKEN",
  build_limit: 50,
  jobs: [],
};

export function MainMenu() {
  const [activeSection, setActiveSection] = createSignal<Section>("repos");
  const [newPath, setNewPath] = createSignal("");
  const [githubDraft, setGitHubDraft] = createSignal<GitHubConfig>(emptyGitHubConfig);
  const [jenkinsDraft, setJenkinsDraft] = createSignal<JenkinsConfig>(emptyJenkinsConfig);

  createEffect(() => {
    const config = githubConfig();
    setGitHubDraft({ ...config, repos: config.repos.map((repo) => ({ ...repo })) });
  });

  createEffect(() => {
    const config = jenkinsConfig();
    setJenkinsDraft({ ...config, jobs: config.jobs.map((job) => ({ ...job })) });
  });

  const [excludedPathsDraft, setExcludedPathsDraft] = createSignal("");
  createEffect(() => {
    setExcludedPathsDraft(excludedPaths().join(", "));
  });
  const handleSaveExcludedPaths = () => {
    const next = excludedPathsDraft()
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    void saveExcludedPaths(next);
  };

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

  const updateJenkinsDraft = <K extends keyof JenkinsConfig>(key: K, value: JenkinsConfig[K]) => {
    setJenkinsDraft((current) => ({ ...current, [key]: value }));
  };

  const updateJenkinsJob = (index: number, key: "repo_path" | "job_url", value: string) => {
    setJenkinsDraft((current) => ({
      ...current,
      jobs: current.jobs.map((job, i) => (i === index ? { ...job, [key]: value } : job)),
    }));
  };

  const addJenkinsJob = () => {
    setJenkinsDraft((current) => ({
      ...current,
      jobs: [...current.jobs, { repo_path: "", job_url: "" }],
    }));
  };

  const removeJenkinsJob = (index: number) => {
    setJenkinsDraft((current) => ({
      ...current,
      jobs: current.jobs.filter((_, i) => i !== index),
    }));
  };

  const handleSaveJenkins = () => {
    void saveJenkinsConfig({
      ...jenkinsDraft(),
      base_url: jenkinsDraft().base_url.trim(),
      username: jenkinsDraft().username.trim(),
      api_token_env: jenkinsDraft().api_token_env.trim() || "JENKINS_API_TOKEN",
      build_limit: Math.max(1, Math.min(Number(jenkinsDraft().build_limit) || 50, 500)),
      jobs: jenkinsDraft().jobs
        .map((job) => ({ repo_path: job.repo_path.trim(), job_url: job.job_url.trim() }))
        .filter((job) => job.repo_path && job.job_url),
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
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "jenkins" }}
              onClick={() => setActiveSection("jenkins")}
            >
              Jenkins
            </div>
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "agents" }}
              onClick={() => setActiveSection("agents")}
            >
              Agents
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
              <label class="menu-field">
                <span>Excluded paths</span>
                <input
                  type="text"
                  placeholder=".claude"
                  value={excludedPathsDraft()}
                  onInput={(e) => setExcludedPathsDraft(e.currentTarget.value)}
                  onBlur={handleSaveExcludedPaths}
                />
              </label>
              <p class="menu-hint">Comma-separated paths (relative to each repo's root) ignored when detecting uncommitted changes.</p>
              <Show when={excludedPathsError()}>
                <div class="menu-error">{excludedPathsError()}</div>
              </Show>
            </Show>
            <Show when={activeSection() === "github"}>
              <h3>GitHub Actions</h3>
              <p class="menu-hint">Workflow status is detected from each repo's origin remote by default.</p>

              <div class="menu-notice">
                GitHub token is not stored by git-juggler. Set <span class="mono">{githubDraft().token_env || "GITHUB_TOKEN"}</span> before starting the backend.
              </div>

              <label class="menu-switch-row">
                <span>
                  <span class="menu-setting-label">Enable GitHub Actions integration</span>
                  <span class="menu-hint">When disabled, workflow status is not requested or shown.</span>
                </span>
                <input
                  type="checkbox"
                  checked={githubDraft().enabled}
                  onChange={(e) => updateGitHubDraft("enabled", e.currentTarget.checked)}
                />
              </label>

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

              <label class="menu-switch-row">
                <span>
                  <span class="menu-setting-label">Automatic GitHub Actions detection</span>
                  <span class="menu-hint">Infer owner and repo from each local repo's origin remote.</span>
                </span>
                <input
                  type="checkbox"
                  checked={githubDraft().auto_detect}
                  onChange={(e) => updateGitHubDraft("auto_detect", e.currentTarget.checked)}
                />
              </label>

              <div class="menu-subheading">Advanced repo overrides</div>
              <p class="menu-hint">Only add mappings when origin cannot be used or should map to a different GitHub repo.</p>
              <div class="github-repo-mappings">
                <Show when={githubDraft().repos.length > 0} fallback={<div class="menu-empty">No overrides configured</div>}>
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
                  Add override
                </button>
                <button type="button" class="menu-primary-button" onClick={handleSaveGitHub}>
                  Save GitHub settings
                </button>
              </div>

              <Show when={githubConfigError()}>
                <div class="menu-error">{githubConfigError()}</div>
              </Show>
            </Show>
            <Show when={activeSection() === "jenkins"}>
              <h3>Jenkins</h3>
              <p class="menu-hint">Jenkins builds are matched to commits from configured job URLs.</p>

              <div class="menu-notice">
                Jenkins API token is not stored by git-juggler. Set <span class="mono">{jenkinsDraft().api_token_env || "JENKINS_API_TOKEN"}</span> before starting the backend.
              </div>

              <label class="menu-switch-row">
                <span>
                  <span class="menu-setting-label">Enable Jenkins integration</span>
                  <span class="menu-hint">When disabled, Jenkins build status is not requested or shown.</span>
                </span>
                <input
                  type="checkbox"
                  checked={jenkinsDraft().enabled}
                  onChange={(e) => updateJenkinsDraft("enabled", e.currentTarget.checked)}
                />
              </label>

              <label class="menu-field">
                <span>Jenkins base URL</span>
                <input
                  type="text"
                  placeholder="https://jenkins.example.com"
                  value={jenkinsDraft().base_url}
                  onInput={(e) => updateJenkinsDraft("base_url", e.currentTarget.value)}
                />
              </label>

              <label class="menu-field">
                <span>Username</span>
                <input
                  type="text"
                  value={jenkinsDraft().username}
                  onInput={(e) => updateJenkinsDraft("username", e.currentTarget.value)}
                />
              </label>

              <label class="menu-field">
                <span>Token env var</span>
                <input
                  type="text"
                  value={jenkinsDraft().api_token_env}
                  onInput={(e) => updateJenkinsDraft("api_token_env", e.currentTarget.value)}
                />
              </label>

              <label class="menu-field">
                <span>Build limit per job</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={jenkinsDraft().build_limit}
                  onInput={(e) => updateJenkinsDraft("build_limit", Number(e.currentTarget.value))}
                />
              </label>

              <div class="menu-subheading">Job mappings</div>
              <p class="menu-hint">Map each local repo to one or more Jenkins job URLs.</p>
              <div class="github-repo-mappings">
                <Show when={jenkinsDraft().jobs.length > 0} fallback={<div class="menu-empty">No Jenkins jobs configured</div>}>
                  <Index each={jenkinsDraft().jobs}>
                    {(job, index) => (
                      <div class="github-repo-row">
                        <input
                          type="text"
                          placeholder="/absolute/path/to/repo"
                          value={job().repo_path}
                          onInput={(e) => updateJenkinsJob(index, "repo_path", e.currentTarget.value)}
                        />
                        <input
                          type="text"
                          placeholder="https://jenkins.example.com/job/my-pipeline/job/main"
                          value={job().job_url}
                          onInput={(e) => updateJenkinsJob(index, "job_url", e.currentTarget.value)}
                        />
                        <button type="button" class="menu-secondary-button" onClick={() => removeJenkinsJob(index)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </Index>
                </Show>
              </div>

              <div class="menu-actions">
                <button type="button" class="menu-secondary-button" onClick={addJenkinsJob}>
                  Add job
                </button>
                <button type="button" class="menu-primary-button" onClick={handleSaveJenkins}>
                  Save Jenkins settings
                </button>
              </div>

              <Show when={jenkinsConfigError()}>
                <div class="menu-error">{jenkinsConfigError()}</div>
              </Show>
            </Show>
            <Show when={activeSection() === "agents"}>
              <h3>Agents</h3>
              <p class="menu-hint">
                Detects local coding-agent processes (Claude Code, opencode) and the worktrees they're active in, shown as badges in
                the sidebar and commit graph.
              </p>

              <label class="menu-switch-row">
                <span>
                  <span class="menu-setting-label">Enable agent activity detection</span>
                  <span class="menu-hint">When disabled, no agent data is fetched or shown anywhere in the app.</span>
                </span>
                <input
                  type="checkbox"
                  checked={agentsEnabled()}
                  onChange={(e) => setAgentsEnabled(e.currentTarget.checked)}
                />
              </label>
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

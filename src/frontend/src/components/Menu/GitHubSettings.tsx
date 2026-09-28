import { Index, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { testGitHubConnection } from "../../api/client";
import type { GitHubConfig } from "../../api/types";
import { CiPollField } from "./CiPollField";
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

const AUTOSAVE_DELAY_MS = 500;

// The "GitHub Actions" settings: toggles save immediately; text edits save
// after a short debounce so typing does not write config on every keystroke.
export function GitHubSettings() {
  const [draft, setDraft] = createSignal<GitHubConfig>(emptyGitHubConfig);
  const [testing, setTesting] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSave: GitHubConfig | null = null;
  let testResultRef: HTMLDivElement | undefined;

  createEffect(() => {
    const config = githubConfig();
    setDraft({ ...config, repos: config.repos.map((repo) => ({ ...repo })) });
  });

  onCleanup(() => {
    if (pendingSave) saveNow(pendingSave);
    else if (saveTimer) clearTimeout(saveTimer);
  });

  const normalize = (config: GitHubConfig): GitHubConfig => ({
    ...config,
    api_base_url: config.api_base_url.trim() || "https://api.github.com",
    token_env: config.token_env.trim() || "GITHUB_TOKEN",
    repos: config.repos
      .map((repo) => ({ repo_path: repo.repo_path.trim(), owner: repo.owner.trim(), repo: repo.repo.trim() }))
      .filter((repo) => repo.repo_path && repo.owner && repo.repo),
  });

  const saveNow = (config: GitHubConfig) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSave = null;
    void saveGitHubConfig(normalize(config));
  };

  const saveLater = (config: GitHubConfig) => {
    if (saveTimer) clearTimeout(saveTimer);
    pendingSave = config;
    saveTimer = setTimeout(() => saveNow(config), AUTOSAVE_DELAY_MS);
  };

  const flushPendingSave = () => {
    if (pendingSave) saveNow(pendingSave);
  };

  const update = <K extends keyof GitHubConfig>(key: K, value: GitHubConfig[K], mode: "now" | "later") => {
    const next = { ...draft(), [key]: value };
    setDraft(next);
    if (mode === "now") saveNow(next);
    else saveLater(next);
  };

  const updateRepo = (index: number, key: "repo_path" | "owner" | "repo", value: string) => {
    const next = {
      ...draft(),
      repos: draft().repos.map((repo, i) => (i === index ? { ...repo, [key]: value } : repo)),
    };
    setDraft(next);
    saveLater(next);
  };

  const addRepo = () => {
    setDraft((current) => ({
      ...current,
      repos: [...current.repos, { repo_path: "", owner: "", repo: "" }],
    }));
  };

  const removeRepo = (index: number) => {
    const next = {
      ...draft(),
      repos: draft().repos.filter((_, i) => i !== index),
    };
    setDraft(next);
    saveNow(next);
  };

  const handleTest = async () => {
    if (testing()) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testGitHubConnection(normalize(draft())));
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  createEffect(() => {
    if (!testResult()) return;
    requestAnimationFrame(() => {
      testResultRef?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });

  return (
    <>
      <p class="menu-hint">Workflow status is detected from each repo's origin remote by default.</p>

      <div class="menu-notice">
        GitHub token is not stored by git-juggler. Set <span class="mono">{draft().token_env || "GITHUB_TOKEN"}</span> before starting the app.
      </div>

      <ToggleField
        label="Enable GitHub Actions integration"
        description="When disabled, workflow status is not requested or shown."
        checked={draft().enabled}
        onChange={(checked) => update("enabled", checked, "now")}
      />

      <CiPollField />

      <TextField label="API base URL" value={draft().api_base_url} onChange={(value) => update("api_base_url", value, "later")} onBlur={flushPendingSave} />

      <TextField label="Token env var" value={draft().token_env} onChange={(value) => update("token_env", value, "later")} onBlur={flushPendingSave} />

      <ToggleField
        label="Automatic GitHub Actions detection"
        description="Infer owner and repo from each local repo's origin remote."
        checked={draft().auto_detect}
        onChange={(checked) => update("auto_detect", checked, "now")}
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
                  onBlur={flushPendingSave}
                />
                <input
                  type="text"
                  placeholder="owner"
                  value={repo().owner}
                  onInput={(e) => updateRepo(index, "owner", e.currentTarget.value)}
                  onBlur={flushPendingSave}
                />
                <input
                  type="text"
                  placeholder="repo"
                  value={repo().repo}
                  onInput={(e) => updateRepo(index, "repo", e.currentTarget.value)}
                  onBlur={flushPendingSave}
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
        <button type="button" class="menu-secondary-button" disabled={testing()} onClick={() => void handleTest()}>
          {testing() ? "Testing..." : "Test connection"}
        </button>
      </div>

      <Show when={testResult()}>
        {(result) => (
          <div ref={testResultRef} class="menu-test-result" classList={{ success: result().ok, error: !result().ok }}>
            {result().message}
          </div>
        )}
      </Show>

      <Show when={githubConfigError()}>
        <div class="menu-error">{githubConfigError()}</div>
      </Show>
    </>
  );
}

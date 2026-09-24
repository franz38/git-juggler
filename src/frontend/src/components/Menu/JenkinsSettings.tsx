import { Index, Show, createEffect, createSignal } from "solid-js";
import type { JenkinsConfig } from "../../api/types";
import { NumberField } from "../inputs/NumberField";
import { TextField } from "../inputs/TextField";
import { ToggleField } from "../inputs/ToggleField";
import { jenkinsConfig, jenkinsConfigError, saveJenkinsConfig } from "../../state/store";

const emptyJenkinsConfig: JenkinsConfig = {
  enabled: true,
  base_url: "",
  username: "",
  api_token_env: "JENKINS_API_TOKEN",
  build_limit: 50,
  jobs: [],
};

// The "Jenkins" settings: connection details plus per-repo job mappings.
// Keeps its own draft (synced from the saved config), committed on "Save
// Jenkins settings".
export function JenkinsSettings() {
  const [draft, setDraft] = createSignal<JenkinsConfig>(emptyJenkinsConfig);

  createEffect(() => {
    const config = jenkinsConfig();
    setDraft({ ...config, jobs: config.jobs.map((job) => ({ ...job })) });
  });

  const update = <K extends keyof JenkinsConfig>(key: K, value: JenkinsConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateJob = (index: number, key: "repo_path" | "job_url", value: string) => {
    setDraft((current) => ({
      ...current,
      jobs: current.jobs.map((job, i) => (i === index ? { ...job, [key]: value } : job)),
    }));
  };

  const addJob = () => {
    setDraft((current) => ({
      ...current,
      jobs: [...current.jobs, { repo_path: "", job_url: "" }],
    }));
  };

  const removeJob = (index: number) => {
    setDraft((current) => ({
      ...current,
      jobs: current.jobs.filter((_, i) => i !== index),
    }));
  };

  const handleSave = () => {
    void saveJenkinsConfig({
      ...draft(),
      base_url: draft().base_url.trim(),
      username: draft().username.trim(),
      api_token_env: draft().api_token_env.trim() || "JENKINS_API_TOKEN",
      build_limit: Math.max(1, Math.min(Number(draft().build_limit) || 50, 500)),
      jobs: draft().jobs
        .map((job) => ({ repo_path: job.repo_path.trim(), job_url: job.job_url.trim() }))
        .filter((job) => job.repo_path && job.job_url),
    });
  };

  return (
    <>
      <p class="menu-hint">Jenkins builds are matched to commits from configured job URLs.</p>

      <div class="menu-notice">
        Jenkins API token is not stored by git-juggler. Set <span class="mono">{draft().api_token_env || "JENKINS_API_TOKEN"}</span> before starting the app.
      </div>

      <ToggleField
        label="Enable Jenkins integration"
        description="When disabled, Jenkins build status is not requested or shown."
        checked={draft().enabled}
        onChange={(checked) => update("enabled", checked)}
      />

      <TextField
        label="Jenkins base URL"
        placeholder="https://jenkins.example.com"
        value={draft().base_url}
        onChange={(value) => update("base_url", value)}
      />

      <TextField label="Username" mono={false} value={draft().username} onChange={(value) => update("username", value)} />

      <TextField label="Token env var" value={draft().api_token_env} onChange={(value) => update("api_token_env", value)} />

      <NumberField
        label="Build limit per job"
        min={1}
        max={500}
        value={draft().build_limit}
        onChange={(value) => update("build_limit", value ?? 50)}
      />

      <div class="menu-field">
      <span>Job mappings</span>
      <p class="menu-hint">Map each local repo to one or more Jenkins job URLs.</p>
      <div class="github-repo-mappings">
        <Show when={draft().jobs.length > 0} fallback={<div class="menu-empty">No Jenkins jobs configured</div>}>
          <Index each={draft().jobs}>
            {(job, index) => (
              <div class="github-repo-row">
                <input
                  type="text"
                  placeholder="/absolute/path/to/repo"
                  value={job().repo_path}
                  onInput={(e) => updateJob(index, "repo_path", e.currentTarget.value)}
                />
                <input
                  type="text"
                  placeholder="https://jenkins.example.com/job/my-pipeline/job/main"
                  value={job().job_url}
                  onInput={(e) => updateJob(index, "job_url", e.currentTarget.value)}
                />
                <button type="button" class="menu-secondary-button" onClick={() => removeJob(index)}>
                  Remove
                </button>
              </div>
            )}
          </Index>
        </Show>
      </div>
      </div>

      <div class="menu-actions">
        <button type="button" class="menu-secondary-button" onClick={addJob}>
          Add job
        </button>
        <button type="button" class="menu-primary-button" onClick={handleSave}>
          Save Jenkins settings
        </button>
      </div>

      <Show when={jenkinsConfigError()}>
        <div class="menu-error">{jenkinsConfigError()}</div>
      </Show>
    </>
  );
}

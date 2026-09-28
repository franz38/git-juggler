import { Index, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { testJenkinsConnection, testJenkinsRule } from "../../api/client";
import type { JenkinsConfig, JenkinsRuleConfig } from "../../api/types";
import { CiPollField } from "./CiPollField";
import { NumberField } from "../inputs/NumberField";
import { TextField } from "../inputs/TextField";
import { ToggleField } from "../inputs/ToggleField";
import { MultiSelect } from "../Search/MultiSelect";
import { jenkinsConfig, jenkinsConfigError, repos, saveJenkinsConfig } from "../../state/store";

const emptyJenkinsConfig: JenkinsConfig = {
  enabled: true,
  base_url: "",
  username: "",
  api_token_env: "JENKINS_API_TOKEN",
  build_limit: 50,
  detect_external_pushes: true,
  rules: [],
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const AUTOSAVE_DELAY_MS = 500;

function sameRule(a: JenkinsRuleConfig, b: JenkinsRuleConfig | undefined): boolean {
  if (!b) return false;
  return a.id === b.id && a.name === b.name && a.job_url === b.job_url && a.repo_paths.length === b.repo_paths.length && a.repo_paths.every((path, index) => path === b.repo_paths[index]);
}

// The "Jenkins" settings: top-level fields autosave; rule edits stay draft
// until that card's Save rule button is clicked.
export function JenkinsSettings() {
  const [draft, setDraft] = createSignal<JenkinsConfig>(emptyJenkinsConfig);
  const [hasRuleDraftChanges, setHasRuleDraftChanges] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [testingRuleKey, setTestingRuleKey] = createSignal<string | null>(null);
  const [ruleTestResults, setRuleTestResults] = createSignal<Record<string, { ok: boolean; message: string }>>({});
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSave: JenkinsConfig | null = null;
  let testResultRef: HTMLDivElement | undefined;

  createEffect(() => {
    const config = jenkinsConfig();
    const preserveDraftRules = untrack(hasRuleDraftChanges);
    setDraft((current) => ({
      ...config,
      rules: (preserveDraftRules ? current.rules : config.rules).map((rule) => ({ ...rule, repo_paths: [...rule.repo_paths] })),
    }));
  });

  onCleanup(() => {
    if (pendingSave) saveNow(pendingSave);
    else if (saveTimer) clearTimeout(saveTimer);
  });

  const normalize = (config: JenkinsConfig): JenkinsConfig => ({
    ...config,
    base_url: config.base_url.trim(),
    username: config.username.trim(),
    api_token_env: config.api_token_env.trim() || "JENKINS_API_TOKEN",
    build_limit: Math.max(1, Math.min(Number(config.build_limit) || 50, 500)),
    rules: config.rules
      .map((rule) => ({
        id: rule.id || newId(),
        name: rule.name.trim() || "Jenkins rule",
        repo_paths: Array.from(new Set(rule.repo_paths.map((path) => path.trim()).filter(Boolean))),
        job_url: rule.job_url.trim(),
      }))
      .filter((rule) => rule.repo_paths.length > 0 && rule.job_url),
  });

  const normalizeRule = (rule: JenkinsRuleConfig): JenkinsRuleConfig | null => {
    const next = {
      id: rule.id || newId(),
      name: rule.name.trim() || "Jenkins rule",
      repo_paths: Array.from(new Set(rule.repo_paths.map((path) => path.trim()).filter(Boolean))),
      job_url: rule.job_url.trim(),
    };
    return next.repo_paths.length > 0 && next.job_url ? next : null;
  };

  const configWithSavedRules = (config: JenkinsConfig): JenkinsConfig => ({ ...config, rules: jenkinsConfig().rules.map((rule) => ({ ...rule, repo_paths: [...rule.repo_paths] })) });

  const saveNow = (config: JenkinsConfig) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSave = null;
    void saveJenkinsConfig(normalize(config));
  };

  const saveLater = (config: JenkinsConfig) => {
    if (saveTimer) clearTimeout(saveTimer);
    pendingSave = config;
    saveTimer = setTimeout(() => saveNow(config), AUTOSAVE_DELAY_MS);
  };

  const flushPendingSave = () => {
    if (pendingSave) saveNow(pendingSave);
  };

  const update = <K extends keyof JenkinsConfig>(key: K, value: JenkinsConfig[K], mode: "now" | "later") => {
    const next = { ...draft(), [key]: value };
    setDraft(next);
    const persistedRulesConfig = configWithSavedRules(next);
    if (mode === "now") saveNow(persistedRulesConfig);
    else saveLater(persistedRulesConfig);
  };

  const addRule = () => {
    setDraft((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: newId(),
          name: "New Jenkins rule",
          repo_paths: [],
          job_url: "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}",
        },
      ],
    }));
    setHasRuleDraftChanges(true);
  };

  const updateRule = <K extends keyof JenkinsRuleConfig>(index: number, key: K, value: JenkinsRuleConfig[K]) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)),
    }));
    setHasRuleDraftChanges(true);
  };

  const removeRule = (index: number) => {
    const next = { ...draft(), rules: draft().rules.filter((_, i) => i !== index) };
    setDraft(next);
    setHasRuleDraftChanges(false);
    saveNow(next);
  };

  const repoOptionsForRule = (ruleIndex: number) => {
    const selected = new Set(draft().rules[ruleIndex]?.repo_paths ?? []);
    const assignedElsewhere = new Set(draft().rules.flatMap((rule, i) => (i === ruleIndex ? [] : rule.repo_paths)));
    return repos()
      .map((repo) => repo.path)
      .filter((path) => selected.has(path) || !assignedElsewhere.has(path));
  };

  const ruleCount = createMemo(() => draft().rules.length);

  const savedRule = (rule: JenkinsRuleConfig) => jenkinsConfig().rules.find((item) => item.id === rule.id);
  const ruleDirty = (rule: JenkinsRuleConfig) => !sameRule(rule, savedRule(rule));
  const ruleCanSave = (rule: JenkinsRuleConfig) => rule.repo_paths.length > 0 && rule.job_url.trim().length > 0;

  const saveRule = (index: number) => {
    const normalizedRule = normalizeRule(draft().rules[index]);
    if (!normalizedRule) return;
    const savedRules = jenkinsConfig().rules;
    const savedIndex = savedRules.findIndex((rule) => rule.id === normalizedRule.id);
    const nextSavedRules = savedIndex >= 0
      ? savedRules.map((rule, i) => (i === savedIndex ? normalizedRule : rule))
      : [...savedRules, normalizedRule];
    const nextDraftRules = draft().rules.map((rule, i) => (i === index ? normalizedRule : rule));
    const nextDraft = { ...draft(), rules: nextDraftRules };
    setDraft(nextDraft);
    setHasRuleDraftChanges(nextDraftRules.some((rule) => !sameRule(rule, nextSavedRules.find((saved) => saved.id === rule.id))));
    saveNow({ ...nextDraft, rules: nextSavedRules });
  };

  const repoName = (path: string) => repos().find((repo) => repo.path === path)?.name ?? path.split(/[\\/]/).pop() ?? path;

  const testRuleForRepo = async (rule: JenkinsRuleConfig, repoPath: string) => {
    const key = `${rule.id}:${repoPath}`;
    if (testingRuleKey()) return;
    setTestingRuleKey(key);
    setRuleTestResults((current) => ({ ...current, [key]: { ok: true, message: `${repoName(repoPath)}: checking Jenkins pipeline...` } }));
    try {
      const result = await testJenkinsRule({ config: normalize(draft()), rule, repo_path: repoPath });
      setRuleTestResults((current) => ({ ...current, [key]: result }));
    } catch (e) {
      setRuleTestResults((current) => ({ ...current, [key]: { ok: false, message: (e as Error).message } }));
    } finally {
      setTestingRuleKey(null);
    }
  };

  const handleTest = async () => {
    if (testing()) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testJenkinsConnection(normalize(draft())));
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
      <p class="menu-hint">Jenkins builds are matched to commits from configured rules.</p>

      <div class="menu-notice">
        Jenkins API token is not stored by git-juggler. Set <span class="mono">{draft().api_token_env || "JENKINS_API_TOKEN"}</span> before starting the app.
      </div>

      <ToggleField
        label="Enable Jenkins integration"
        description="When disabled, Jenkins build status is not requested or shown."
        checked={draft().enabled}
        onChange={(checked) => update("enabled", checked, "now")}
      />

      <CiPollField />

      <TextField
        label="Jenkins base URL"
        placeholder="https://jenkins.example.com"
        value={draft().base_url}
        onChange={(value) => update("base_url", value, "later")}
        onBlur={flushPendingSave}
      />

      <TextField label="Username" mono={false} value={draft().username} onChange={(value) => update("username", value, "later")} onBlur={flushPendingSave} />

      <TextField label="Token env var" value={draft().api_token_env} onChange={(value) => update("api_token_env", value, "later")} onBlur={flushPendingSave} />

      <NumberField
        label="Build limit per job"
        min={1}
        max={500}
        value={draft().build_limit}
        onChange={(value) => update("build_limit", value ?? 50, "now")}
      />

      <ToggleField
        label="Detect external pushes"
        description="For the active repo only, watch upstream ref changes and discover matching Jenkins branch pipelines. This is heuristic."
        checked={draft().detect_external_pushes}
        onChange={(checked) => update("detect_external_pushes", checked, "now")}
      />

      <div class="menu-field">
        <span>Rules</span>
        <p class="menu-hint">
          Each repo can belong to one rule. The pipeline URL supports <span class="mono">{"{repo_name}"}</span>, <span class="mono">{"{repo_name_url}"}</span>, <span class="mono">{"{repo_slug}"}</span>, <span class="mono">{"{repo_slug_url}"}</span>, <span class="mono">{"{branch_name}"}</span>, and <span class="mono">{"{branch_name_url}"}</span>. Branch placeholders are resolved after pushes; git-juggler does not query every branch.
        </p>
        <div class="jenkins-rules">
          <Show when={ruleCount() > 0} fallback={<div class="menu-empty">No Jenkins rules configured</div>}>
            <Index each={draft().rules}>
              {(rule, ruleIndex) => (
                <div class="jenkins-rule-card">
                  <div class="jenkins-rule-heading">
                    <input type="text" value={rule().name} placeholder="Rule name" onInput={(e) => updateRule(ruleIndex, "name", e.currentTarget.value)} />
                    <Show
                      when={ruleDirty(rule())}
                      fallback={<button type="button" class="menu-secondary-button" onClick={() => removeRule(ruleIndex)}>Remove rule</button>}
                    >
                      <button type="button" class="menu-primary-button" disabled={!ruleCanSave(rule())} onClick={() => saveRule(ruleIndex)}>Save rule</button>
                    </Show>
                  </div>
                  <MultiSelect options={repoOptionsForRule(ruleIndex)} selected={rule().repo_paths} onChange={(next) => updateRule(ruleIndex, "repo_paths", next)} placeholder="Select repos" />
                  <input type="text" value={rule().job_url} placeholder="https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}" onInput={(e) => updateRule(ruleIndex, "job_url", e.currentTarget.value)} />
                  <Show when={rule().repo_paths.length > 0}>
                    <div class="jenkins-rule-repo-tests">
                      <Index each={rule().repo_paths}>
                        {(repoPath) => {
                          const key = () => `${rule().id}:${repoPath()}`;
                          const result = () => ruleTestResults()[key()];
                          const running = () => testingRuleKey() === key();
                          return (
                            <div class="jenkins-rule-repo-test">
                              <button type="button" class="jenkins-rule-play" title={`Check ${repoName(repoPath())} on main/master`} disabled={running() || !ruleCanSave(rule())} onClick={() => void testRuleForRepo(rule(), repoPath())}>
                                ▶
                              </button>
                              <span class="jenkins-rule-repo-name">{repoName(repoPath())}</span>
                              <Show when={result()}>
                                {(item) => <span class="jenkins-rule-test-log" classList={{ success: item().ok, error: !item().ok }}>{running() ? `${repoName(repoPath())}: checking Jenkins pipeline...` : item().message}</span>}
                              </Show>
                            </div>
                          );
                        }}
                      </Index>
                    </div>
                  </Show>
                </div>
              )}
            </Index>
          </Show>
        </div>
      </div>

      <div class="menu-actions">
        <button type="button" class="menu-secondary-button" onClick={addRule}>
          Add rule
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

      <Show when={jenkinsConfigError()}>
        <div class="menu-error">{jenkinsConfigError()}</div>
      </Show>
    </>
  );
}

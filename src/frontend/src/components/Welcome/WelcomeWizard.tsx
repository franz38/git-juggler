import { For, Show, createSignal, onMount } from "solid-js";
import { closeWelcomeWizard, loadConfig, welcomeWizardOpen } from "../../state/store";
import { isPreviewingTheme } from "../../state/themes";
import { AgentsSettings } from "../Menu/AgentsSettings";
import { GitHubSettings } from "../Menu/GitHubSettings";
import { JenkinsSettings } from "../Menu/JenkinsSettings";
import { ThemePicker } from "../Menu/ThemePicker";

type Step = {
  id: "theme" | "agents" | "cicd";
  label: string;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    id: "theme",
    label: "Theme",
    title: "Pick a theme",
    description: "Purely visual — you can change this any time from the main menu's Appearance section.",
  },
  {
    id: "agents",
    label: "Agents",
    title: "Agent activity detection",
    description:
      "git-juggler can detect local Claude Code and opencode sessions and show what they're doing across your repos. Turn it on and, for the most accurate results, install the hooks below.",
  },
  {
    id: "cicd",
    label: "CI/CD",
    title: "Connect your CI",
    description: "Wire up GitHub Actions and/or Jenkins so build and workflow status shows up alongside your branches.",
  },
];

// First-run wizard: a short, three-step tour (theme, agents, CI/CD) shown
// once per browser. Each step embeds the same settings components used in
// the main menu, so anything set here is just... the real setting, already
// saved — "Finish" only marks onboarding as seen, there's nothing to submit.
export function WelcomeWizard() {
  const [stepIndex, setStepIndex] = createSignal(0);
  const step = () => STEPS[stepIndex()];

  onMount(() => {
    void loadConfig();
  });

  const goNext = () => {
    if (stepIndex() < STEPS.length - 1) setStepIndex((i) => i + 1);
    else closeWelcomeWizard();
  };
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  return (
    <Show when={welcomeWizardOpen()}>
      <div class="menu-overlay" classList={{ "previewing-theme": isPreviewingTheme() }}>
        <div class="menu-dialog welcome-dialog">
          <div class="welcome-close" title="Skip setup" onClick={() => closeWelcomeWizard()}>
            &times;
          </div>
          <div class="welcome-header">
            <h2>Welcome to git-juggler</h2>
            <p class="menu-hint">A quick, skippable setup — three steps.</p>
            <div class="welcome-progress">
              <For each={STEPS}>
                {(s, index) => (
                  <div
                    class="welcome-progress-step"
                    classList={{ active: index() === stepIndex(), done: index() < stepIndex() }}
                    onClick={() => setStepIndex(index())}
                  >
                    <span class="welcome-progress-dot">{index() < stepIndex() ? "✓" : index() + 1}</span>
                    <span class="welcome-progress-label">{s.label}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div class="welcome-body">
            <h3>{step().title}</h3>
            <p class="menu-hint">{step().description}</p>
            <Show when={step().id === "theme"}>
              <ThemePicker />
            </Show>
            <Show when={step().id === "agents"}>
              <AgentsSettings />
            </Show>
            <Show when={step().id === "cicd"}>
              <div class="menu-subheading">GitHub Actions</div>
              <GitHubSettings />
              <div class="menu-subheading">Jenkins</div>
              <JenkinsSettings />
            </Show>
          </div>
          <div class="welcome-footer">
            <button type="button" class="menu-secondary-button" onClick={() => closeWelcomeWizard()}>
              Skip setup
            </button>
            <div class="welcome-footer-nav">
              <Show when={stepIndex() > 0}>
                <button type="button" class="menu-secondary-button" onClick={goBack}>
                  Back
                </button>
              </Show>
              <button type="button" class="menu-primary-button" onClick={goNext}>
                {stepIndex() < STEPS.length - 1 ? "Next" : "Finish"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

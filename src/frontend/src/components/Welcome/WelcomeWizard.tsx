import { For, Show, createSignal, onMount } from "solid-js";
import { closeWelcomeWizard, loadConfig, welcomeWizardOpen } from "../../state/store";
import { isPreviewingTheme } from "../../state/themes";
import { AgentQuickPicks } from "../Menu/AgentQuickPicks";
import { RepoPathsSettings } from "../Menu/RepoPathsSettings";
import { ThemeQuickPicks } from "../Menu/ThemeQuickPicks";

type Step = {
  id: "theme" | "repos" | "agents";
  label: string;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    id: "theme",
    label: "Appearance",
    title: "How should it look?",
    description: "Your VS Code themes are all available later in Appearance.",
  },
  {
    id: "repos",
    label: "Repositories",
    title: "Where are your repos?",
    description: "Repos are found among the immediate children of each path below.",
  },
  {
    id: "agents",
    label: "Agents",
    title: "Track coding agents?",
    description:
      "git-juggler can detect local Claude Code and opencode sessions and show what they're doing across your repos. Nothing is tracked by default.",
  },
];

// First-run wizard: a short, three-step tour (appearance, repositories,
// agents) shown once per browser. Each step embeds the same settings
// components used in the main menu, so anything set here is just... the real
// setting, already saved — "Finish" only marks onboarding as seen, there's
// nothing to submit.
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
            <p class="menu-hint">Three quick picks. Everything else lives in Settings.</p>
            <div class="welcome-progress-bar">
              <For each={STEPS}>
                {(_s, index) => <div class="welcome-progress-segment" classList={{ filled: index() <= stepIndex() }} />}
              </For>
            </div>
            <div class="welcome-progress-caption">
              Step {stepIndex() + 1} of {STEPS.length} &middot; {step().label.toUpperCase()}
            </div>
          </div>
          <div class="welcome-body">
            <h3>{step().title}</h3>
            <p class="menu-hint">{step().description}</p>
            <Show when={step().id === "theme"}>
              <ThemeQuickPicks />
            </Show>
            <Show when={step().id === "repos"}>
              <div class="menu-section">
                <RepoPathsSettings />
              </div>
            </Show>
            <Show when={step().id === "agents"}>
              <AgentQuickPicks />
            </Show>
          </div>
          <div class="welcome-footer">
            <span class="welcome-skip" onClick={() => closeWelcomeWizard()}>
              Skip setup
            </span>
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

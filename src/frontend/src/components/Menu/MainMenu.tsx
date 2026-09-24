import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  KEY_BINDING_ACTIONS,
  MENU_SECTION_ORDER,
  branchColorMode,
  closeMenu,
  diffFullFile,
  formatKeyBinding,
  keyBindings,
  menuOpen,
  menuSection as activeSection,
  resetKeyBinding,
  resetOnboarding,
  resetToFactory,
  setBranchColorMode,
  setDiffFullFile,
  setKeyBinding,
  setMenuSection as setActiveSection,
} from "../../state/store";
import type { BranchColorMode, KeyBindingAction } from "../../state/store";
import { isPreviewingTheme } from "../../state/themes";
import { ToggleField } from "../inputs/ToggleField";
import { AgentsSettings } from "./AgentsSettings";
import { GitHubSettings } from "./GitHubSettings";
import { JenkinsSettings } from "./JenkinsSettings";
import { RepoPathsSettings } from "./RepoPathsSettings";
import { ThemePicker } from "./ThemePicker";

export function MainMenu() {
  const [recordingAction, setRecordingAction] = createSignal<KeyBindingAction | null>(null);
  const [confirmingFactoryReset, setConfirmingFactoryReset] = createSignal(false);
  const [factoryResetError, setFactoryResetError] = createSignal<string | null>(null);

  // Captures the next real keypress (ignoring bare modifier taps) and binds
  // it to `action`; Escape cancels without changing anything. Runs in the
  // capture phase and stops propagation so it never also triggers the app's
  // own global shortcuts or the section switcher below while recording.
  const startRecording = (action: KeyBindingAction) => {
    setRecordingAction(action);
    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Shift" || e.key === "Control" || e.key === "Meta" || e.key === "Alt") return;
      window.removeEventListener("keydown", handleCapture, true);
      setRecordingAction(null);
      if (e.key === "Escape") return;
      setKeyBinding(action, { key: e.key, mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
    };
    window.addEventListener("keydown", handleCapture, true);
  };

  // Up/Down cycle through sections while the menu is open, skipped while
  // typing in a field or while recording a new key binding above (which
  // needs to see raw arrow keys itself).
  onMount(() => {
    const handleMenuKeydown = (e: KeyboardEvent) => {
      if (!menuOpen() || recordingAction()) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const idx = MENU_SECTION_ORDER.indexOf(activeSection());
        setActiveSection(MENU_SECTION_ORDER[Math.min(idx + 1, MENU_SECTION_ORDER.length - 1)]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const idx = MENU_SECTION_ORDER.indexOf(activeSection());
        setActiveSection(MENU_SECTION_ORDER[Math.max(idx - 1, 0)]);
      }
    };
    window.addEventListener("keydown", handleMenuKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleMenuKeydown));
  });

  return (
    <Show when={menuOpen()}>
      <div class="menu-overlay" classList={{ "previewing-theme": isPreviewingTheme() }} onClick={closeMenu}>
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
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "keybindings" }}
              onClick={() => setActiveSection("keybindings")}
            >
              Key bindings
            </div>
            <div
              class="menu-section-item"
              classList={{ active: activeSection() === "configuration" }}
              onClick={() => setActiveSection("configuration")}
            >
              Configuration
            </div>
          </div>
          <div class="menu-content">
            <div class="menu-section">
            <Show when={activeSection() === "repos"}>
              <RepoPathsSettings />
            </Show>
            <Show when={activeSection() === "github"}>
              <GitHubSettings />
            </Show>
            <Show when={activeSection() === "jenkins"}>
              <JenkinsSettings />
            </Show>
            <Show when={activeSection() === "agents"}>
              <p class="menu-hint">
                Detects local coding-agent processes (Claude Code, opencode) and the worktrees they're active in, shown as badges in
                the sidebar and commit graph.
              </p>
              <AgentsSettings />
            </Show>
            <Show when={activeSection() === "appearance"}>
              <div class="menu-setting menu-setting-stacked">
                <div class="menu-setting-main">
                  <div class="menu-setting-label">Theme</div>
                  <p class="menu-hint">Use a built-in theme, one installed in VS Code, or import a VS Code color theme (.json).</p>
                </div>
                <ThemePicker />
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

              <ToggleField
                label="Show full file in diffs"
                description="In the file diff viewer, show the whole file instead of only the changed sections."
                checked={diffFullFile()}
                onChange={setDiffFullFile}
              />
            </Show>
            <Show when={activeSection() === "keybindings"}>
              <p class="menu-hint">Click Change, then press the key combination you want. Press Escape to cancel.</p>
              <div class="menu-path-list">
                <For each={KEY_BINDING_ACTIONS}>
                  {(action) => (
                    <div class="menu-path-row">
                      <span class="menu-setting-label">{action.label}</span>
                      <span class="keybinding-value">
                        {recordingAction() === action.id ? "Press a key…" : formatKeyBinding(keyBindings()[action.id])}
                      </span>
                      <div class="keybinding-actions">
                        <button
                          type="button"
                          class="menu-secondary-button"
                          disabled={recordingAction() !== null}
                          onClick={() => startRecording(action.id)}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          class="menu-secondary-button"
                          disabled={recordingAction() !== null}
                          onClick={() => resetKeyBinding(action.id)}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={activeSection() === "configuration"}>
              <div class="menu-setting">
                <div class="menu-setting-main">
                  <div class="menu-setting-label">Reset onboarding</div>
                  <p class="menu-hint">
                    Marks the welcome wizard (appearance, repositories, agents) as not completed and reopens it right away. Shared across
                    every browser — repo paths, integrations, theme and key bindings are left untouched.
                  </p>
                </div>
                <button
                  type="button"
                  class="menu-secondary-button"
                  onClick={() => {
                    resetOnboarding();
                    closeMenu();
                  }}
                >
                  Reset
                </button>
              </div>
              <div class="menu-setting">
                <div class="menu-setting-main">
                  <div class="menu-setting-label">Reset to factory settings</div>
                  <p class="menu-hint">
                    Deletes the whole configuration — repo paths, groups, GitHub and Jenkins integrations, imported themes, theme, key
                    bindings and agent settings — for every browser, then reloads the app as a fresh install. Your repositories
                    themselves are not touched.
                  </p>
                  <Show when={factoryResetError()}>
                    <p class="menu-hint">{factoryResetError()}</p>
                  </Show>
                </div>
                <Show
                  when={confirmingFactoryReset()}
                  fallback={
                    <button type="button" class="menu-secondary-button danger" onClick={() => setConfirmingFactoryReset(true)}>
                      Reset
                    </button>
                  }
                >
                  <button type="button" class="menu-secondary-button" onClick={() => setConfirmingFactoryReset(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="menu-primary-button danger"
                    onClick={() => {
                      setFactoryResetError(null);
                      resetToFactory().catch((err: unknown) => {
                        setConfirmingFactoryReset(false);
                        setFactoryResetError(err instanceof Error ? err.message : "Reset failed");
                      });
                    }}
                  >
                    Confirm reset
                  </button>
                </Show>
              </div>
            </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

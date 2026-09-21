import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  activeRepo,
  closeCreateTagModal,
  createAnnotatedTagInTerminal,
  createLightweightTagInTerminal,
  createTagModal,
  scheduleGraphRefresh,
} from "../../state/store";

type Phase = "form" | "pending" | "error";

export function CreateTagModal() {
  const [tagName, setTagName] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("form");
  const [pendingLabel, setPendingLabel] = createSignal("");
  const [resultText, setResultText] = createSignal("");

  createEffect(() => {
    if (!createTagModal()) {
      setTagName("");
      setMessage("");
      setPhase("form");
      setResultText("");
    }
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && createTagModal()) closeCreateTagModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const sanitizedName = () => tagName().trim().replace(/\s+/g, "-");
  const canCreateLightweight = () => sanitizedName().length > 0 && phase() !== "pending";
  const canCreateAnnotated = () => sanitizedName().length > 0 && message().trim().length > 0 && phase() !== "pending";

  const submit = async (kind: "lightweight" | "annotated") => {
    const target = createTagModal();
    const repo = activeRepo();
    if (!target || !repo) return;

    const name = sanitizedName();
    setTagName(name);
    setPhase("pending");
    setPendingLabel(kind === "annotated" ? "Creating annotated tag…" : "Creating tag…");

    const success =
      kind === "annotated"
        ? await createAnnotatedTagInTerminal(repo, target.hash, name, message().trim())
        : await createLightweightTagInTerminal(repo, target.hash, name);

    if (success) {
      scheduleGraphRefresh(repo);
      closeCreateTagModal();
    } else {
      setPhase("error");
      setResultText(`Failed to create tag "${name}" — see the terminal for details.`);
    }
  };

  return (
    <Show when={createTagModal()}>
      {(target) => (
        <div class="menu-overlay" onClick={closeCreateTagModal}>
          <div class="create-tag-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create tag</h3>
            <p class="menu-hint">
              On {target().shortHash} — {target().subject}
            </p>

            <label class="menu-field">
              <span>Tag name</span>
              <input
                type="text"
                value={tagName()}
                disabled={phase() === "pending"}
                onInput={(e) => setTagName(e.currentTarget.value)}
              />
            </label>
            <div class="menu-actions">
              <button
                type="button"
                class="menu-primary-button"
                disabled={!canCreateLightweight()}
                onClick={() => void submit("lightweight")}
              >
                Create tag
              </button>
            </div>

            <label class="menu-field">
              <span>Tagging message</span>
              <textarea
                rows={3}
                value={message()}
                disabled={phase() === "pending"}
                onInput={(e) => setMessage(e.currentTarget.value)}
              />
            </label>
            <div class="menu-actions">
              <button
                type="button"
                class="menu-primary-button"
                disabled={!canCreateAnnotated()}
                onClick={() => void submit("annotated")}
              >
                Create annotated tag
              </button>
            </div>

            <Show when={phase() === "pending"}>
              <p class="menu-hint">{pendingLabel()}</p>
            </Show>
            <Show when={phase() === "error"}>
              <p class="menu-error">{resultText()}</p>
              <div class="menu-actions">
                <button type="button" class="menu-secondary-button" onClick={() => setPhase("form")}>
                  Try again
                </button>
                <button type="button" class="menu-secondary-button" onClick={closeCreateTagModal}>
                  Close
                </button>
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

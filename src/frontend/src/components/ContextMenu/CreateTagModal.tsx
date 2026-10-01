import { Show, createMemo } from "solid-js";
import {
  activeRepo,
  closeCreateTagModal,
  createAnnotatedTagInTerminal,
  createLightweightTagInTerminal,
  createTagModal,
  scheduleGraphRefresh,
  tagsForRepo,
} from "../../state/store";
import { overlayZIndex, useOverlay } from "../../state/overlayStack";
import { formatAge } from "../Agents/agentFormat";
import { CreateTagDialog, suggestNextTag, type RecentTag } from "../Tags/CreateTagDialog";

export function CreateTagModal() {
  useOverlay("create-tag", () => !!createTagModal(), closeCreateTagModal);

  // Every tag in the repo, newest first. Only computed while the dialog is open.
  const tags = createMemo<RecentTag[]>(() => {
    const repo = activeRepo();
    if (!createTagModal() || !repo) return [];
    return tagsForRepo(repo).map((tag) => ({
      name: tag.name,
      sha: tag.commit.slice(0, 7),
      age: tag.created ? formatAge(tag.created * 1000) : undefined,
      annotated: tag.annotated,
    }));
  });
  const existingTags = createMemo(() => tags().map((t) => t.name));
  const suggestedName = createMemo(() =>
    tags()
      .map((t) => suggestNextTag(t.name))
      .find((name) => name !== undefined && !existingTags().includes(name)),
  );

  const create = async (tag: { name: string; message?: string; annotated: boolean }) => {
    const target = createTagModal();
    const repo = activeRepo();
    if (!target || !repo) return;

    const success = tag.annotated
      ? await createAnnotatedTagInTerminal(repo, target.hash, tag.name, tag.message ?? "")
      : await createLightweightTagInTerminal(repo, target.hash, tag.name);

    if (!success) return `Failed to create tag "${tag.name}" — see the terminal for details.`;
    scheduleGraphRefresh(repo);
    closeCreateTagModal();
  };

  return (
    <Show when={createTagModal()}>
      {(target) => (
        <div class="menu-overlay" style={{ "z-index": overlayZIndex("create-tag") }} onClick={closeCreateTagModal}>
          <CreateTagDialog
            sha={target().shortHash}
            subject={target().subject}
            existingTags={existingTags()}
            recentTags={tags()}
            suggestedName={suggestedName()}
            onCreate={create}
            onCancel={closeCreateTagModal}
          />
        </div>
      )}
    </Show>
  );
}

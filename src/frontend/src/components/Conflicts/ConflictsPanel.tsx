import { parse } from "diff2html/lib-esm/diff-parser";
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js";
import type { ConflictFile } from "../../api/types";
import { buildSideBySideRows, type DiffCell, type SideBySideRow } from "../../lib/sideBySide";
import { conflictStateForRepo, createConflictToken, fetchConflictContent, gitJugglerTerminalCommand, runInTerminal, scheduleCommitRefresh, scheduleGraphRefresh, shellQuote } from "../../state/store";

interface TextSegment {
  kind: "text";
  text: string;
}

interface ConflictSegment {
  kind: "conflict";
  id: number;
  header: string;
  ours: string;
  theirs: string;
  footer: string;
}

type Segment = TextSegment | ConflictSegment;
type Resolution = { mode: "ours" | "theirs" | "both" | "edit"; text: string };

function linesOf(text: string): string[] {
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function parseConflictMarkers(text: string): Segment[] {
  const lines = linesOf(text);
  const segments: Segment[] = [];
  let id = 0;
  let i = 0;
  const pushText = (items: string[]) => {
    if (items.length > 0) segments.push({ kind: "text", text: items.join("") });
  };

  while (i < lines.length) {
    const textLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith("<<<<<<<")) textLines.push(lines[i++]);
    pushText(textLines);
    if (i >= lines.length) break;

    const header = lines[i++];
    const ours: string[] = [];
    while (i < lines.length && !lines[i].startsWith("=======")) ours.push(lines[i++]);
    if (i >= lines.length) {
      segments.push({ kind: "text", text: [header, ...ours].join("") });
      break;
    }
    i++;
    const theirs: string[] = [];
    while (i < lines.length && !lines[i].startsWith(">>>>>>>")) theirs.push(lines[i++]);
    if (i >= lines.length) {
      segments.push({ kind: "text", text: [header, ...ours, "=======\n", ...theirs].join("") });
      break;
    }
    const footer = lines[i++];
    segments.push({ kind: "conflict", id: id++, header, ours: ours.join(""), theirs: theirs.join(""), footer });
  }
  return segments;
}

function fakePatch(path: string, ours: string, theirs: string): string {
  const oldLines = linesOf(ours);
  const newLines = linesOf(theirs);
  const removed = oldLines.map((line) => `-${line}`).join("");
  const added = newLines.map((line) => `+${line}`).join("");
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)} @@`, `${removed}${added}`].join("\n");
}

function MiniDiffPane(props: { side: "left" | "right"; rows: SideBySideRow[] }) {
  return (
    <div class={`conflict-diff-pane conflict-diff-pane-${props.side}`}>
      <table class="file-diff-table">
        <tbody>
          <For each={props.rows}>
            {(row) => {
              if (row.kind === "hunk") {
                return (
                  <tr class="diff-hunk">
                    <td colSpan={2}>{props.side === "left" ? row.header : ""}</td>
                  </tr>
                );
              }
              const cell: DiffCell | null = props.side === "left" ? row.left : row.right;
              const kind = cell ? `diff-${cell.kind}` : "diff-empty";
              return (
                <tr>
                  <td class={`diff-num ${kind}`}>{cell?.number || ""}</td>
                  <td class={`diff-code ${kind}`}>{cell?.text}</td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ChunkDiff(props: { path: string; ours: string; theirs: string }) {
  const rows = createMemo(() => buildSideBySideRows(parse(fakePatch(props.path, props.ours, props.theirs)).flatMap((file) => file.blocks)));
  return (
    <div class="conflict-chunk-diff">
      <MiniDiffPane side="left" rows={rows()} />
      <MiniDiffPane side="right" rows={rows()} />
    </div>
  );
}

function statusText(file: ConflictFile): string {
  return file.status.replace(/_/g, " ");
}

function continueCommand(operation: string | null): string {
  if (operation === "rebase") return "git rebase --continue";
  if (operation === "cherry-pick") return "git cherry-pick --continue";
  if (operation === "revert") return "git revert --continue";
  return "git merge --continue";
}

export function ConflictsPanel(props: { repoId: string }) {
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [resolutions, setResolutions] = createSignal<Record<number, Resolution>>({});
  const [applying, setApplying] = createSignal(false);

  const state = () => conflictStateForRepo(props.repoId);
  const files = () => state().files;
  const selectedFile = createMemo(() => files().find((file) => file.path === selectedPath()) ?? files()[0] ?? null);

  createEffect(() => {
    const current = selectedPath();
    if (!current || !files().some((file) => file.path === current)) {
      setSelectedPath(files()[0]?.path ?? null);
    }
  });

  const [content] = createResource(
    () => selectedFile()?.path ? { repoId: props.repoId, path: selectedFile()!.path } : null,
    ({ repoId, path }) => fetchConflictContent(repoId, path),
  );

  createEffect(() => {
    selectedPath();
    setResolutions({});
    setApplying(false);
  });

  const segments = createMemo(() => parseConflictMarkers(content()?.worktree ?? ""));
  const conflicts = createMemo(() => segments().filter((segment): segment is ConflictSegment => segment.kind === "conflict"));
  const resolvedCount = createMemo(() => conflicts().filter((segment) => resolutions()[segment.id]).length);
  const canComplete = createMemo(() => conflicts().length > 0 && resolvedCount() === conflicts().length && !/^(<<<<<<<|=======|>>>>>>>)/m.test(resolvedText()));

  const resolutionText = (segment: ConflictSegment) => resolutions()[segment.id]?.text ?? "";
  const choose = (segment: ConflictSegment, mode: Resolution["mode"], text: string) => {
    setResolutions((prev) => ({ ...prev, [segment.id]: { mode, text } }));
  };

  function resolvedText(): string {
    return segments()
      .map((segment) => {
        if (segment.kind === "text") return segment.text;
        return resolutions()[segment.id]?.text ?? `${segment.header}${segment.ours}=======\n${segment.theirs}${segment.footer}`;
      })
      .join("");
  }

  const completeFile = async () => {
    const file = selectedFile();
    if (!file || !canComplete() || applying()) return;
    setApplying(true);
    try {
      const token = await createConflictToken(props.repoId, file.path, resolvedText());
      const applyCommand = gitJugglerTerminalCommand(["resolve-file", "--token", token, "--path", file.path]);
      runInTerminal(props.repoId, `${applyCommand} && git add -- ${shellQuote(file.path)}`);
      scheduleGraphRefresh(props.repoId);
    } finally {
      setApplying(false);
    }
  };

  const continueMerge = () => {
    runInTerminal(props.repoId, continueCommand(state().operation));
    scheduleCommitRefresh(props.repoId);
  };

  return (
    <div class="conflicts-panel">
      <div class="conflicts-sidebar">
        <div class="conflicts-title">Conflicts</div>
        <Show when={files().length > 0} fallback={<div class="conflicts-empty">No unresolved files.</div>}>
          <For each={files()}>
            {(file) => (
              <button type="button" class="conflict-file" classList={{ active: selectedFile()?.path === file.path }} onClick={() => setSelectedPath(file.path)}>
                <span class="conflict-file-name">{file.path}</span>
                <span class="conflict-file-status">{statusText(file)}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
      <div class="conflicts-main">
        <Show when={state().operation || files().length > 0} fallback={<div class="conflicts-message">This repo is not in a conflict state.</div>}>
          <div class="conflicts-toolbar">
            <span>{state().operation ? `${state().operation} in progress` : "Conflict state"}</span>
            <button type="button" class="menu-primary-button" disabled={!state().can_continue} onClick={continueMerge}>
              Continue {state().operation ?? "merge"}
            </button>
          </div>
          <Switch>
            <Match when={state().can_continue && files().length === 0}>
              <div class="conflicts-message">All files are resolved. Continue the operation when ready.</div>
            </Match>
            <Match when={content.loading}>
              <div class="conflicts-message">Loading conflict…</div>
            </Match>
            <Match when={content.error || !content()}>
              <div class="conflicts-message">Could not load this conflict.</div>
            </Match>
            <Match when={content()?.binary || content()?.too_large}>
              <div class="conflicts-message">This file is binary or too large for the first merge-editor iteration. Resolve it in the terminal, then stage it.</div>
            </Match>
            <Match when={conflicts().length === 0}>
              <div class="conflicts-message">No conflict markers found in this file. Stage it from the terminal when it is resolved.</div>
            </Match>
            <Match when={content()}>
              <div class="conflict-editor">
                <div class="conflict-editor-header">
                  <span>{selectedFile()?.path}</span>
                  <span>{resolvedCount()} / {conflicts().length} chunks resolved</span>
                  <button type="button" class="menu-primary-button" disabled={!canComplete() || applying()} onClick={completeFile}>
                    Complete file
                  </button>
                </div>
                <div class="conflict-chunks">
                  <For each={conflicts()}>
                    {(segment, index) => (
                      <section class="conflict-chunk">
                        <div class="conflict-chunk-header">
                          <span>Chunk {index() + 1}</span>
                          <div class="conflict-chunk-actions">
                            <button type="button" class="menu-secondary-button" onClick={() => choose(segment, "ours", segment.ours)}>Use ours</button>
                            <button type="button" class="menu-secondary-button" onClick={() => choose(segment, "theirs", segment.theirs)}>Use theirs</button>
                            <button type="button" class="menu-secondary-button" onClick={() => choose(segment, "both", `${segment.ours}${segment.theirs}`)}>Use both</button>
                            <button type="button" class="menu-secondary-button" onClick={() => choose(segment, "edit", resolutions()[segment.id]?.text ?? segment.ours)}>Edit</button>
                          </div>
                        </div>
                        <ChunkDiff path={selectedFile()?.path ?? "conflict"} ours={segment.ours} theirs={segment.theirs} />
                        <Show when={resolutions()[segment.id]?.mode === "edit"}>
                          <textarea class="conflict-edit" value={resolutionText(segment)} onInput={(e) => choose(segment, "edit", e.currentTarget.value)} />
                        </Show>
                        <Show when={resolutions()[segment.id]}>
                          {(resolution) => <div class="conflict-choice">Selected: {resolution().mode}</div>}
                        </Show>
                      </section>
                    )}
                  </For>
                </div>
              </div>
            </Match>
          </Switch>
        </Show>
      </div>
    </div>
  );
}

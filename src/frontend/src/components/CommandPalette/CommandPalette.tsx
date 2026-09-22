import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import type { MenuSection } from "../../state/store";
import { KEY_BINDING_ACTIONS, closeCommandPalette, commandPaletteOpen, openMenu, openRepoTab, repos } from "../../state/store";

interface SettingEntry {
  label: string;
  section: MenuSection;
  sectionLabel: string;
}

const SECTION_LABELS: Record<MenuSection, string> = {
  repos: "Repos",
  appearance: "Appearance",
  github: "GitHub Actions",
  jenkins: "Jenkins",
  agents: "Agents",
  keybindings: "Key bindings",
  configuration: "Configuration",
};

// Every menu section plus its individual settings, so the palette can search
// "settings names" the same way it searches repositories. Kept as a flat,
// static list rather than deep-linking to a field inside a section — landing
// on the right section (scrolled/visible) is enough for a search shortcut.
const SETTINGS_ENTRIES: SettingEntry[] = [
  ...(Object.keys(SECTION_LABELS) as MenuSection[]).map((section) => ({ label: SECTION_LABELS[section], section, sectionLabel: SECTION_LABELS[section] })),
  { label: "Search paths", section: "repos", sectionLabel: SECTION_LABELS.repos },
  { label: "Theme", section: "appearance", sectionLabel: SECTION_LABELS.appearance },
  { label: "Branch colors", section: "appearance", sectionLabel: SECTION_LABELS.appearance },
  { label: "Reset onboarding", section: "configuration", sectionLabel: SECTION_LABELS.configuration },
  ...KEY_BINDING_ACTIONS.map((action) => ({ label: action.label, section: "keybindings" as MenuSection, sectionLabel: SECTION_LABELS.keybindings })),
];

type ResultItem =
  | { kind: "setting"; key: string; entry: SettingEntry }
  | { kind: "repo"; key: string; repo: ReturnType<typeof repos>[number] };

export function CommandPalette() {
  return (
    <Show when={commandPaletteOpen()}>
      <CommandPaletteDialog />
    </Show>
  );
}

// A separate component (rather than inlining the dialog in the Show above)
// so it fully remounts each time the palette opens: query, selection and
// focus all start fresh instead of carrying over from the previous session.
function CommandPaletteDialog() {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  const results = createMemo<ResultItem[]>(() => {
    const q = query().trim().toLowerCase();
    const settingMatches: ResultItem[] = SETTINGS_ENTRIES.filter(
      (entry) => !q || entry.label.toLowerCase().includes(q) || entry.sectionLabel.toLowerCase().includes(q),
    ).map((entry, i) => ({ kind: "setting", key: `setting-${i}-${entry.label}`, entry }));
    const repoMatches: ResultItem[] = repos()
      .filter((repo) => !q || repo.name.toLowerCase().includes(q) || repo.path.toLowerCase().includes(q))
      .map((repo) => ({ kind: "repo", key: `repo-${repo.id}`, repo }));
    return [...settingMatches, ...repoMatches];
  });

  const selectItem = (item: ResultItem) => {
    if (item.kind === "setting") {
      openMenu(item.entry.section);
    } else {
      openRepoTab(item.repo.id, item.repo.name);
    }
    closeCommandPalette();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = results();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex()];
      if (item) selectItem(item);
    }
  };

  return (
    <div class="command-palette-overlay" onClick={closeCommandPalette}>
      <div class="command-palette-dialog" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          class="command-palette-input"
          placeholder="Search settings and repositories…"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div class="command-palette-results">
          <For each={results()} fallback={<div class="menu-empty">No matches</div>}>
            {(item, index) => (
              <div
                class="command-palette-item"
                classList={{ active: index() === selectedIndex() }}
                onMouseEnter={() => setSelectedIndex(index())}
                onClick={() => selectItem(item)}
              >
                <Show when={item.kind === "setting" && item}>
                  {(setting) => (
                    <>
                      <span class="command-palette-item-label">{setting().entry.label}</span>
                      <span class="command-palette-item-meta">{setting().entry.sectionLabel}</span>
                    </>
                  )}
                </Show>
                <Show when={item.kind === "repo" && item}>
                  {(repoItem) => (
                    <>
                      <span class="command-palette-item-label">{repoItem().repo.name}</span>
                      <span class="command-palette-item-meta">{repoItem().repo.path}</span>
                    </>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

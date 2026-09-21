import { branchColorMode } from "../../state/store";
import { activeTheme } from "../../state/themes";

// 6-color palette that comes from the active theme (VS Code chart/terminal
// colors, or the built-in defaults) — each branch is mapped to one of these
// based on a hash of its name. Used consistently for the graph lines/dots AND
// the branch badge, so a user can visually connect a badge to its lane.
// Tags use the theme's dim text color, never part of the branch palette.
export const tagColor = (): string => activeTheme().tagColor;

// Sequential mode remembers each branch's palette *index* (not the color), so
// a theme switch recolors branches without reshuffling them.
const sequentialIndexByBranch = new Map<string, number>();

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function colorKeyForBranch(name: string): string {
  const slash = name.indexOf("/");
  return slash > 0 && slash < name.length - 1 ? name.slice(slash + 1) : name;
}

export function colorForBranch(name: string): string {
  const palette = activeTheme().branchPalette;
  const colorKey = colorKeyForBranch(name);
  if (branchColorMode() === "sequential") {
    let index = sequentialIndexByBranch.get(colorKey);
    if (index === undefined) {
      index = sequentialIndexByBranch.size % palette.length;
      sequentialIndexByBranch.set(colorKey, index);
    }
    return palette[index];
  }

  return palette[hashString(colorKey) % palette.length];
}

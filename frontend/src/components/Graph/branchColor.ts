import { dynamicBranchColors } from "../../state/store";

// 6-color palette (for now) — each branch is mapped to one of these based on
// a hash of its name. Used consistently for the graph lines/dots AND the
// branch badge, so a user can visually connect a badge to its lane.
export const BRANCH_PALETTE = [
  "#4C9AFF", // blue
  "#36B37E", // green
  "#FFAB00", // amber
  "#FF5630", // red-orange
  "#9C6ADE", // purple
  "#00B8D9", // teal
];

// Used for every branch when "dynamic branch colors" is turned off.
export const STATIC_BRANCH_COLOR = "#4C9AFF";

// Tags are always gray, never part of the branch palette.
export const TAG_COLOR = "#8993A4";

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function colorForBranch(name: string): string {
  if (!dynamicBranchColors()) return STATIC_BRANCH_COLOR;
  const index = hashString(name) % BRANCH_PALETTE.length;
  return BRANCH_PALETTE[index];
}

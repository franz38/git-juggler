export const FULL_LANE_WIDTH = 24;
export const MIN_LANE_WIDTH = FULL_LANE_WIDTH / 2;

// Up to this many lanes the graph keeps its full lane width.
const FULL_WIDTH_MAX_LANES = 5;
// From here on the lanes stay at the minimum (half) width.
const MIN_WIDTH_LANES = 10;

// Horizontal spacing between lanes, shrinking linearly from the full width at
// 5 lanes to half of it at 10 lanes (and staying there for more), so a graph
// with many branches doesn't grow ever wider.
export function laneWidthFor(laneCount: number): number {
  if (laneCount <= FULL_WIDTH_MAX_LANES) return FULL_LANE_WIDTH;
  if (laneCount >= MIN_WIDTH_LANES) return MIN_LANE_WIDTH;
  const progress = (laneCount - FULL_WIDTH_MAX_LANES) / (MIN_WIDTH_LANES - FULL_WIDTH_MAX_LANES);
  return FULL_LANE_WIDTH - progress * (FULL_LANE_WIDTH - MIN_LANE_WIDTH);
}

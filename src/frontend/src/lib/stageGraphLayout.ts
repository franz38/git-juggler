import type { CiStage, CiStageStatus } from "../api/types";
import { currentStageIndex } from "./stageWindow.ts";

// Geometry of the commit hover graph (an SVG), computed here so it can be
// tested and animated: every item has a centre x, and the hovered step widens
// its slot to make room for its name, pushing everything after it aside.
//
//   [n jobs completed] - current job - step 1 - ... - step n - next job - [x jobs missing]
//
// with a fake "End" job after the current one when it is the last job.

export const CY = 14; // y of every circle's centre
export const BIG_R = 9;
export const STEP_R = 3;
export const HEIGHT = 54;

const JOB_SLOT = 72;
const SUMMARY_SLOT = 100;
const END_SLOT = 56;
const STEP_SLOT = 24;
const STEP_LABEL_PADDING = 16;
const CHAR_WIDTH = 5.6; // rough width of a 10px label, to size the hovered step's slot

export type GraphItem =
  | { kind: "summary"; caption: string; count: number; status: CiStageStatus; x: number; width: number; r: number }
  | { kind: "job"; stage: CiStage; current: boolean; x: number; width: number; r: number }
  | { kind: "step"; step: CiStage; index: number; hovered: boolean; x: number; width: number; r: number }
  | { kind: "end"; lit: boolean; x: number; width: number; r: number };

/** A connector between two neighbouring items, edge to edge, coloured by the one on its left. */
export interface GraphLink {
  x1: number;
  x2: number;
  status: CiStageStatus;
}

export interface GraphLayout {
  width: number;
  height: number;
  items: GraphItem[];
  links: GraphLink[];
}

export interface LayoutInput {
  stages: CiStage[];
  runStatus?: string;
  /** Index (within the current job's steps) of the step being hovered. */
  hoveredStep?: number | null;
}

type Draft =
  | { kind: "summary"; caption: string; count: number; status: CiStageStatus; width: number; r: number; edge: CiStageStatus }
  | { kind: "job"; stage: CiStage; current: boolean; width: number; r: number; edge: CiStageStatus }
  | { kind: "step"; step: CiStage; index: number; hovered: boolean; width: number; r: number; edge: CiStageStatus }
  | { kind: "end"; lit: boolean; width: number; r: number; edge: CiStageStatus };

/** An item that is still waiting: pending jobs and steps, the "missing" summary, and an End that isn't lit. */
function notStarted(draft: Draft): boolean {
  switch (draft.kind) {
    case "job":
      return draft.stage.status === "pending";
    case "step":
      return draft.step.status === "pending";
    case "summary":
      return draft.status === "pending";
    case "end":
      return !draft.lit;
  }
}

export function layoutStageGraph(input: LayoutInput): GraphLayout {
  const { stages, runStatus, hoveredStep = null } = input;
  const currentIndex = currentStageIndex(stages);
  if (currentIndex < 0) return { width: 0, height: HEIGHT, items: [], links: [] };

  const job = stages[currentIndex];
  const next = stages[currentIndex + 1];
  const steps = job.steps ?? [];
  const completed = currentIndex;
  const missing = next ? stages.length - (currentIndex + 2) : 0;

  const drafts: Draft[] = [];
  if (completed > 0) {
    drafts.push({ kind: "summary", caption: `${completed} ${completed === 1 ? "job" : "jobs"} completed`, count: completed, status: "success", width: SUMMARY_SLOT, r: BIG_R, edge: "success" });
  }
  // A running current job is drawn green (with a spinner), so its connector is green too.
  drafts.push({ kind: "job", stage: job, current: true, width: JOB_SLOT, r: BIG_R, edge: job.status === "running" ? "success" : job.status });
  steps.forEach((step, index) => {
    const hovered = hoveredStep === index;
    const width = hovered ? Math.max(STEP_SLOT, step.name.length * CHAR_WIDTH + STEP_LABEL_PADDING) : STEP_SLOT;
    drafts.push({ kind: "step", step, index, hovered, width, r: STEP_R, edge: step.status });
  });
  if (next) drafts.push({ kind: "job", stage: next, current: false, width: JOB_SLOT, r: BIG_R, edge: next.status });
  else drafts.push({ kind: "end", lit: runStatus === "success", width: END_SLOT, r: BIG_R, edge: "pending" });
  if (missing > 0) {
    drafts.push({ kind: "summary", caption: `${missing} ${missing === 1 ? "job" : "jobs"} missing`, count: missing, status: "pending", width: SUMMARY_SLOT, r: BIG_R, edge: "pending" });
  }

  const items: GraphItem[] = [];
  let cursor = 0;
  for (const draft of drafts) {
    const { edge: _edge, ...rest } = draft;
    items.push({ ...rest, x: cursor + draft.width / 2 } as GraphItem);
    cursor += draft.width;
  }

  // Each connector runs from the edge of one circle to the edge of the next and
  // takes the colour of the item on its left, except that one leading into
  // something that hasn't started stays gray.
  const links: GraphLink[] = [];
  for (let i = 0; i + 1 < items.length; i++) {
    const status = notStarted(drafts[i + 1]) ? "pending" : drafts[i].edge;
    links.push({ x1: items[i].x + items[i].r, x2: items[i + 1].x - items[i + 1].r, status });
  }

  return { width: cursor, height: HEIGHT, items, links };
}

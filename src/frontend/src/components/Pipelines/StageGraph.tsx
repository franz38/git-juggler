import { Index, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { CiStage } from "../../api/types";
import { BIG_R, CY, STEP_R, layoutStageGraph, type GraphItem } from "../../lib/stageGraphLayout";
import { elapsedMs } from "../../lib/stageWindow";
import { formatDuration, statusColor, statusMark } from "../Badges/ciStatus";

const NAME_MAX_CHARS = 12;

const shorten = (name: string): string => (name.length > NAME_MAX_CHARS ? `${name.slice(0, NAME_MAX_CHARS - 1)}…` : name);

const timing = (stage: CiStage): string | null => {
  if (stage.status === "pending") return null;
  const elapsed = elapsedMs(stage.status, stage.started_at, Date.now());
  if (elapsed !== null) return formatDuration(elapsed);
  return stage.duration_ms !== null ? formatDuration(stage.duration_ms) : null;
};

function JobNode(props: { stage: CiStage; current: boolean }) {
  // The job being worked on is green with a spinner inside; any other job (or a
  // current one that has already finished) shows its own status.
  const spinning = () => props.current && props.stage.status === "running";
  const color = () => (spinning() ? statusColor.success : statusColor[props.stage.status]);
  return (
    <g class="stage-graph-job" classList={{ current: props.current, pending: props.stage.status === "pending" }}>
      <title>{`${props.stage.name}: ${props.stage.status}`}</title>
      <circle class="stage-graph-ring" classList={{ running: props.stage.status === "running" && !spinning() }} cy={CY} r={BIG_R} style={{ stroke: color() }} />
      <Show
        when={spinning()}
        fallback={
          <text class="stage-graph-mark" y={CY} style={{ fill: color() }}>
            {statusMark(props.stage.status)}
          </text>
        }
      >
        <circle class="stage-graph-spinner" cy={CY} r={BIG_R - 4} style={{ stroke: color() }} />
      </Show>
      <text class="stage-graph-name" y={CY + 22}>
        {shorten(props.stage.name)}
      </text>
      <text class="stage-graph-time" y={CY + 34}>
        {timing(props.stage) ?? ""}
      </text>
    </g>
  );
}

function SummaryNode(props: { item: Extract<GraphItem, { kind: "summary" }> }) {
  const color = () => statusColor[props.item.status];
  return (
    <g class="stage-graph-summary" classList={{ pending: props.item.status === "pending" }}>
      <title>{props.item.caption}</title>
      <circle class="stage-graph-ring" cy={CY} r={BIG_R} style={{ stroke: color() }} />
      <text class="stage-graph-mark" y={CY} style={{ fill: color() }}>
        {statusMark(props.item.status)}
      </text>
      <text class="stage-graph-name" y={CY + 22}>
        {props.item.caption}
      </text>
    </g>
  );
}

function EndNode(props: { lit: boolean }) {
  const color = () => (props.lit ? statusColor.success : statusColor.pending);
  return (
    <g class="stage-graph-job" classList={{ pending: !props.lit }}>
      <title>End</title>
      <circle class="stage-graph-ring" cy={CY} r={BIG_R} style={{ stroke: color() }} />
      <text class="stage-graph-mark" y={CY} style={{ fill: color() }}>
        ■
      </text>
      <text class="stage-graph-name" y={CY + 22}>
        End
      </text>
    </g>
  );
}

function StepNode(props: { item: Extract<GraphItem, { kind: "step" }>; onHover: (index: number | null) => void }) {
  const color = () => statusColor[props.item.step.status];
  const pending = () => props.item.step.status === "pending";
  return (
    <g class="stage-graph-step" onMouseEnter={() => props.onHover(props.item.index)} onMouseLeave={() => props.onHover(null)}>
      <title>{`${props.item.step.name}: ${props.item.step.status}`}</title>
      {/* Transparent hit area: the whole slot, so the pointer can rest anywhere in it. */}
      <rect class="stage-graph-hit" x={-props.item.width / 2} width={props.item.width} y={0} height={CY + 26} />
      <circle
        class="stage-graph-step-dot"
        classList={{ running: props.item.step.status === "running", pending: pending(), hovered: props.item.hovered }}
        cy={CY}
        r={STEP_R}
        style={{ stroke: color(), fill: pending() ? "transparent" : color() }}
      />
      <text class="stage-graph-step-name" classList={{ shown: props.item.hovered }} y={CY + 16}>
        {props.item.step.name}
      </text>
    </g>
  );
}

/**
 * The left-to-right chain of a run, drawn as an SVG:
 *
 *   n jobs completed → current job → step 1 … step n → next job → x jobs missing
 *
 * Every element is linked to its neighbours. The current job is green with a
 * spinner while it runs; when it is the last job the chain ends in a fake "End"
 * circle, green once the run (`runStatus`) has succeeded. Hovering a step shows
 * its name underneath and widens its slot, sliding the rest of the chain aside.
 */
export function StageGraph(props: { stages: CiStage[]; runStatus?: string }) {
  const [hoveredStep, setHoveredStep] = createSignal<number | null>(null);
  const layout = createMemo(() => layoutStageGraph({ stages: props.stages, runStatus: props.runStatus, hoveredStep: hoveredStep() }));

  return (
    <Show when={layout().items.length > 0}>
      <svg
        class="stage-graph"
        viewBox={`0 0 ${layout().width} ${layout().height}`}
        style={{ width: `${layout().width}px`, height: `${layout().height}px` }}
        role="img"
        aria-label="Pipeline progress"
      >
        {/* <Index> keeps each element's DOM node across layouts, so moving it animates. */}
        <Index each={layout().links}>
          {(link) => (
            <rect
              class="stage-graph-link"
              y={CY - 1}
              height={2}
              rx={1}
              style={{ transform: `translateX(${link().x1}px)`, width: `${link().x2 - link().x1}px`, fill: statusColor[link().status] }}
            />
          )}
        </Index>
        <Index each={layout().items}>
          {(item) => (
            <g class="stage-graph-item" style={{ transform: `translateX(${item().x}px)` }}>
              <Switch>
                <Match when={item().kind === "job" && (item() as Extract<GraphItem, { kind: "job" }>)}>
                  {(job) => <JobNode stage={job().stage} current={job().current} />}
                </Match>
                <Match when={item().kind === "summary" && (item() as Extract<GraphItem, { kind: "summary" }>)}>
                  {(summary) => <SummaryNode item={summary()} />}
                </Match>
                <Match when={item().kind === "step" && (item() as Extract<GraphItem, { kind: "step" }>)}>
                  {(step) => <StepNode item={step()} onHover={setHoveredStep} />}
                </Match>
                <Match when={item().kind === "end" && (item() as Extract<GraphItem, { kind: "end" }>)}>
                  {(end) => <EndNode lit={end().lit} />}
                </Match>
              </Switch>
            </g>
          )}
        </Index>
      </svg>
    </Show>
  );
}

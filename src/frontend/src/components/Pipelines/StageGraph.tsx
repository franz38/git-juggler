import { For, Show } from "solid-js";
import type { CiStage } from "../../api/types";
import { currentStageIndex, elapsedMs, windowStages } from "../../lib/stageWindow";
import { formatDuration, statusColor, statusMark } from "../Badges/ciStatus";

/**
 * A left-to-right graph of a run's stages: a node per stage joined by
 * connectors, showing at most four (the current stage, the one before it and
 * the next two). Stages outside the window collapse into a "+N" marker.
 */
export function StageGraph(props: { stages: CiStage[] }) {
  const current = () => currentStageIndex(props.stages);
  const window = () => windowStages(props.stages.length, current());
  const visible = () => props.stages.slice(window().start, window().end);

  // A connector takes the colour of the stage before it.
  const linkColor = (absoluteIndex: number) => statusColor[props.stages[absoluteIndex - 1]?.status ?? "pending"];

  const timing = (stage: CiStage): string | null => {
    if (stage.status === "pending") return null;
    const elapsed = elapsedMs(stage.status, stage.started_at, Date.now());
    if (elapsed !== null) return formatDuration(elapsed);
    return stage.duration_ms !== null ? formatDuration(stage.duration_ms) : null;
  };

  return (
    <div class="stage-graph">
      <Show when={window().hiddenBefore > 0}>
        <span class="stage-graph-more" title={`${window().hiddenBefore} earlier stages`}>
          +{window().hiddenBefore}
        </span>
      </Show>
      <For each={visible()}>
        {(stage, index) => {
          const absoluteIndex = () => window().start + index();
          return (
            <>
              <Show when={index() > 0 || window().hiddenBefore > 0}>
                <span class="stage-graph-link" style={{ background: linkColor(absoluteIndex()) }} />
              </Show>
              <span
                class="stage-graph-node"
                classList={{ current: absoluteIndex() === current(), pending: stage.status === "pending" }}
                title={`${stage.name}: ${stage.status}`}
              >
                <span
                  class="stage-graph-dot"
                  classList={{ running: stage.status === "running" }}
                  style={{ "border-color": statusColor[stage.status], color: statusColor[stage.status] }}
                >
                  {statusMark(stage.status)}
                </span>
                <span class="stage-graph-name">{stage.name}</span>
                <span class="stage-graph-time">{timing(stage) ?? " "}</span>
              </span>
            </>
          );
        }}
      </For>
      <Show when={window().hiddenAfter > 0}>
        <span class="stage-graph-link" style={{ background: linkColor(window().end) }} />
        <span class="stage-graph-more" title={`${window().hiddenAfter} later stages`}>
          +{window().hiddenAfter}
        </span>
      </Show>
    </div>
  );
}

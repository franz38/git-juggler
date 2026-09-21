import { For, Show } from "solid-js";
import type { CiStage } from "../../api/types";
import { formatDuration, isStageFinished, statusColor, statusMark } from "../Badges/ciStatus";

/** "2/4 stages" style progress: how many stages are done. */
export function finishedStageCount(stages: CiStage[]): number {
  return stages.filter((stage) => isStageFinished(stage.status)).length;
}

/**
 * The stages of a run in order, e.g. `✓ Build → ✓ Test → ● Deploy → ○ Release`,
 * each with its duration when known. With `showSteps`, a stage's steps (GitHub
 * jobs have them) are listed under it.
 */
export function StageStrip(props: { stages: CiStage[]; showSteps?: boolean }) {
  return (
    <div class="stage-strip">
      <div class="stage-strip-row">
        <For each={props.stages}>
          {(stage, index) => (
            <>
              <Show when={index() > 0}>
                <span class="stage-arrow">→</span>
              </Show>
              <span class="stage-chip" classList={{ pending: stage.status === "pending" }} title={`${stage.name}: ${stage.status}`}>
                <span class="stage-mark" style={{ color: statusColor[stage.status] }}>
                  {statusMark(stage.status)}
                </span>
                <span class="stage-name">{stage.name}</span>
                <Show when={stage.duration_ms !== null && stage.status !== "pending"}>
                  <span class="stage-duration">{formatDuration(stage.duration_ms)}</span>
                </Show>
              </span>
            </>
          )}
        </For>
      </div>
      <Show when={props.showSteps}>
        <For each={props.stages.filter((stage) => stage.steps?.length)}>
          {(stage) => (
            <details class="stage-steps">
              <summary>
                {stage.name} · {finishedStageCount(stage.steps ?? [])}/{stage.steps?.length} steps
              </summary>
              <For each={stage.steps}>
                {(step) => (
                  <div class="stage-step">
                    <span class="stage-mark" style={{ color: statusColor[step.status] }}>
                      {statusMark(step.status)}
                    </span>
                    <span class="stage-name">{step.name}</span>
                    <Show when={step.duration_ms !== null && step.status !== "pending"}>
                      <span class="stage-duration">{formatDuration(step.duration_ms)}</span>
                    </Show>
                  </div>
                )}
              </For>
            </details>
          )}
        </For>
      </Show>
    </div>
  );
}

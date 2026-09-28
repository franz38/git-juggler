import { For, Show, createMemo } from "solid-js";
import type { ActivePipeline } from "../../api/types";
import { PIPELINE_POLL_MS, pipelines, pipelinesError, pipelinesLoaded } from "../../state/store";
import { ProviderIcon, formatDuration, isStageFinished, providerName, statusColor, statusMark } from "../Badges/ciStatus";
import { StageStrip, finishedStageCount } from "./StageStrip";

function elapsedMs(pipeline: ActivePipeline): number | null {
  const created = pipeline.run.created_at;
  if (!created) return null;
  return Math.max(0, Date.now() - new Date(created).getTime());
}

function PipelineCard(props: { pipeline: ActivePipeline }) {
  const run = () => props.pipeline.run;
  const stages = () => run().stages;
  return (
    <div class="pipeline-card">
      <a class="pipeline-title" href={run().url} target="_blank" rel="noopener noreferrer" title={providerName(run().provider)}>
        <span class="pipeline-icon">
          <ProviderIcon run={run()} />
        </span>
        <span class="pipeline-name">
          {run().name} #{run().number}
        </span>
        <span class="pipeline-status" style={{ color: statusColor[run().status] }}>
          {statusMark(run().status)} {run().status}
        </span>
      </a>
      <div class="pipeline-meta">
        {run().branch ?? "n/a"}
        <Show when={run().event}> · {run().event}</Show>
        <Show
          when={isStageFinished(run().status)}
          fallback={<Show when={elapsedMs(props.pipeline) !== null}> · running {formatDuration(elapsedMs(props.pipeline))}</Show>}
        >
          <Show when={run().duration_ms != null}> · took {formatDuration(run().duration_ms ?? null)}</Show>
        </Show>
        <Show when={stages()?.length}> · {finishedStageCount(stages() ?? [])}/{stages()?.length} stages done</Show>
      </div>
      <Show when={stages()?.length} fallback={<div class="pipeline-meta">Stage detail unavailable</div>}>
        <StageStrip stages={stages() ?? []} showSteps />
      </Show>
    </div>
  );
}

// Lists the most recent pipelines (running or finished) across all repos,
// newest first. Data comes from `pipelines`, which App polls only while this
// tab is open.
export function PipelinesPanel() {
  const runningCount = createMemo(() => pipelines().filter((item) => !isStageFinished(item.run.status)).length);
  const groups = createMemo(() => {
    const byRepo = new Map<string, { name: string; items: ActivePipeline[] }>();
    for (const item of pipelines()) {
      const group = byRepo.get(item.repo_id) ?? { name: item.repo_name, items: [] };
      group.items.push(item);
      byRepo.set(item.repo_id, group);
    }
    return [...byRepo.entries()].map(([id, group]) => ({ id, ...group }));
  });

  return (
    <section class="pipelines-panel">
      <div class="agent-activity-heading">
        <span>Recent pipelines</span>
        <span class="agent-scan-time">live · every {PIPELINE_POLL_MS / 1000}s</span>
      </div>
      <Show when={pipelinesError()}>
        <div class="agent-error">{pipelinesError()}</div>
      </Show>
      <Show when={pipelinesLoaded()} fallback={<Show when={!pipelinesError()}><div class="agent-empty">Loading…</div></Show>}>
        <div class="agent-results">
          <div class="agent-summary">
            Last {pipelines().length} pipeline{pipelines().length === 1 ? "" : "s"} · {runningCount()} running
          </div>
          <For each={groups()} fallback={<div class="agent-empty">No pipelines yet</div>}>
            {(group) => (
              <div class="agent-scan-card">
                <div class="agent-scan-title">{group.name}</div>
                <For each={group.items}>{(pipeline) => <PipelineCard pipeline={pipeline} />}</For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

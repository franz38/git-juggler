import { For, Show } from "solid-js";
import type { CiRunInfo } from "../../api/types";
import { formatDate } from "../../lib/formatDate";
import { activeRepo, loadRunStages, runStages, runStagesKey } from "../../state/store";
import { StageStrip, finishedStageCount } from "../Pipelines/StageStrip";
import { ProviderIcon, formatDuration, providerName, statusColor, statusMark, statusPriority } from "./ciStatus";

function pickRun(runs: CiRunInfo[]): CiRunInfo {
  return [...runs].sort((a, b) => statusPriority[a.status] - statusPriority[b.status])[0];
}

export function CiRunBadge(props: { runs: CiRunInfo[] }) {
  const run = () => pickRun(props.runs);
  const color = () => statusColor[run().status];

  const openRun = (event: MouseEvent) => {
    event.stopPropagation();
    const url = run().url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  // Stage detail is fetched the first time the badge is hovered (and again on
  // later hovers while the run is still going).
  const loadStages = () => {
    const repo = activeRepo();
    if (!repo) return;
    for (const item of props.runs) void loadRunStages(repo, item);
  };

  return (
    <span class="ci-run-badge" onClick={openRun} onMouseEnter={loadStages}>
      <span class="ci-run-icon">
        <ProviderIcon run={run()} />
      </span>
      <span class="ci-run-status" style={{ color: color() }}>
        {statusMark(run().status)}
      </span>
      <span class="ci-run-tooltip">
        <span class="ci-run-summary">{props.runs.length} CI run{props.runs.length === 1 ? "" : "s"}</span>
        <For each={props.runs}>
          {(item) => {
            const stages = () => runStages()[runStagesKey(item)];
            return (
              <span class="ci-run-item">
                <span class="ci-run-title">
                  {providerName(item.provider)}: {item.name} #{item.number}
                </span>
                <span>Status: {item.status}</span>
                <span>Branch: {item.branch ?? "n/a"}</span>
                <span>Event: {item.event ?? "n/a"}</span>
                <span>Updated: {item.updated_at ? formatDate(item.updated_at) : item.created_at ? formatDate(item.created_at) : "n/a"}</span>
                <span>Duration: {formatDuration(item.duration_ms)}</span>
                <Show when={stages()?.length}>
                  <span>Stages: {finishedStageCount(stages() ?? [])}/{stages()?.length} done</span>
                  <StageStrip stages={stages() ?? []} />
                </Show>
              </span>
            );
          }}
        </For>
      </span>
    </span>
  );
}

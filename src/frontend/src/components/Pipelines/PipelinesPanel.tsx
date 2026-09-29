import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { ActivePipeline, CiRunInfo, CiStage, CiStageStatus } from "../../api/types";
import { PIPELINE_POLL_MS, pipelines, pipelinesError, pipelinesLoaded } from "../../state/store";
import { formatAge } from "../Agents/agentFormat";
import { ProviderIcon, isStageFinished, providerName, statusColor } from "../Badges/ciStatus";
import { Disclosure, EmptyNote, GroupHeading, Hoverable, LiveDot, MONO, PanelButton, PanelHeader, Segmented } from "../Sidebar/panelKit";

/* Recent pipelines sidebar panel: compact rows with a stage strip, expandable
   to per-stage timing bars. Colors come from the theme variables. */

type Filter = "all" | "running" | "failed";

const GLYPH: Partial<Record<CiStageStatus, string>> = {
  success: "✓",
  failure: "✕",
  running: "●",
  action_required: "!",
  unstable: "!",
  skipped: "–",
  cancelled: "–",
  aborted: "–",
  neutral: "–",
};
const glyph = (status: CiStageStatus) => GLYPH[status] ?? "○";
/** Bars are the status color, a little softer than the glyphs. */
const barColor = (status: CiStageStatus) => (stageRan(status) ? `color-mix(in srgb, ${statusColor[status]} 75%, transparent)` : "var(--border)");
/** Whether a stage has run (or is running): anything with time to show. */
const stageRan = (status: CiStageStatus) => status !== "pending" && status !== "skipped" && status !== "unknown";
const isRunning = (run: CiRunInfo) => !isStageFinished(run.status);

function fmtDuration(ms: number): string {
  const s = Math.max(0, ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function ago(run: CiRunInfo): string {
  const t = parseTime(run.created_at);
  if (t === null) return "n/a";
  const age = formatAge(t);
  return age === "0m" ? "just now" : `${age} ago`;
}

/** A stage's time so far: its reported duration, else (running) time since it started. */
function stageMs(stage: CiStage, now: number): number {
  if (stage.duration_ms != null) return stage.duration_ms;
  const started = parseTime(stage.started_at);
  return stage.status === "running" && started !== null ? now - started : 0;
}

/** Whole-run time: the run's own duration once finished, else time since it started. */
function runMs(run: CiRunInfo, now: number): number {
  if (!isRunning(run) && run.duration_ms != null) return run.duration_ms;
  const created = parseTime(run.created_at);
  return created !== null ? now - created : 0;
}

function pipelineId(item: ActivePipeline): string {
  return `${item.run.provider}:${item.run.run_id ?? item.run.url}`;
}

function PipelineRow(props: { item: ActivePipeline; open: boolean; onToggle: () => void }) {
  const run = () => props.item.run;
  const stages = () => run().stages ?? [];
  const now = () => Date.now();
  const segLen = (stage: CiStage) => Math.max(stageMs(stage, now()), 1);
  const failed = () => stages().find((stage) => stage.status === "failure");

  // Expanded bars sit on the run's real timeline when every stage that ran
  // reports a start (parallel stages then overlap), else end to end.
  const timeline = createMemo(() => {
    const list = stages();
    const origin = parseTime(run().created_at);
    const starts = list.map((stage) => parseTime(stage.started_at));
    const real = origin !== null && list.every((stage, i) => !stageRan(stage.status) || starts[i] !== null);
    let cursor = 0;
    const spans = list.map((stage, i) => {
      const length = stageRan(stage.status) ? stageMs(stage, now()) : 0;
      const start = real && starts[i] !== null ? Math.max(0, (starts[i] as number) - (origin as number)) : cursor;
      cursor += segLen(stage);
      return { start, length };
    });
    const axis = Math.max(1, real ? Math.max(...spans.map((span) => span.start + span.length), 1) : cursor);
    return { spans, axis };
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", "border-radius": "8px", background: props.open ? "var(--active-bg)" : "transparent" }}>
      <Hoverable
        onClick={props.onToggle}
        style={{ display: "flex", "flex-direction": "column", gap: "7px", padding: "9px 10px", "border-radius": "8px", cursor: "pointer" }}
        hover={{ background: "var(--hover-bg)" }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Disclosure open={props.open} />
          <span style={{ flex: "none", width: "16px", height: "16px", display: "flex", "align-items": "center", "justify-content": "center" }}>
            <ProviderIcon run={run()} size={14} />
          </span>
          <div style={{ flex: 1, "min-width": 0, display: "flex", "align-items": "baseline", gap: "6px", "white-space": "nowrap", overflow: "hidden" }}>
            <span style={{ flex: "0 1 auto", "min-width": 0, "font-size": "13px", "font-weight": 500, color: "var(--text-h)", overflow: "hidden", "text-overflow": "ellipsis" }}>
              {run().name}
            </span>
            <span style={{ flex: "none", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>#{run().number}</span>
          </div>
          <span style={{ flex: "none", "white-space": "nowrap", "font-family": MONO, "font-size": "11px", color: statusColor[run().status] }}>
            {glyph(run().status)} {fmtDuration(runMs(run(), now()))}
            {isRunning(run()) ? "…" : ""}
          </span>
        </div>
        <Show when={stages().length > 0}>
          <div style={{ display: "flex", gap: "2px", "padding-left": "18px" }}>
            <For each={stages()}>
              {(stage) => (
                <div
                  title={`${stage.name} · ${stageRan(stage.status) ? fmtDuration(stageMs(stage, now())) : stage.status}`}
                  style={{ flex: String(segLen(stage)), "min-width": "4px", height: "4px", "border-radius": "2px", background: barColor(stage.status) }}
                />
              )}
            </For>
          </div>
        </Show>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "padding-left": "18px",
            "font-family": MONO,
            "font-size": "11px",
            color: "var(--text-dim)",
            "white-space": "nowrap",
            overflow: "hidden",
          }}
        >
          <span>{run().branch ?? "n/a"}</span>
          <Show when={run().event}>
            <span>·</span>
            <span>{run().event}</span>
          </Show>
          <span>·</span>
          <span>{ago(run())}</span>
          <Show when={failed()}>
            {(stage) => (
              <>
                <span>·</span>
                <span style={{ color: "var(--danger)", overflow: "hidden", "text-overflow": "ellipsis" }}>failed at {stage().name}</span>
              </>
            )}
          </Show>
        </div>
      </Hoverable>

      <Show when={props.open}>
        <div style={{ display: "flex", "flex-direction": "column", padding: "0 10px 10px 28px" }}>
          <Show when={stages().length === 0}>
            <div style={{ padding: "4px 0", "font-size": "12px", color: "var(--text-dim)" }}>Stage detail unavailable</div>
          </Show>
          <For each={stages()}>
            {(stage, i) => {
              const span = () => timeline().spans[i()];
              return (
                <div style={{ display: "flex", "align-items": "center", gap: "10px", padding: "4px 0" }}>
                  <span style={{ flex: "none", width: "12px", "text-align": "center", "font-size": "11px", "font-weight": 600, color: statusColor[stage.status] }}>
                    {glyph(stage.status)}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      "min-width": 0,
                      "font-size": "12px",
                      color: stageRan(stage.status) ? "var(--text)" : "var(--text-dim)",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                    title={stage.name}
                  >
                    {stage.name}
                  </span>
                  <div style={{ flex: "none", position: "relative", width: "clamp(36px, 30%, 90px)", height: "4px", "border-radius": "2px", background: "var(--border)" }}>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${(span().start / timeline().axis) * 100}%`,
                        width: `${(span().length / timeline().axis) * 100}%`,
                        "min-width": stageRan(stage.status) ? "2px" : "0",
                        "border-radius": "2px",
                        background: barColor(stage.status),
                      }}
                    />
                  </div>
                  <span style={{ flex: "none", width: "40px", "text-align": "right", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>
                    {stageRan(stage.status) ? fmtDuration(stageMs(stage, now())) : "—"}
                  </span>
                </div>
              );
            }}
          </For>
          <div style={{ display: "flex", gap: "8px", "padding-top": "8px" }}>
            <Show
              when={!run().archived}
              fallback={<span style={{ padding: "6px 0", "font-size": "12px", color: "var(--text-dim)" }}>No longer on {providerName(run().provider)}</span>}
            >
              <PanelButton muted onClick={() => window.open(run().url, "_blank", "noopener,noreferrer")}>
                Open in {providerName(run().provider)} ↗
              </PanelButton>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

// The most recent pipelines (running or finished) across all repos, newest
// first, grouped by repo. Data comes from `pipelines`, which App polls only
// while this tab is open.
export function PipelinesPanel() {
  const [filter, setFilter] = createSignal<Filter>("all");
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Open the first running/failed pipeline once, when the first data arrives.
  let openedInitial = false;
  createEffect(() => {
    if (openedInitial || !pipelinesLoaded()) return;
    openedInitial = true;
    const first = pipelines().find((item) => item.run.status !== "success");
    if (first) setOpen(new Set([pipelineId(first)]));
  });

  const counts = createMemo(() => ({
    all: pipelines().length,
    running: pipelines().filter((item) => isRunning(item.run)).length,
    failed: pipelines().filter((item) => item.run.status === "failure").length,
  }));
  const shown = createMemo(() =>
    pipelines().filter((item) => filter() === "all" || (filter() === "running" ? isRunning(item.run) : item.run.status === "failure")),
  );
  const groups = createMemo(() => {
    const byRepo = new Map<string, { name: string; items: ActivePipeline[] }>();
    for (const item of shown()) {
      const group = byRepo.get(item.repo_id) ?? { name: item.repo_name, items: [] };
      group.items.push(item);
      byRepo.set(item.repo_id, group);
    }
    return [...byRepo.entries()].map(([id, group]) => ({ id, ...group }));
  });

  return (
    <section style={{ display: "flex", "flex-direction": "column", "min-height": "100%", background: "var(--panel-bg)" }}>
      <PanelHeader
        title="Pipelines"
        liveTitle={`Refreshes every ${PIPELINE_POLL_MS / 1000}s`}
        live={
          <>
            <LiveDot color={pipelinesError() ? "var(--danger)" : "var(--success)"} />
            live · {PIPELINE_POLL_MS / 1000}s
          </>
        }
      >
        <Segmented<Filter>
          value={filter()}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts().all },
            { id: "running", label: "Running", count: counts().running, tone: statusColor.running },
            { id: "failed", label: "Failed", count: counts().failed, tone: statusColor.failure },
          ]}
        />
      </PanelHeader>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "12px 8px 16px 8px" }}>
        <Show when={pipelinesError()}>
          <div style={{ padding: "0 8px", "font-size": "12px", color: "var(--danger)" }}>{pipelinesError()}</div>
        </Show>
        <Show when={pipelinesLoaded()} fallback={<Show when={!pipelinesError()}><EmptyNote>Loading…</EmptyNote></Show>}>
          <For each={groups()}>
            {(group) => (
              <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <GroupHeading label={group.name} count={group.items.length} />
                <For each={group.items}>
                  {(item) => <PipelineRow item={item} open={open().has(pipelineId(item))} onToggle={() => toggle(pipelineId(item))} />}
                </For>
              </div>
            )}
          </For>
          <Show when={shown().length === 0}>
            <EmptyNote>{filter() === "failed" ? "No failed pipelines." : filter() === "running" ? "Nothing running right now." : "No pipelines yet."}</EmptyNote>
          </Show>
        </Show>
      </div>
    </section>
  );
}

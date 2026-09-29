import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import type { ActivePipeline, CiRunInfo, CiStage, CiStageStatus } from "../../api/types";
import { PIPELINE_POLL_MS, pipelines, pipelinesError, pipelinesLoaded } from "../../state/store";
import { formatAge } from "../Agents/agentFormat";
import { ProviderIcon, isStageFinished, providerName, statusColor } from "../Badges/ciStatus";

/* Recent pipelines sidebar panel: compact rows with a stage strip, expandable
   to per-stage timing bars. Colors come from the theme variables. */

type Filter = "all" | "running" | "failed";

const MONO = "ui-monospace, Menlo, Consolas, monospace";

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

const sectionLabel: JSX.CSSProperties = {
  "font-family": MONO,
  "font-size": "10px",
  "letter-spacing": "0.08em",
  color: "var(--text-dim)",
  "text-transform": "uppercase",
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
};

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

function Hoverable(props: { style: JSX.CSSProperties; hover: JSX.CSSProperties; onClick?: () => void; children: JSX.Element; title?: string }) {
  const [hovered, setHovered] = createSignal(false);
  return (
    <div
      role="button"
      title={props.title}
      onClick={() => props.onClick?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...props.style, ...(hovered() ? props.hover : {}) }}
    >
      {props.children}
    </div>
  );
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
          <span
            style={{
              flex: "none",
              width: "10px",
              color: "var(--text-dim)",
              "font-size": "8px",
              transform: props.open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 160ms ease",
            }}
          >
            ▶
          </span>
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
                  <div style={{ flex: "none", position: "relative", width: "90px", height: "4px", "border-radius": "2px", background: "var(--border)" }}>
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
              <Hoverable
                onClick={() => window.open(run().url, "_blank", "noopener,noreferrer")}
                style={{
                  padding: "6px 10px",
                  "border-radius": "6px",
                  border: "1px solid var(--border)",
                  color: "var(--text-dim)",
                  "font-size": "12px",
                  "font-weight": 500,
                  cursor: "pointer",
                }}
                hover={{ background: "var(--hover-bg)", color: "var(--text)" }}
              >
                Open in {providerName(run().provider)} ↗
              </Hoverable>
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

  const filters: { id: Filter; label: string; tone: string }[] = [
    { id: "all", label: "All", tone: "var(--text-dim)" },
    { id: "running", label: "Running", tone: statusColor.running },
    { id: "failed", label: "Failed", tone: statusColor.failure },
  ];

  return (
    <section style={{ display: "flex", "flex-direction": "column", "min-height": "100%", background: "var(--panel-bg)" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          "z-index": 1,
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          padding: "16px 16px 12px 16px",
          background: "var(--panel-bg)",
          "border-bottom": "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
          <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--text-h)" }}>Pipelines</div>
          <div
            title={`Refreshes every ${PIPELINE_POLL_MS / 1000}s`}
            style={{ display: "flex", "align-items": "center", gap: "6px", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}
          >
            <span style={{ width: "6px", height: "6px", "border-radius": "3px", background: pipelinesError() ? "var(--danger)" : "var(--success)" }} />
            live · {PIPELINE_POLL_MS / 1000}s
          </div>
        </div>
        <div
          role="tablist"
          style={{ display: "flex", padding: "2px", gap: "2px", "border-radius": "7px", background: "var(--input-bg)", border: "1px solid var(--border)" }}
        >
          <For each={filters}>
            {(item) => {
              const selected = () => filter() === item.id;
              const count = () => counts()[item.id];
              return (
                <div
                  role="tab"
                  aria-selected={selected()}
                  onClick={() => setFilter(item.id)}
                  style={{
                    flex: 1,
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    gap: "6px",
                    padding: "5px 0",
                    "border-radius": "5px",
                    background: selected() ? "var(--active-bg)" : "transparent",
                    color: selected() ? "var(--text-h)" : "var(--text-dim)",
                    "font-size": "12px",
                    "font-weight": 500,
                    cursor: "pointer",
                    transition: "background-color 150ms ease, color 150ms ease",
                  }}
                >
                  {item.label}
                  <span style={{ "font-family": MONO, "font-size": "10px", color: item.id !== "all" && count() ? item.tone : "var(--text-dim)" }}>{count()}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", padding: "12px 8px 16px 8px" }}>
        <Show when={pipelinesError()}>
          <div style={{ padding: "0 8px", "font-size": "12px", color: "var(--danger)" }}>{pipelinesError()}</div>
        </Show>
        <Show
          when={pipelinesLoaded()}
          fallback={
            <Show when={!pipelinesError()}>
              <div style={{ padding: "32px 16px", "text-align": "center", "font-size": "13px", color: "var(--text-dim)" }}>Loading…</div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", padding: "0 8px 6px 8px" }}>
                  <div style={sectionLabel}>{group.name}</div>
                  <div style={{ "font-family": MONO, "font-size": "10px", color: "var(--text-dim)", opacity: 0.7 }}>{group.items.length}</div>
                </div>
                <For each={group.items}>
                  {(item) => <PipelineRow item={item} open={open().has(pipelineId(item))} onToggle={() => toggle(pipelineId(item))} />}
                </For>
              </div>
            )}
          </For>
          <Show when={shown().length === 0}>
            <div style={{ padding: "32px 16px", "text-align": "center", "font-size": "13px", color: "var(--text-dim)" }}>
              {filter() === "failed" ? "No failed pipelines." : filter() === "running" ? "Nothing running right now." : "No pipelines yet."}
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
}

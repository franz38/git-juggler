import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

/* CI run popover — completed / running / failed. SolidJS, inline styles, no deps.
   Every colour is a theme token (index.css / the active theme), so the card
   follows whichever theme is on; fonts are the app's own. */

export type RunStatus = "success" | "failure" | "running";
export type StepStatus = RunStatus | "queued" | "skipped";

export interface CIStep {
  name: string;
  status: StepStatus;
  /** Seconds spent so far (live for running steps). */
  durationSec: number;
  /** Duration from the last successful run — drawn as a ghost bar while running/queued. */
  expectedSec?: number;
}

export interface CIJob {
  name: string;
  status: StepStatus;
  /** Offset from run start, seconds. */
  startSec: number;
  durationSec: number;
  expectedSec?: number;
  steps: CIStep[];
}

export interface CIRun {
  title: string;
  url?: string;
  /** Kept by git-juggler after the CI server deleted it: shown without a link. */
  archived?: boolean;
  provider: "github" | "jenkins";
  status: RunStatus;
  branch: string;
  event: string;
  /** Pre-formatted, e.g. "25 Sep, 08:04". */
  updatedLabel: string;
  updatedTitle?: string;
  jobs: CIJob[];
  /** Shown in the red banner when status === "failure". */
  failure?: { job: string; step: string; message: string };
}

export interface CIRunPopoverProps {
  run: CIRun;
  /** Provider logo element (img/svg). Rendered in a 36×36 box, contained. */
  providerIcon?: JSX.Element;
  onRerunFailed?: () => void;
  onCancel?: () => void;
  onOpen?: () => void;
  /** Axis length in seconds. Defaults to max(run end, expected end). */
  axisSec?: number;
  class?: string;
}

const MONO = "ui-monospace, Menlo, Consolas, monospace";
const SANS = "inherit";
// Faint neutral for bar tracks and ghost bars: visible on the card and on a hovered row alike.
const TRACK = "color-mix(in srgb, var(--text-dim) 18%, transparent)";
const GHOST = "color-mix(in srgb, var(--text-dim) 35%, transparent)";

const LOOK: Record<StepStatus, { glyph: string; color: string; bar: string; name: string }> = {
  success: { glyph: "✓", color: "var(--success)", bar: "color-mix(in srgb, var(--success) 75%, transparent)", name: "var(--text)" },
  failure: { glyph: "✕", color: "var(--danger)", bar: "color-mix(in srgb, var(--danger) 80%, transparent)", name: "var(--text-h)" },
  running: { glyph: "●", color: "var(--accent)", bar: "var(--accent)", name: "var(--text-h)" },
  skipped: { glyph: "–", color: "var(--text-dim)", bar: "transparent", name: "var(--text-dim)" },
  queued: { glyph: "○", color: "var(--text-dim)", bar: "transparent", name: "var(--text-dim)" },
};
const RUN_LABEL: Record<RunStatus, string> = { success: "Succeeded", failure: "Failed", running: "In progress" };
const PROVIDER_LABEL = { github: "GitHub Actions", jenkins: "Jenkins" };

export const fmtDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const pct = (v: number, of: number) => `${of ? Math.max(0, (v / of) * 100) : 0}%`;
const isPending = (s: StepStatus) => s === "running" || s === "queued";

function Chip(props: { k: string; v: string; title?: string }) {
  return (
    <div
      title={props.title}
      style={{ display: "flex", "align-items": "center", gap: "6px", padding: "3px 8px", "border-radius": "5px", border: "1px solid var(--border)", "font-family": MONO, "font-size": "11px", color: "var(--text)" }}
    >
      <span style={{ color: "var(--text-dim)" }}>{props.k}</span>
      {props.v}
    </div>
  );
}

function Banner(props: { tone: "failure" | "running"; title: string; detail: string; action: string; onAction?: () => void }) {
  const t = props.tone === "failure"
    ? { bg: "var(--danger-bg)", border: "color-mix(in srgb, var(--danger) 35%, transparent)", title: "var(--danger-fg)", detail: "color-mix(in srgb, var(--danger-fg) 80%, transparent)", btn: "color-mix(in srgb, var(--danger) 45%, transparent)", hover: "color-mix(in srgb, var(--danger) 15%, transparent)" }
    : { bg: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "color-mix(in srgb, var(--accent) 35%, transparent)", title: "var(--text-h)", detail: "var(--text)", btn: "color-mix(in srgb, var(--accent) 45%, transparent)", hover: "color-mix(in srgb, var(--accent) 15%, transparent)" };
  const [hover, setHover] = createSignal(false);
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px", padding: "10px 12px", "border-radius": "8px", background: t.bg, border: `1px solid ${t.border}` }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
        <div style={{ "font-size": "12px", "font-weight": 600, color: t.title }}>{props.title}</div>
        <div style={{ "font-family": MONO, "font-size": "11px", color: t.detail, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{props.detail}</div>
      </div>
      <button
        type="button"
        onClick={() => props.onAction?.()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ flex: "none", padding: "6px 10px", "border-radius": "6px", border: `1px solid ${t.btn}`, background: hover() ? t.hover : "transparent", color: t.title, "font-family": SANS, "font-size": "12px", "font-weight": 500, cursor: "pointer" }}
      >
        {props.action}
      </button>
    </div>
  );
}

function Track(props: { height: number; bg: string; left: string; width: string; color: string; ghostLeft?: string; ghostWidth?: string; ghostDashed?: boolean }) {
  const r = `${props.height / 2}px`;
  return (
    <div style={{ flex: "none", position: "relative", width: "150px", height: `${props.height}px`, "border-radius": r, background: props.bg }}>
      <Show when={props.ghostWidth && props.ghostWidth !== "0%"}>
        <div
          style={{
            position: "absolute", top: 0, bottom: 0, left: props.ghostLeft ?? props.left, width: props.ghostWidth, "border-radius": r, "box-sizing": "border-box",
            ...(props.ghostDashed ? { border: `1px dashed ${GHOST}` } : { background: GHOST }),
          }}
        />
      </Show>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: props.left, width: props.width, "min-width": `${props.height > 4 ? 3 : 2}px`, "border-radius": r, background: props.color }} />
    </div>
  );
}

export function CIRunPopover(props: CIRunPopoverProps) {
  const run = () => props.run;
  const defaultOpen = () => run().jobs.find((j) => j.status === "failure" || j.status === "running")?.name ?? null;
  const [openOverride, setOpenOverride] = createSignal<string | null | undefined>(undefined);
  const openJob = () => (openOverride() === undefined ? defaultOpen() : openOverride());

  const total = createMemo(() => Math.max(0, ...run().jobs.map((j) => j.startSec + j.durationSec)));
  const axis = createMemo(() => props.axisSec ?? Math.max(total(), ...run().jobs.map((j) => j.startSec + (j.expectedSec ?? j.durationSec))));
  const done = () => run().jobs.filter((j) => j.status === "success").length;
  const runColor = () => LOOK[run().status].color;

  const running = createMemo(() => {
    for (const j of run().jobs) {
      const s = j.steps.find((x) => x.status === "running");
      if (s) return { job: j.name, step: s };
    }
    return null;
  });

  return (
    <div class={props.class} style={{ width: "100%", "max-width": "480px", background: "var(--menu-bg)", color: "var(--text)", border: "1px solid var(--border)", "border-radius": "12px", "box-shadow": "0 24px 64px var(--shadow-soft, rgba(0, 0, 0, 0.18))", overflow: "hidden", "font-family": SANS }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "18px 20px 16px 20px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Show when={props.providerIcon}>
            {/* White, whatever the theme: a currentColor icon (the GitHub mark) is drawn in it. */}
            <div style={{ flex: "none", width: "36px", height: "36px", display: "flex", "align-items": "center", "justify-content": "center", "border-radius": "6px", overflow: "hidden", color: "#fff" }}>
              {props.providerIcon}
            </div>
          </Show>
          <div style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: "2px" }}>
            <Show
              when={!run().archived}
              fallback={
                <span style={{ "font-size": "14px", "font-weight": 600, "line-height": "18px", color: "var(--text-h)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                  {run().title}
                </span>
              }
            >
              <a
                href={run().url ?? "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => { if (props.onOpen) { e.preventDefault(); props.onOpen(); } }}
                style={{ "font-size": "14px", "font-weight": 600, "line-height": "18px", color: "var(--accent)", "text-decoration": "none", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}
              >
                {run().title} ↗
              </a>
            </Show>
            <div style={{ "font-size": "12px", "line-height": "16px", color: "var(--text-dim)" }}>
              {PROVIDER_LABEL[run().provider]} · <span style={{ color: runColor() }}>{RUN_LABEL[run().status]}</span>
              <Show when={run().archived}> · no longer on {PROVIDER_LABEL[run().provider]}</Show>
            </div>
          </div>
          <div style={{ flex: "none", display: "flex", "flex-direction": "column", "align-items": "flex-end", gap: "2px" }}>
            <div style={{ "font-family": MONO, "font-size": "13px", "line-height": "18px", color: "var(--text-h)" }}>
              {fmtDuration(total())}{run().status === "running" ? "…" : ""}
            </div>
            <div style={{ "font-size": "12px", "line-height": "16px", color: "var(--text-dim)" }}>{done()} of {run().jobs.length} jobs</div>
          </div>
        </div>

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
          <Chip k="branch" v={run().branch} />
          <Chip k="event" v={run().event} />
          <Chip k="updated" v={run().updatedLabel} title={run().updatedTitle} />
        </div>

        <Show when={run().status === "failure" && run().failure}>
          {(f) => (
            <Banner tone="failure" title={`${f().job} › ${f().step}`} detail={f().message} action="Re-run failed" onAction={props.onRerunFailed} />
          )}
        </Show>
        <Show when={run().status === "running" && running()}>
          {(r) => {
            const detail = () => {
              const s = r().step;
              if (s.expectedSec == null) return `${fmtDuration(s.durationSec)} elapsed`;
              const left = Math.max(1, s.expectedSec - s.durationSec);
              return `${fmtDuration(s.durationSec)} elapsed · ~${fmtDuration(left)} left (last run ${fmtDuration(s.expectedSec)})`;
            };
            return <Banner tone="running" title={`${r().job} › ${r().step.name}`} detail={detail()} action="Cancel run" onAction={props.onCancel} />;
          }}
        </Show>
      </div>

      <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "8px 20px", "border-top": "1px solid var(--border)", "border-bottom": "1px solid var(--border)", background: "var(--panel-bg)" }}>
        <div style={{ flex: 1, "font-family": MONO, "font-size": "10px", "letter-spacing": "0.08em", color: "var(--text-dim)", "text-transform": "uppercase" }}>Jobs</div>
        <div style={{ flex: "none", width: "150px", display: "flex", "justify-content": "space-between", "font-family": MONO, "font-size": "10px", color: "var(--text-dim)" }}>
          <div>0s</div>
          <div>{fmtDuration(axis())}</div>
        </div>
        <div style={{ flex: "none", width: "36px" }} />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", padding: "6px 8px 10px 8px" }}>
        <For each={run().jobs}>
          {(job) => {
            const look = () => LOOK[job.status];
            const isOpen = () => openJob() === job.name;
            const jobSpan = () => Math.max(job.durationSec, job.expectedSec ?? 0);
            const [hover, setHover] = createSignal(false);
            const stepStarts = createMemo(() => {
              let t = 0, et = 0;
              return job.steps.map((s) => {
                const r = { start: t, expStart: et };
                t += s.durationSec;
                et += isPending(s.status) ? Math.max(s.expectedSec ?? 0, s.durationSec) : s.durationSec;
                return r;
              });
            });
            return (
              <div style={{ display: "flex", "flex-direction": "column" }}>
                <button
                  type="button"
                  aria-expanded={isOpen()}
                  onClick={() => setOpenOverride(isOpen() ? null : job.name)}
                  onMouseEnter={() => setHover(true)}
                  onMouseLeave={() => setHover(false)}
                  style={{ display: "flex", "align-items": "center", gap: "12px", padding: "8px 12px", border: "none", "border-radius": "7px", background: hover() ? "var(--hover-bg)" : "transparent", cursor: "pointer", "text-align": "left", "font-family": SANS, width: "100%" }}
                >
                  <div style={{ flex: 1, "min-width": 0, display: "flex", "align-items": "center", gap: "8px" }}>
                    <div style={{ flex: "none", width: "10px", color: "var(--text-dim)", "font-size": "9px", transform: isOpen() ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 160ms ease" }}>▶</div>
                    <div style={{ flex: "none", width: "14px", "text-align": "center", color: look().color, "font-size": "12px", "font-weight": 600 }}>{look().glyph}</div>
                    <div style={{ "font-size": "13px", "font-weight": 500, color: look().name, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{job.name}</div>
                  </div>
                  <Track
                    height={6}
                    bg={TRACK}
                    left={pct(job.startSec, axis())}
                    width={pct(job.durationSec, axis())}
                    color={look().bar}
                    ghostWidth={isPending(job.status) && job.expectedSec ? pct(jobSpan(), axis()) : "0%"}
                    ghostDashed
                  />
                  <div style={{ flex: "none", width: "36px", "text-align": "right", "font-family": MONO, "font-size": "12px", color: "var(--text)" }}>
                    {job.status === "queued" || job.status === "skipped" ? "—" : fmtDuration(job.durationSec)}
                  </div>
                </button>

                <Show when={isOpen()}>
                  <div style={{ display: "flex", "flex-direction": "column", padding: "2px 0 6px 0" }}>
                    <For each={job.steps}>
                      {(step, i) => {
                        const sl = () => LOOK[step.status];
                        const span = jobSpan();
                        return (
                          <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "5px 12px 5px 30px" }}>
                            <div style={{ flex: 1, "min-width": 0, display: "flex", "align-items": "center", gap: "8px" }}>
                              <div style={{ flex: "none", width: "14px", "text-align": "center", color: sl().color, "font-size": "11px", "font-weight": 600 }}>{sl().glyph}</div>
                              <div style={{ "font-size": "12px", color: sl().name, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{step.name}</div>
                            </div>
                            <Track
                              height={4}
                              bg={TRACK}
                              left={pct(stepStarts()[i()].start, span)}
                              width={pct(step.durationSec, span)}
                              color={sl().bar}
                              ghostLeft={pct(stepStarts()[i()].expStart, span)}
                              ghostWidth={isPending(step.status) ? pct(Math.max(step.expectedSec ?? 0, step.durationSec), span) : "0%"}
                            />
                            <div style={{ flex: "none", width: "36px", "text-align": "right", "font-family": MONO, "font-size": "11px", color: "var(--text-dim)" }}>
                              {step.status === "queued" || step.status === "skipped" ? "—" : fmtDuration(step.durationSec)}
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default CIRunPopover;

/* Example data (matches the design) */
export const exampleCompleted: CIRun = {
  title: "Build Python package #13",
  provider: "github",
  status: "success",
  branch: "0.2.1",
  event: "push",
  updatedLabel: "25 Sep, 08:04",
  updatedTitle: "25 Sept 2026 08:04",
  jobs: [
    { name: "validate-tag", status: "success", startSec: 0, durationSec: 3, steps: [
      { name: "Set up job", status: "success", durationSec: 1 },
      { name: "Check tag matches version", status: "success", durationSec: 2 },
    ] },
    { name: "build", status: "success", startSec: 3, durationSec: 34, steps: [
      { name: "Set up job", status: "success", durationSec: 3 },
      { name: "Checkout", status: "success", durationSec: 2 },
      { name: "Set up Python", status: "success", durationSec: 6 },
      { name: "Build sdist and wheel", status: "success", durationSec: 21 },
      { name: "Upload artifacts", status: "success", durationSec: 2 },
    ] },
    { name: "publish", status: "success", startSec: 44, durationSec: 22, steps: [
      { name: "Set up job", status: "success", durationSec: 5 },
      { name: "Download distributions", status: "success", durationSec: 1 },
      { name: "Publish to PyPI", status: "success", durationSec: 16 },
      { name: "Post Publish to PyPI", status: "success", durationSec: 0 },
      { name: "Complete job", status: "success", durationSec: 0 },
    ] },
  ],
};

export const exampleRunning: CIRun = {
  ...exampleCompleted,
  status: "running",
  jobs: [
    exampleCompleted.jobs[0],
    exampleCompleted.jobs[1],
    { name: "publish", status: "running", startSec: 44, durationSec: 12, expectedSec: 22, steps: [
      { name: "Set up job", status: "success", durationSec: 5 },
      { name: "Download distributions", status: "success", durationSec: 1 },
      { name: "Publish to PyPI", status: "running", durationSec: 6, expectedSec: 16 },
      { name: "Post Publish to PyPI", status: "queued", durationSec: 0, expectedSec: 0 },
      { name: "Complete job", status: "queued", durationSec: 0, expectedSec: 0 },
    ] },
  ],
};

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { CiRunInfo } from "../../api/types";
import { toCIRun } from "../../lib/ciRunPopoverData";
import { activeRepo, loadRunStages, runStages, runStagesKey } from "../../state/store";
import { swallowNextClick } from "../../lib/swallowNextClick";
import { useOverlay } from "../../state/overlayStack";
import { CIRunPopover } from "../CIRunPopover";
import { ProviderIcon, statusColor, statusMark, statusPriority } from "./ciStatus";

let nextBadgeId = 0;

const GAP = 8; // between the badge and the panel
const MARGIN = 8; // kept between the panel and the window's edges
const CLOSE_DELAY_MS = 150; // lets the pointer cross the gap from the badge to the panel

function pickRun(runs: CiRunInfo[]): CiRunInfo {
  return [...runs].sort((a, b) => statusPriority[a.status] - statusPriority[b.status])[0];
}

export function CiRunBadge(props: { runs: CiRunInfo[] }) {
  const run = () => pickRun(props.runs);
  const color = () => statusColor[run().status];

  // The panel shows on hover; a click on the badge pins it open (another click
  // unpins it), as does a click in the panel. A pinned panel closes on a click
  // anywhere else, or on Escape.
  const [pinned, setPinned] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  // A memo, so the placement effect below reruns only when the panel opens or
  // closes, not when it merely switches between hovered and pinned (that rerun
  // hid it, with nothing left to place it again).
  const open = createMemo(() => pinned() || hovered());
  let badge!: HTMLSpanElement;
  let panel: HTMLDivElement | undefined;
  useOverlay(`ci-run-badge-${nextBadgeId++}`, pinned, () => setPinned(false));

  createEffect(() => {
    if (!pinned()) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target && (badge.contains(target) || panel?.contains(target))) return;
      // Closing the panel is all a click on the graph should do (unless it
      // lands on another CI badge, which should pin its own panel).
      if (event.button === 0 && target?.closest(".graph-and-list") && !target.closest(".ci-run-badge")) swallowNextClick();
      setPinned(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onPointerDown));
  });

  const togglePinned = (event: MouseEvent) => {
    event.stopPropagation();
    setPinned(!pinned());
    // Normally loaded on hover already; this covers a pin without one (keyboard, touch).
    if (pinned()) loadStages();
  };
  const pin = (event: MouseEvent) => {
    event.stopPropagation();
    setPinned(true);
  };

  // Stage detail is fetched the first time the badge is hovered (and again on
  // later hovers while the run is still going).
  const loadStages = () => {
    const repo = activeRepo();
    if (!repo) return;
    for (const item of props.runs) void loadRunStages(repo, item);
  };

  let closeTimer: number | undefined;
  const enter = () => {
    window.clearTimeout(closeTimer);
    setHovered(true);
  };
  const leave = () => {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  };
  onCleanup(() => window.clearTimeout(closeTimer));

  // The panel lives in a portal on <body> (the graph's scroll area would clip
  // it, e.g. behind the terminal), fixed next to the badge: below it, or above
  // when there's more room there; it scrolls only when neither side fits it.
  const [placement, setPlacement] = createSignal<JSX.CSSProperties>({ visibility: "hidden" });
  const place = () => {
    if (!panel) return;
    const rect = badge.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const height = panel.scrollHeight;
    const left = `${Math.max(MARGIN, Math.min(rect.left, window.innerWidth - panel.offsetWidth - MARGIN))}px`;
    const downward = height <= below || below >= above;
    const room = downward ? below : above;
    setPlacement({
      left,
      ...(downward ? { top: `${rect.bottom + GAP}px` } : { bottom: `${window.innerHeight - rect.top + GAP}px` }),
      "max-height": `${room}px`,
      "overflow-y": height > room ? "auto" : "visible",
    });
  };

  createEffect(() => {
    if (!open()) return;
    place();
    // Scrolling the graph moves the badge; `capture` catches every scroller.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    onCleanup(() => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      setPlacement({ visibility: "hidden" });
    });
  });

  // Re-placed whenever the content changes size (stages arriving, a job unfolding).
  const observer = new ResizeObserver(() => place());
  onCleanup(() => observer.disconnect());

  return (
    <span
      ref={badge}
      class="ci-run-badge"
      classList={{ pinned: pinned() }}
      onClick={togglePinned}
      onMouseEnter={() => {
        enter();
        loadStages();
      }}
      onMouseLeave={leave}
    >
      <span class="ci-run-icon">
        <ProviderIcon run={run()} />
      </span>
      <span class="ci-run-status" style={{ color: color() }}>
        {statusMark(run().status)}
      </span>
      <Show when={open()}>
        <Portal>
          <div ref={panel} class="ci-run-tooltip" style={placement()} onClick={pin} onMouseEnter={enter} onMouseLeave={leave}>
            <div
              class="ci-run-tooltip-body"
              ref={(el) => {
                observer.observe(el);
                onCleanup(() => observer.unobserve(el));
              }}
            >
              <For each={props.runs}>
                {(item) => (
                  // "Re-run failed" / "Cancel run" are deliberately not wired: the
                  // popover gets no onRerunFailed / onCancel handlers.
                  <CIRunPopover run={toCIRun(item, runStages()[runStagesKey(item)])} providerIcon={<ProviderIcon run={item} size={28} />} />
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </span>
  );
}

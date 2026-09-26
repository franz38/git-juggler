import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import type { AgentRepositoryScan, AgentWorktreeActivity } from "../../api/types";
import { toAgentSession } from "../../lib/agentStatusPopoverData";
import { agentShowWorktrees } from "../../state/store";
import { AgentStatusPopover } from "./AgentStatusPopover";

export interface AgentHoverEntry {
  scan: AgentRepositoryScan;
  activity: AgentWorktreeActivity;
}

const CARD_WIDTH = 440;
const GAP = 12;
const MARGIN = 8;

const AGENT_LOGO: Record<string, string> = { claude: "/agent-logos/claude.png", opencode: "/agent-logos/opencode.webp" };

// Floating AgentStatusPopovers, one per agent session working on a commit.
// Rendered in a portal so the scrolling graph can't clip them; they never take pointer events.
export function AgentHoverCard(props: { entries: AgentHoverEntry[]; anchor: DOMRect }) {
  let el: HTMLDivElement | undefined;
  const [top, setTop] = createSignal(props.anchor.top);
  // Ticks the timers ("2m 14s") while the card is open.
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const left = () => {
    const right = props.anchor.right + GAP;
    return right + CARD_WIDTH + MARGIN <= window.innerWidth ? right : Math.max(MARGIN, props.anchor.left - GAP - CARD_WIDTH);
  };

  // One popover per session; a session can be on this commit through several worktrees.
  const sessions = createMemo(() => {
    const byScan = new Map<AgentRepositoryScan, AgentWorktreeActivity[]>();
    for (const { scan, activity } of props.entries) {
      byScan.set(scan, [...(byScan.get(scan) ?? []), activity]);
    }
    // Most recently active first, both for sessions and for a session's worktrees.
    const latest = (activities: AgentWorktreeActivity[]) => Math.max(...activities.map((activity) => activity.last_activity));
    return [...byScan.entries()]
      .map(([scan, activities]): [AgentRepositoryScan, AgentWorktreeActivity[]] => [scan, [...activities].sort((a, b) => b.last_activity - a.last_activity)])
      .sort((a, b) => latest(b[1]) - latest(a[1]));
  });

  createEffect(() => {
    sessions();
    if (!el) return;
    setTop(Math.max(MARGIN, Math.min(props.anchor.top - 6, window.innerHeight - el.offsetHeight - MARGIN)));
  });

  return (
    <Portal>
      <div ref={el} class="agent-hover-card" style={{ left: `${left()}px`, top: `${top()}px`, width: `${CARD_WIDTH}px` }}>
        <For each={sessions()}>
          {([scan, activities]) => (
            <AgentStatusPopover
              session={toAgentSession(scan, activities, now(), agentShowWorktrees())}
              agentIcon={AGENT_LOGO[scan.provider] ? <img src={AGENT_LOGO[scan.provider]} alt="" width={36} height={36} style={{ "object-fit": "contain" }} /> : undefined}
            />
          )}
        </For>
      </div>
    </Portal>
  );
}

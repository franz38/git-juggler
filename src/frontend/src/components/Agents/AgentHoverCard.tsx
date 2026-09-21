import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import type { AgentRepositoryScan, AgentWorktreeActivity } from "../../api/types";
import { agentShowWorktrees } from "../../state/store";
import { formatTime, sessionDetailsLine, sessionIdentity, sessionTitle, shortCommit } from "./agentFormat";

export interface AgentHoverEntry {
  scan: AgentRepositoryScan;
  activity: AgentWorktreeActivity;
}

const CARD_WIDTH = 340;
const GAP = 12;
const MARGIN = 8;

function lastToolUse(activity: AgentWorktreeActivity): string | null {
  for (let i = activity.evidence.length - 1; i >= 0; i--) {
    const evidence = activity.evidence[i];
    const target = evidence.command ?? evidence.path;
    if (evidence.tool && target) return `${evidence.tool} · ${target.replace(/\s+/g, " ").slice(0, 80)}`;
  }
  return null;
}

// Floating details for the agent sessions working on a commit. Rendered in a
// portal so the scrolling graph can't clip it; it never takes pointer events.
export function AgentHoverCard(props: { entries: AgentHoverEntry[]; anchor: DOMRect }) {
  let el: HTMLDivElement | undefined;
  const [top, setTop] = createSignal(props.anchor.top);

  const left = () => {
    const right = props.anchor.right + GAP;
    return right + CARD_WIDTH + MARGIN <= window.innerWidth ? right : Math.max(MARGIN, props.anchor.left - GAP - CARD_WIDTH);
  };

  // One block per session; a session can be on this commit through several worktrees.
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
            <div class="agent-hover-session">
              <div class="agent-hover-title">
                <span>{sessionTitle(scan)}</span>
                <span class="agent-state-pill" classList={{ idle: scan.state === "idle" }}>{scan.state}</span>
              </div>
              <div class="agent-hover-meta">{sessionIdentity(scan)}</div>
              <Show when={sessionDetailsLine(scan)}>
                <div class="agent-hover-meta">{sessionDetailsLine(scan)}</div>
              </Show>
              <Show when={scan.details?.last_prompt}>
                <div class="agent-hover-prompt">“{scan.details!.last_prompt}”</div>
              </Show>
              <Show when={agentShowWorktrees()}>
                <For each={activities}>
                  {(activity) => (
                    <div class="agent-hover-worktree">
                      <div class="agent-hover-worktree-title">
                        <span>{activity.worktree_path.split("/").pop() || activity.worktree_path}</span>
                        <Show when={activity.is_home}>
                          <span class="agent-state-pill" title="The worktree this session was started in">home</span>
                        </Show>
                        <span class="agent-state-pill" classList={{ idle: activity.state === "idle" }}>{activity.state}</span>
                      </div>
                      <div class="agent-hover-meta">
                        {activity.branch ?? "detached"} · {shortCommit(activity.commit)} · last {formatTime(activity.last_activity)}
                      </div>
                      <Show when={lastToolUse(activity)}>
                        <div class="agent-hover-meta agent-hover-mono">{lastToolUse(activity)}</div>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createEffect, onCleanup, onMount, untrack } from "solid-js";
import { stripAnsi } from "../../lib/stripAnsi";
import {
  feedTerminalOutput,
  flushPendingCommands,
  markTerminalOutputReceived,
  noteTerminalOutput,
  registerTerminalSender,
  scheduleCheckoutRefresh,
  scheduleCiRefreshAfterPush,
  scheduleCommitRefresh,
  scheduleGraphRefresh,
  shouldConnectTerminal,
  startFetch,
  startPush,
  unregisterTerminalSender,
} from "../../state/store";
import { activeTheme } from "../../state/themes";

// Matches a submitted command line (ANSI codes already stripped) so ghost
// commits / graph refreshes trigger the same way whether the command was
// typed by hand or injected via a menu action (see runInTerminal).
const FETCH_COMMAND_RE = /\bgit\s+fetch\b/;
const CHECKOUT_COMMAND_RE = /\bgit\s+(checkout|switch)\b/;
const COMMIT_COMMAND_RE = /\bgit\s+commit\b/;
const PUSH_COMMAND_RE = /\bgit\s+push\b/;
const GRAPH_MUTATION_COMMAND_RE = /\bgit\s+(merge|rebase|reset|cherry-pick|revert|tag|branch|stash)\b/;
const LINE_BUFFER_MAX = 200;

export function TerminalPanel(props: { repo: string | null }) {
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      theme: activeTheme().terminal,
    });
    createEffect(() => {
      term.options.theme = activeTheme().terminal;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef!);
    fitAddon.fit();

    // Created lazily (see shouldConnectTerminal) so background repos don't
    // all spawn their shells at once alongside the active one.
    let ws: WebSocket | undefined;

    const sendCommand = (data: string) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    };

    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    // Reconstructs the current input line from raw output (which echoes
    // back everything typed, whether by the user or injected via
    // runInTerminal) so we can detect fetch/checkout regardless of how they
    // were run — no separate "programmatic vs manual" code path needed.
    let lineBuffer = "";
    const scanForGitCommands = (chunk: string) => {
      if (!props.repo) return;
      const repo = props.repo;
      const clean = stripAnsi(chunk);
      for (const ch of clean) {
        if (ch === "\n") {
          if (FETCH_COMMAND_RE.test(lineBuffer)) startFetch(repo);
          if (CHECKOUT_COMMAND_RE.test(lineBuffer)) scheduleCheckoutRefresh(repo);
          if (COMMIT_COMMAND_RE.test(lineBuffer)) scheduleCommitRefresh(repo);
          if (GRAPH_MUTATION_COMMAND_RE.test(lineBuffer)) scheduleGraphRefresh(repo);
          if (PUSH_COMMAND_RE.test(lineBuffer)) {
            startPush(repo);
            scheduleCiRefreshAfterPush(repo);
          }
          lineBuffer = "";
        } else if (ch === "\x7f" || ch === "\b") {
          lineBuffer = lineBuffer.slice(0, -1);
        } else {
          lineBuffer += ch;
          if (lineBuffer.length > LINE_BUFFER_MAX) lineBuffer = lineBuffer.slice(-LINE_BUFFER_MAX);
        }
      }
    };

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const query = props.repo ? `?repo=${encodeURIComponent(props.repo)}` : "";
      const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal${query}`);
      ws = socket;

      socket.addEventListener("open", () => {
        sendResize();
        // Only register once the socket can actually deliver — registering
        // earlier (even guarded by a readyState check inside the sender) lets
        // a queued command be "flushed" into a still-connecting socket and
        // silently dropped.
        if (props.repo) {
          registerTerminalSender(props.repo, sendCommand);
          flushPendingCommands(props.repo);
        }
      });
      socket.addEventListener("message", (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; data: string };
          if (payload.type === "output") {
            term.write(payload.data);
            markTerminalOutputReceived();
            if (props.repo) {
              noteTerminalOutput(props.repo);
              feedTerminalOutput(props.repo, payload.data);
            }
            scanForGitCommands(payload.data);
          }
        } catch {
          // ignore malformed frames
        }
      });
    };

    let connected = false;
    createEffect(() => {
      if (connected || !shouldConnectTerminal(props.repo)) return;
      connected = true;
      untrack(connect);
    });

    term.onData((data) => sendCommand(data));

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    resizeObserver.observe(containerRef!);

    onCleanup(() => {
      if (props.repo) unregisterTerminalSender(props.repo);
      resizeObserver.disconnect();
      ws?.close();
      term.dispose();
    });
  });

  return <div class="terminal-panel" ref={containerRef} />;
}

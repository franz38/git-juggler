from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path


DATA_DIR = Path.home() / ".local" / "share" / "git-juggler"
EVENT_PATH = DATA_DIR / "agent-events.jsonl"
RECORDER_PATH = DATA_DIR / "agent-hook-recorder.py"
CLAUDE_SETTINGS_PATH = Path.home() / ".claude" / "settings.json"
OPENCODE_PLUGIN_PATH = Path.home() / ".config" / "opencode" / "plugins" / "git-juggler.js"


@dataclass(frozen=True)
class HookProviderStatus:
    provider: str
    installed: bool
    config_path: str
    event_path: str
    snippet: str
    description: str
    error: str | None = None


RECORDER_SCRIPT = r'''#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def main() -> int:
    provider = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    phase = sys.argv[2] if len(sys.argv) > 2 else "unknown"
    event_path = Path.home() / ".local" / "share" / "git-juggler" / "agent-events.jsonl"
    try:
        raw_text = sys.stdin.read()
        raw = json.loads(raw_text) if raw_text.strip() else {}
    except Exception as exc:
        raw = {"parse_error": str(exc)}

    # Only the fact that a prompt was submitted matters (it starts a new unit
    # of work); never persist what the user typed.
    if phase == "UserPromptSubmit" and isinstance(raw, dict):
        raw.pop("prompt", None)

    event = {
        "provider": provider,
        "phase": phase,
        "cwd": os.getcwd(),
        "pid": os.getpid(),
        "timestamp": int(time.time() * 1000),
        "raw": raw,
    }
    event_path.parent.mkdir(parents=True, exist_ok=True)
    with event_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _recorder_command(provider: str, phase: str) -> str:
    return f"python3 {json.dumps(str(RECORDER_PATH))} {provider} {phase}"


def _claude_hook_entry(phase: str, matcher: str | None = None) -> dict:
    entry: dict = {
        "hooks": [
            {
                "type": "command",
                "command": _recorder_command("claude", phase),
                "timeout": 5,
            }
        ]
    }
    if matcher is not None:
        entry["matcher"] = matcher
    return entry


def _claude_snippet_dict() -> dict:
    return {
        "hooks": {
            "SessionStart": [_claude_hook_entry("SessionStart")],
            "UserPromptSubmit": [_claude_hook_entry("UserPromptSubmit")],
            "PreToolUse": [_claude_hook_entry("PreToolUse", "Bash|Edit|MultiEdit|Write|Read|Glob|Grep|LS")],
            "PostToolUse": [_claude_hook_entry("PostToolUse", "Bash|Edit|MultiEdit|Write|Read|Glob|Grep|LS")],
            "SessionEnd": [_claude_hook_entry("SessionEnd")],
        }
    }


def claude_snippet() -> str:
    return json.dumps(_claude_snippet_dict(), indent=2)


OPENCODE_PLUGIN_MARKER = "git-juggler-plugin v3"

OPENCODE_PLUGIN = f'''// git-juggler global activity hook. Managed by git-juggler. {OPENCODE_PLUGIN_MARKER}
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const eventPath = path.join(os.homedir(), ".local", "share", "git-juggler", "agent-events.jsonl")

function append(phase, payload = {{}}) {{
  try {{
    fs.mkdirSync(path.dirname(eventPath), {{ recursive: true }})
    fs.appendFileSync(eventPath, JSON.stringify({{
      provider: "opencode",
      phase,
      cwd: payload.cwd,
      pid: process.pid,
      agent_pid: process.pid,
      timestamp: Date.now(),
      raw: payload,
    }}) + "\\n")
  }} catch {{
    // Hooks must never interrupt an agent action.
  }}
}}

export const GitJugglerPlugin = async (ctx) => {{
  append("SessionStart", {{ cwd: ctx.directory, worktree: ctx.worktree }})
  return {{
    // A new user message starts a new unit of work (the prompt text is never recorded).
    "chat.message": async (input) => {{
      append("UserPromptSubmit", {{ cwd: ctx.directory, worktree: ctx.worktree, sessionID: input.sessionID }})
    }},
    "tool.execute.before": async (input, output) => {{
      append("PreToolUse", {{ cwd: ctx.directory, worktree: ctx.worktree, sessionID: input.sessionID, tool: input.tool, args: output.args }})
    }},
    "tool.execute.after": async (input, output) => {{
      append("PostToolUse", {{ cwd: ctx.directory, worktree: ctx.worktree, sessionID: input.sessionID, tool: input.tool, args: output.args, result: output.result }})
    }},
    event: async (input) => {{
      if (input.event?.type?.startsWith("session.")) {{
        append(input.event.type, {{ cwd: ctx.directory, worktree: ctx.worktree, event: input.event }})
      }}
    }},
  }}
}}
'''


def opencode_snippet() -> str:
    return OPENCODE_PLUGIN


def ensure_recorder_script() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RECORDER_PATH.write_text(RECORDER_SCRIPT, encoding="utf-8")
    mode = RECORDER_PATH.stat().st_mode
    RECORDER_PATH.chmod(mode | stat.S_IXUSR)


def _load_json(path: Path) -> tuple[dict | None, str | None]:
    if not path.exists():
        return {}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, str(exc)
    if not isinstance(data, dict):
        return None, "config root must be a JSON object"
    return data, None


def _is_git_juggler_command(command: str) -> bool:
    return str(RECORDER_PATH) in command


def _has_claude_hook(settings: dict) -> bool:
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return False
    for phase in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SessionEnd"):
        entries = hooks.get(phase)
        if not isinstance(entries, list):
            return False
        found = False
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            for hook in entry.get("hooks", []):
                if isinstance(hook, dict) and _is_git_juggler_command(str(hook.get("command", ""))):
                    found = True
        if not found:
            return False
    return True


def claude_status() -> HookProviderStatus:
    settings, error = _load_json(CLAUDE_SETTINGS_PATH)
    installed = bool(settings is not None and _has_claude_hook(settings))
    return HookProviderStatus(
        provider="claude",
        installed=installed,
        config_path=str(CLAUDE_SETTINGS_PATH),
        event_path=str(EVENT_PATH),
        snippet=claude_snippet(),
        description="Records Claude session and tool-use events so git-juggler can attribute activity to the worktree actually being used.",
        error=error,
    )


def opencode_status() -> HookProviderStatus:
    error = None
    installed = False
    try:
        text = OPENCODE_PLUGIN_PATH.read_text(encoding="utf-8") if OPENCODE_PLUGIN_PATH.exists() else ""
        # The marker rules out plugins installed before session ids and prompt events were recorded.
        installed = "GitJugglerPlugin" in text and OPENCODE_PLUGIN_MARKER in text
    except OSError as exc:
        error = str(exc)
    return HookProviderStatus(
        provider="opencode",
        installed=installed,
        config_path=str(OPENCODE_PLUGIN_PATH),
        event_path=str(EVENT_PATH),
        snippet=opencode_snippet(),
        description="Installs a global OpenCode plugin that records session and tool events for worktree attribution.",
        error=error,
    )


def hooks_status() -> dict[str, HookProviderStatus]:
    return {"claude": claude_status(), "opencode": opencode_status()}


def install_claude_hooks() -> HookProviderStatus:
    ensure_recorder_script()
    settings, error = _load_json(CLAUDE_SETTINGS_PATH)
    if settings is None:
        return HookProviderStatus(
            provider="claude",
            installed=False,
            config_path=str(CLAUDE_SETTINGS_PATH),
            event_path=str(EVENT_PATH),
            snippet=claude_snippet(),
            description=claude_status().description,
            error=f"Cannot auto-install into invalid Claude settings: {error}",
        )

    hooks = settings.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        return HookProviderStatus(
            provider="claude",
            installed=False,
            config_path=str(CLAUDE_SETTINGS_PATH),
            event_path=str(EVENT_PATH),
            snippet=claude_snippet(),
            description=claude_status().description,
            error="Cannot auto-install because Claude settings 'hooks' is not an object.",
        )

    for phase, entries in _claude_snippet_dict()["hooks"].items():
        existing = hooks.setdefault(phase, [])
        if not isinstance(existing, list):
            return HookProviderStatus(
                provider="claude",
                installed=False,
                config_path=str(CLAUDE_SETTINGS_PATH),
                event_path=str(EVENT_PATH),
                snippet=claude_snippet(),
                description=claude_status().description,
                error=f"Cannot auto-install because Claude hooks.{phase} is not a list.",
            )
        if not any(
            isinstance(hook, dict) and _is_git_juggler_command(str(hook.get("command", "")))
            for entry in existing
            if isinstance(entry, dict)
            for hook in entry.get("hooks", [])
            if isinstance(entry.get("hooks", []), list)
        ):
            existing.extend(entries)

    CLAUDE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CLAUDE_SETTINGS_PATH.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return claude_status()


def install_opencode_hooks() -> HookProviderStatus:
    OPENCODE_PLUGIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    OPENCODE_PLUGIN_PATH.write_text(OPENCODE_PLUGIN, encoding="utf-8")
    return opencode_status()

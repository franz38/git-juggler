from __future__ import annotations

import json
import os
import stat
import sys
from dataclasses import dataclass
from pathlib import Path


DATA_DIR = Path.home() / ".local" / "share" / "git-juggler"
# One JSONL file per agent session, written by the hooks below and read by
# hook_events.py. Each holds the session's first event (where it started), its
# latest prompt and the events since: a new prompt rewrites the file down to
# those two lines, so it never grows past the current turn.
SESSIONS_DIR = DATA_DIR / "agent-sessions"
# The single, ever-growing log older hooks appended to. Still read while
# older writers are around (see LegacyEventLog), then removed.
EVENT_PATH = DATA_DIR / "agent-events.jsonl"
RECORDER_PATH = DATA_DIR / "agent-hook-recorder.py"
CLAUDE_SETTINGS_PATH = Path.home() / ".claude" / "settings.json"
OPENCODE_PLUGIN_PATH = (
    Path.home() / ".config" / "opencode" / "plugins" / "git-juggler.js"
)

# Shared by the reader and both hooks (injected into their source below).
PROMPT_PHASES = ("userpromptsubmit",)
END_PHASES = ("sessionend", "session.deleted")
# Events per session the reader uses, counted back from the latest.
SESSION_EVENT_LIMIT = 300
# A session file past this size (a very long turn) is cut back to what the
# reader uses: the first event plus the last SESSION_EVENT_LIMIT since the prompt.
COMPACT_BYTES = 1024 * 1024
# The payload fields the reader uses. Everything else (tool output, file
# contents, the prompt text, ...) is never written.
RAW_KEYS = (
    "session_id",
    "sessionId",
    "sessionID",
    "cwd",
    "worktree",
    "directory",
    "tool_name",
    "tool",
    "command",
)
INPUT_KEYS = ("command", "file_path", "filePath", "path")


@dataclass(frozen=True)
class HookProviderStatus:
    provider: str
    installed: bool
    config_path: str
    event_path: str
    snippet: str
    description: str
    error: str | None = None


def slim_raw(raw: dict) -> dict:
    """A hook payload cut down to the fields the reader uses (what the hooks now
    write); applied to events from the old log, which stored whole payloads."""
    kept = {key: raw[key] for key in RAW_KEYS if key in raw}
    for container in ("tool_input", "args"):
        value = raw.get(container)
        if isinstance(value, dict):
            inputs = {key: value[key] for key in INPUT_KEYS if key in value}
            if inputs:
                kept[container] = inputs
    event = raw.get("event")
    if isinstance(event, dict):
        slim_event = {
            key: event[key]
            for key in ("type", "sessionID", "session_id", "sessionId")
            if key in event
        }
        properties = event.get("properties")
        if isinstance(properties, dict):
            slim_properties: dict = {}
            if "sessionID" in properties:
                slim_properties["sessionID"] = properties["sessionID"]
            info = properties.get("info")
            if isinstance(info, dict) and "id" in info:
                slim_properties["info"] = {"id": info["id"]}
            slim_event["properties"] = slim_properties
        kept["event"] = slim_event
    return kept


def _inject(template: str) -> str:
    """Fill the shared constants into a hook's source (JSON literals are valid in both Python and JS)."""
    values = {
        "__PROMPT_PHASES__": json.dumps(list(PROMPT_PHASES)),
        "__SESSION_EVENT_LIMIT__": str(SESSION_EVENT_LIMIT),
        "__COMPACT_BYTES__": str(COMPACT_BYTES),
        "__RAW_KEYS__": json.dumps(list(RAW_KEYS)),
        "__INPUT_KEYS__": json.dumps(list(INPUT_KEYS)),
        "__MARKER__": OPENCODE_PLUGIN_MARKER,
    }
    for placeholder, value in values.items():
        template = template.replace(placeholder, value)
    return template


# Run by Claude Code for every hook (a fresh interpreter each time), so it only
# does cheap work: one small append, or a small rewrite on a new prompt.
_RECORDER_TEMPLATE = r'''#!/usr/bin/env python3
"""git-juggler agent hook recorder. Managed by git-juggler (rewritten on upgrade)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

SESSIONS_DIR = Path.home() / ".local" / "share" / "git-juggler" / "agent-sessions"
PROMPT_PHASES = __PROMPT_PHASES__
SESSION_EVENT_LIMIT = __SESSION_EVENT_LIMIT__
COMPACT_BYTES = __COMPACT_BYTES__
RAW_KEYS = __RAW_KEYS__
INPUT_KEYS = __INPUT_KEYS__


def slim(raw):
    """Only what git-juggler reads: ids, directories, tool, command and file paths.
    Tool output, file contents and what the user typed are never stored."""
    kept = {key: raw[key] for key in RAW_KEYS if key in raw}
    for container in ("tool_input", "args"):
        value = raw.get(container)
        if isinstance(value, dict):
            inputs = {key: value[key] for key in INPUT_KEYS if key in value}
            if inputs:
                kept[container] = inputs
    return kept


def session_path(provider, raw, cwd):
    session = next((raw[key] for key in ("session_id", "sessionId", "sessionID") if isinstance(raw.get(key), str) and raw[key]), None)
    key = session or "cwd-" + hashlib.sha1(cwd.encode("utf-8")).hexdigest()[:16]
    return SESSIONS_DIR / (provider + "-" + re.sub(r"[^A-Za-z0-9._-]", "_", key) + ".jsonl")


def phase_of(line):
    try:
        return str(json.loads(line).get("phase", "")).lower()
    except (ValueError, AttributeError):
        return ""


def start_turn(path, line):
    """A new prompt makes everything since the previous one irrelevant: keep only
    the session's first event (where it started) and the prompt itself."""
    header = ""
    try:
        with path.open(encoding="utf-8", newline="") as file:
            header = file.readline()
    except OSError:
        pass
    if not header.endswith("\n"):
        header = ""
    with path.open("w", encoding="utf-8", newline="") as file:
        file.write(header + line)


def compact(path):
    """Bound a very long turn to what the reader uses: the first event, then the
    last SESSION_EVENT_LIMIT events from the latest prompt on."""
    with path.open(encoding="utf-8", newline="") as file:
        lines = file.read().splitlines(keepends=True)
    if len(lines) <= SESSION_EVENT_LIMIT + 1:
        return
    start = 1
    for index in range(len(lines) - 1, 0, -1):
        if phase_of(lines[index]) in PROMPT_PHASES:
            start = index
            break
    with path.open("w", encoding="utf-8", newline="") as file:
        file.writelines([lines[0]] + lines[start:][-SESSION_EVENT_LIMIT:])


def main():
    provider = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    phase = sys.argv[2] if len(sys.argv) > 2 else "unknown"
    try:
        text = sys.stdin.read()
        raw = json.loads(text) if text.strip() else {}
    except ValueError:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    cwd = os.getcwd()
    event = {"provider": provider, "phase": phase, "cwd": cwd, "timestamp": int(time.time() * 1000), "raw": slim(raw)}
    line = json.dumps(event, separators=(",", ":")) + "\n"
    path = session_path(provider, raw, cwd)
    path.parent.mkdir(parents=True, exist_ok=True)
    if phase.lower() in PROMPT_PHASES:
        start_turn(path, line)
        return
    with path.open("a", encoding="utf-8", newline="") as file:
        file.write(line)
    if path.stat().st_size > COMPACT_BYTES:
        compact(path)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # A hook must never get in the agent's way.
    raise SystemExit(0)
'''


def _recorder_command(provider: str, phase: str) -> str:
    # RECORDER_PATH and sys.executable are embedded as plain text here, not via
    # json.dumps(): the whole settings dict is JSON-serialized once when written
    # to disk, and that's the only escaping this string should go through.
    # Pre-escaping it (e.g. with json.dumps) would double-escape backslashes on
    # Windows paths, so the round-tripped command would never match
    # str(RECORDER_PATH) again. sys.executable (rather than a bare "python3",
    # which isn't a valid command on plenty of Windows setups) is used so the
    # hook always runs with an interpreter known to exist on this machine.
    return f'"{sys.executable}" "{RECORDER_PATH}" {provider} {phase}'


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
            "PreToolUse": [
                _claude_hook_entry(
                    "PreToolUse", "Bash|Edit|MultiEdit|Write|Read|Glob|Grep|LS|Task"
                )
            ],
            "PostToolUse": [
                _claude_hook_entry(
                    "PostToolUse", "Bash|Edit|MultiEdit|Write|Read|Glob|Grep|LS|Task"
                )
            ],
            "SessionEnd": [_claude_hook_entry("SessionEnd")],
        }
    }


def claude_snippet() -> str:
    return json.dumps(_claude_snippet_dict(), indent=2)


OPENCODE_PLUGIN_MARKER = "git-juggler-plugin v4"

# Loaded once per OpenCode process (no spawn per event); it writes the same
# per-session files with the same trimming as the recorder.
_OPENCODE_PLUGIN_TEMPLATE = r"""// git-juggler global activity hook. Managed by git-juggler. __MARKER__
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const sessionsDir = path.join(os.homedir(), ".local", "share", "git-juggler", "agent-sessions")
const PROMPT_PHASES = __PROMPT_PHASES__
const SESSION_EVENT_LIMIT = __SESSION_EVENT_LIMIT__
const COMPACT_BYTES = __COMPACT_BYTES__
const INPUT_KEYS = __INPUT_KEYS__

function sessionFile(sessionID) {
  return path.join(sessionsDir, "opencode-" + sessionID.replace(/[^A-Za-z0-9._-]/g, "_") + ".jsonl")
}

// Only the tool inputs git-juggler reads (command and file paths), never file contents.
function pickInputs(args) {
  if (!args || typeof args !== "object") return undefined
  const kept = {}
  for (const key of INPUT_KEYS) if (key in args) kept[key] = args[key]
  return Object.keys(kept).length ? kept : undefined
}

function phaseOf(line) {
  try {
    return String(JSON.parse(line).phase ?? "").toLowerCase()
  } catch {
    return ""
  }
}

// Bounds a very long turn to what git-juggler reads: the first event, then the
// last SESSION_EVENT_LIMIT events from the latest prompt on.
function compact(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line)
  if (lines.length <= SESSION_EVENT_LIMIT + 1) return
  let start = 1
  for (let index = lines.length - 1; index > 0; index--) {
    if (PROMPT_PHASES.includes(phaseOf(lines[index]))) {
      start = index
      break
    }
  }
  fs.writeFileSync(file, [lines[0], ...lines.slice(start).slice(-SESSION_EVENT_LIMIT)].join("\n") + "\n")
}

function record(phase, sessionID, payload) {
  // The plugin's own start has no session yet: there is nothing to attribute it to.
  if (typeof sessionID !== "string" || !sessionID) return
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    const file = sessionFile(sessionID)
    const line = JSON.stringify({
      provider: "opencode",
      phase,
      cwd: payload.cwd,
      pid: process.pid,
      agent_pid: process.pid,
      timestamp: Date.now(),
      raw: payload,
    }) + "\n"
    if (PROMPT_PHASES.includes(phase.toLowerCase())) {
      // A new prompt makes everything since the previous one irrelevant: keep only
      // the session's first event (where it started) and the prompt itself.
      let header = ""
      try {
        const text = fs.readFileSync(file, "utf8")
        const end = text.indexOf("\n")
        if (end >= 0) header = text.slice(0, end + 1)
      } catch {
        // No file yet: the prompt is the session's first event.
      }
      fs.writeFileSync(file, header + line)
      return
    }
    fs.appendFileSync(file, line)
    if (fs.statSync(file).size > COMPACT_BYTES) compact(file)
  } catch {
    // Hooks must never interrupt an agent action.
  }
}

// session.* events carry the session as properties.sessionID, or as properties.info itself.
function eventSessionID(event) {
  const properties = event.properties ?? {}
  if (typeof properties.sessionID === "string") return properties.sessionID
  return typeof properties.info?.id === "string" ? properties.info.id : undefined
}

export const GitJugglerPlugin = async (ctx) => {
  const base = { cwd: ctx.directory, worktree: ctx.worktree }
  return {
    // A new user message starts a new unit of work (the prompt text is never recorded).
    "chat.message": async (input) => {
      record("UserPromptSubmit", input.sessionID, { ...base, sessionID: input.sessionID })
    },
    "tool.execute.before": async (input, output) => {
      record("PreToolUse", input.sessionID, { ...base, sessionID: input.sessionID, tool: input.tool, args: pickInputs(output.args) })
    },
    "tool.execute.after": async (input, output) => {
      record("PostToolUse", input.sessionID, { ...base, sessionID: input.sessionID, tool: input.tool, args: pickInputs(output.args) })
    },
    event: async (input) => {
      const event = input.event
      if (!event?.type?.startsWith("session.")) return
      const properties = {}
      if (typeof event.properties?.sessionID === "string") properties.sessionID = event.properties.sessionID
      if (typeof event.properties?.info?.id === "string") properties.info = { id: event.properties.info.id }
      record(event.type, eventSessionID(event), { ...base, event: { type: event.type, properties } })
    },
  }
}
"""

RECORDER_SCRIPT = _inject(_RECORDER_TEMPLATE)
OPENCODE_PLUGIN = _inject(_OPENCODE_PLUGIN_TEMPLATE)


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
    for phase in (
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "SessionEnd",
    ):
        entries = hooks.get(phase)
        if not isinstance(entries, list):
            return False
        found = False
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            for hook in entry.get("hooks", []):
                if isinstance(hook, dict) and _is_git_juggler_command(
                    str(hook.get("command", ""))
                ):
                    found = True
        if not found:
            return False
    return True


def _remove_git_juggler_claude_hooks(settings: dict) -> bool:
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return False
    changed = False
    for phase, entries in list(hooks.items()):
        if not isinstance(entries, list):
            continue
        new_entries = []
        for entry in entries:
            if not isinstance(entry, dict):
                new_entries.append(entry)
                continue
            hook_list = entry.get("hooks")
            if not isinstance(hook_list, list):
                new_entries.append(entry)
                continue
            kept_hooks = [
                hook
                for hook in hook_list
                if not (
                    isinstance(hook, dict)
                    and _is_git_juggler_command(str(hook.get("command", "")))
                )
            ]
            if len(kept_hooks) == len(hook_list):
                new_entries.append(entry)
                continue
            changed = True
            if kept_hooks:
                new_entry = dict(entry)
                new_entry["hooks"] = kept_hooks
                new_entries.append(new_entry)
            elif set(entry.keys()).difference({"matcher", "hooks"}):
                # Preserve unusual user-authored metadata rather than guessing it
                # is safe to delete the whole entry.
                new_entry = dict(entry)
                new_entry["hooks"] = []
                new_entries.append(new_entry)
        if new_entries:
            hooks[phase] = new_entries
        else:
            del hooks[phase]
    return changed


def claude_status() -> HookProviderStatus:
    settings, error = _load_json(CLAUDE_SETTINGS_PATH)
    installed = bool(settings is not None and _has_claude_hook(settings))
    return HookProviderStatus(
        provider="claude",
        installed=installed,
        config_path=str(CLAUDE_SETTINGS_PATH),
        event_path=str(SESSIONS_DIR),
        snippet=claude_snippet(),
        description="Records Claude session and tool-use events so git-juggler can attribute activity to the worktree actually being used.",
        error=error,
    )


def opencode_status() -> HookProviderStatus:
    error = None
    installed = False
    try:
        text = (
            OPENCODE_PLUGIN_PATH.read_text(encoding="utf-8")
            if OPENCODE_PLUGIN_PATH.exists()
            else ""
        )
        # The marker rules out plugins installed before session ids and prompt events were recorded.
        installed = "GitJugglerPlugin" in text and OPENCODE_PLUGIN_MARKER in text
    except OSError as exc:
        error = str(exc)
    return HookProviderStatus(
        provider="opencode",
        installed=installed,
        config_path=str(OPENCODE_PLUGIN_PATH),
        event_path=str(SESSIONS_DIR),
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
            event_path=str(SESSIONS_DIR),
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
            event_path=str(SESSIONS_DIR),
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
                event_path=str(SESSIONS_DIR),
                snippet=claude_snippet(),
                description=claude_status().description,
                error=f"Cannot auto-install because Claude hooks.{phase} is not a list.",
            )
        if not any(
            isinstance(hook, dict)
            and _is_git_juggler_command(str(hook.get("command", "")))
            for entry in existing
            if isinstance(entry, dict)
            for hook in entry.get("hooks", [])
            if isinstance(entry.get("hooks", []), list)
        ):
            existing.extend(entries)

    CLAUDE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CLAUDE_SETTINGS_PATH.write_text(
        json.dumps(settings, indent=2) + "\n", encoding="utf-8"
    )
    return claude_status()


def install_opencode_hooks() -> HookProviderStatus:
    OPENCODE_PLUGIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    OPENCODE_PLUGIN_PATH.write_text(OPENCODE_PLUGIN, encoding="utf-8")
    return opencode_status()


def upgrade_installed_hooks() -> None:
    """Bring hooks an older git-juggler installed up to this version's.

    Only rewrites the files git-juggler itself manages, and only where they are
    already installed: Claude's settings keep calling the same recorder path, so
    replacing the script upgrades every hook, and OpenCode picks up the plugin
    on its next start. Never installs anything the user hasn't.
    """
    try:
        if (
            RECORDER_PATH.exists()
            and RECORDER_PATH.read_text(encoding="utf-8") != RECORDER_SCRIPT
        ):
            ensure_recorder_script()
    except OSError:
        pass
    try:
        if OPENCODE_PLUGIN_PATH.exists():
            text = OPENCODE_PLUGIN_PATH.read_text(encoding="utf-8")
            if (
                "GitJugglerPlugin" in text
                and "Managed by git-juggler" in text
                and text != OPENCODE_PLUGIN
            ):
                OPENCODE_PLUGIN_PATH.write_text(OPENCODE_PLUGIN, encoding="utf-8")
    except OSError:
        pass


def uninstall_claude_hooks() -> HookProviderStatus:
    settings, error = _load_json(CLAUDE_SETTINGS_PATH)
    if settings is None:
        return HookProviderStatus(
            provider="claude",
            installed=False,
            config_path=str(CLAUDE_SETTINGS_PATH),
            event_path=str(EVENT_PATH),
            snippet=claude_snippet(),
            description=claude_status().description,
            error=f"Cannot auto-remove from invalid Claude settings: {error}",
        )
    if _remove_git_juggler_claude_hooks(settings):
        CLAUDE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        CLAUDE_SETTINGS_PATH.write_text(
            json.dumps(settings, indent=2) + "\n", encoding="utf-8"
        )
    return claude_status()


def uninstall_opencode_hooks() -> HookProviderStatus:
    error = None
    try:
        if OPENCODE_PLUGIN_PATH.exists():
            text = OPENCODE_PLUGIN_PATH.read_text(encoding="utf-8")
            if "GitJugglerPlugin" in text and "git-juggler-plugin" in text:
                OPENCODE_PLUGIN_PATH.unlink()
            else:
                error = "Not removing because the OpenCode plugin file does not look managed by git-juggler."
    except OSError as exc:
        error = str(exc)
    status = opencode_status()
    return HookProviderStatus(**{**status.__dict__, "error": error or status.error})

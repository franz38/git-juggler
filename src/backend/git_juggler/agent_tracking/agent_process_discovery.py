from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass


DEFAULT_AGENT_PATTERNS = ("claude", "opencode")


@dataclass(frozen=True)
class AgentProcessCandidate:
    pid: int
    command_line: str
    matched_pattern: str


class CommandRunner:
    def run(self, args: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)  # noqa: S603 - fixed executable plus arg array


def parse_pgrep_output(output: str, pattern: str, current_pid: int | None = None) -> list[AgentProcessCandidate]:
    candidates: list[AgentProcessCandidate] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        pid_text, _, command_line = stripped.partition(" ")
        try:
            pid = int(pid_text)
        except ValueError:
            continue
        if current_pid is not None and pid == current_pid:
            continue
        candidates.append(AgentProcessCandidate(pid=pid, command_line=command_line or pattern, matched_pattern=pattern))
    return candidates


class AgentProcessDiscovery:
    def __init__(self, patterns: Sequence[str] = DEFAULT_AGENT_PATTERNS, runner: CommandRunner | None = None) -> None:
        self.patterns = tuple(pattern for pattern in patterns if pattern.strip())
        self.runner = runner or CommandRunner()

    def discover(self) -> list[AgentProcessCandidate]:
        by_pid: dict[int, AgentProcessCandidate] = {}
        for pattern in self.patterns:
            for candidate in self._discover_pattern(pattern):
                by_pid.setdefault(candidate.pid, candidate)
        return sorted(by_pid.values(), key=lambda candidate: candidate.pid)

    def _discover_pattern(self, pattern: str) -> list[AgentProcessCandidate]:
        try:
            result = self.runner.run(["pgrep", "-af", pattern])
        except (OSError, subprocess.SubprocessError):
            return []
        if result.returncode not in (0, 1):
            return []
        return parse_pgrep_output(result.stdout, pattern, current_pid=os.getpid())

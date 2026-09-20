from __future__ import annotations

import subprocess
from collections.abc import Sequence

from .process_info import ProcessInfo


class CommandRunner:
    def run(self, args: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)  # noqa: S603 - fixed executable plus arg array


def parse_ps_snapshot(output: str) -> dict[int, ProcessInfo]:
    processes: dict[int, ProcessInfo] = {}
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
            parent_pid = int(parts[1])
        except ValueError:
            continue
        processes[pid] = ProcessInfo(pid=pid, parent_pid=parent_pid, executable=parts[2] or None)
    return processes


def parse_lsof_cwd(output: str) -> str | None:
    for line in output.splitlines():
        if line.startswith("n") and len(line) > 1:
            return line[1:]
    return None


def parse_lsof_file_paths(output: str) -> list[str]:
    paths: list[str] = []
    current_fd: str | None = None
    for line in output.splitlines():
        if line.startswith("f"):
            current_fd = line[1:]
        elif line.startswith("n") and len(line) > 1 and current_fd != "cwd":
            path = line[1:]
            if path.startswith("/"):
                paths.append(path)
    return list(dict.fromkeys(paths))


class MacProcessInspector:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def get_process(self, pid: int) -> ProcessInfo | None:
        snapshot = self._snapshot()
        process = snapshot.get(pid)
        if process is None:
            return None
        return self._with_details(process)

    def get_children(self, pid: int) -> list[ProcessInfo]:
        snapshot = self._snapshot()
        return [self._with_details(process) for process in snapshot.values() if process.parent_pid == pid]

    def get_descendants(self, pid: int) -> list[ProcessInfo]:
        snapshot = self._snapshot()
        children_by_parent: dict[int, list[ProcessInfo]] = {}
        for process in snapshot.values():
            if process.parent_pid is not None:
                children_by_parent.setdefault(process.parent_pid, []).append(process)

        descendants: list[ProcessInfo] = []
        stack = list(children_by_parent.get(pid, []))
        seen: set[int] = set()
        while stack:
            process = stack.pop()
            if process.pid in seen:
                continue
            seen.add(process.pid)
            descendants.append(self._with_details(process))
            stack.extend(children_by_parent.get(process.pid, []))
        return descendants

    def _snapshot(self) -> dict[int, ProcessInfo]:
        try:
            result = self.runner.run(["ps", "-axo", "pid=,ppid=,comm="])
        except (OSError, subprocess.SubprocessError):
            return {}
        if result.returncode != 0:
            return {}
        return parse_ps_snapshot(result.stdout)

    def _with_details(self, process: ProcessInfo) -> ProcessInfo:
        cwd = self._cwd_for_pid(process.pid)
        return ProcessInfo(
            pid=process.pid,
            parent_pid=process.parent_pid,
            executable=process.executable,
            command_line=process.command_line,
            open_files=self._open_files_for_pid(process.pid),
            cwd=cwd,
        )

    def _cwd_for_pid(self, pid: int) -> str | None:
        try:
            result = self.runner.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"])
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode != 0:
            return None
        return parse_lsof_cwd(result.stdout)

    def _open_files_for_pid(self, pid: int) -> list[str]:
        try:
            result = self.runner.run(["lsof", "-a", "-p", str(pid), "-Ffn"])
        except (OSError, subprocess.SubprocessError):
            return []
        if result.returncode != 0:
            return []
        return parse_lsof_file_paths(result.stdout)

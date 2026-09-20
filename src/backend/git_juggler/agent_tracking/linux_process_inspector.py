from __future__ import annotations

import os
from pathlib import Path

from .process_info import ProcessInfo


PROC_ROOT = Path("/proc")


def parse_proc_stat_ppid(stat: str) -> int | None:
    close = stat.rfind(")")
    if close < 0:
        return None
    rest = stat[close + 1 :].strip().split()
    if len(rest) < 2:
        return None
    try:
        return int(rest[1])
    except ValueError:
        return None


def parse_proc_cmdline(raw: bytes) -> str | None:
    parts = parse_proc_cmdline_args(raw)
    return " ".join(parts) if parts else None


def parse_proc_cmdline_args(raw: bytes) -> list[str]:
    parts = [part.decode("utf-8", errors="replace") for part in raw.split(b"\0") if part]
    return parts


class LinuxProcessInspector:
    def __init__(self, proc_root: Path = PROC_ROOT) -> None:
        self.proc_root = proc_root

    def get_process(self, pid: int) -> ProcessInfo | None:
        return self._read_process(pid)

    def get_children(self, pid: int) -> list[ProcessInfo]:
        return [process for process in self._snapshot().values() if process.parent_pid == pid]

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
            descendants.append(process)
            stack.extend(children_by_parent.get(process.pid, []))
        return descendants

    def _snapshot(self) -> dict[int, ProcessInfo]:
        processes: dict[int, ProcessInfo] = {}
        try:
            entries = list(os.scandir(self.proc_root))
        except OSError:
            return processes
        for entry in entries:
            if not entry.name.isdigit():
                continue
            process = self._read_process(int(entry.name))
            if process is not None:
                processes[process.pid] = process
        return processes

    def _read_process(self, pid: int) -> ProcessInfo | None:
        base = self.proc_root / str(pid)
        parent_pid = self._read_parent_pid(base)
        if parent_pid is None:
            return None
        return ProcessInfo(
            pid=pid,
            parent_pid=parent_pid,
            executable=self._readlink_or_none(base / "exe"),
            command_line=self._read_cmdline(base / "cmdline"),
            arguments=self._read_cmdline_args(base / "cmdline"),
            open_files=self._read_open_files(base / "fd"),
            cwd=self._readlink_or_none(base / "cwd"),
        )

    def _read_parent_pid(self, base: Path) -> int | None:
        try:
            return parse_proc_stat_ppid((base / "stat").read_text(encoding="utf-8", errors="replace"))
        except OSError:
            return None

    def _read_cmdline(self, path: Path) -> str | None:
        try:
            return parse_proc_cmdline(path.read_bytes())
        except OSError:
            return None

    def _read_cmdline_args(self, path: Path) -> list[str] | None:
        try:
            return parse_proc_cmdline_args(path.read_bytes())
        except OSError:
            return None

    def _readlink_or_none(self, path: Path) -> str | None:
        try:
            return os.readlink(path)
        except OSError:
            return None

    def _read_open_files(self, fd_dir: Path) -> list[str]:
        paths: list[str] = []
        try:
            entries = list(os.scandir(fd_dir))
        except OSError:
            return paths
        for entry in entries:
            try:
                target = os.readlink(entry.path)
            except OSError:
                continue
            if target.startswith("/"):
                paths.append(target)
        return list(dict.fromkeys(paths))

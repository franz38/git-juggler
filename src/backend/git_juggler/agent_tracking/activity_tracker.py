from __future__ import annotations

import threading
from collections.abc import Callable

from .agent_repository_tracker import AgentRepositoryScan, AgentRepositoryTracker


class ActivityTracker:
    def __init__(self, tracker: AgentRepositoryTracker | None = None, poll_interval_ms: int = 1000) -> None:
        self.tracker = tracker or AgentRepositoryTracker()
        self.poll_interval_ms = poll_interval_ms
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self, agent_pid: int, on_scan: Callable[[AgentRepositoryScan], None]) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, args=(agent_pid, on_scan), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=max(1, self.poll_interval_ms / 1000 * 2))
        self._thread = None

    def _run(self, agent_pid: int, on_scan: Callable[[AgentRepositoryScan], None]) -> None:
        interval_seconds = max(0.1, self.poll_interval_ms / 1000)
        while not self._stop_event.is_set():
            scan = self.tracker.scan(agent_pid)
            on_scan(scan)
            self._stop_event.wait(interval_seconds)

from __future__ import annotations

from typing import Protocol

from .process_info import ProcessInfo


class ProcessInspector(Protocol):
    def get_process(self, pid: int) -> ProcessInfo | None:
        ...

    def get_children(self, pid: int) -> list[ProcessInfo]:
        ...

    def get_descendants(self, pid: int) -> list[ProcessInfo]:
        ...

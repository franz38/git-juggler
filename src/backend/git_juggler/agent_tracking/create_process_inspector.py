from __future__ import annotations

import sys

from .linux_process_inspector import LinuxProcessInspector
from .mac_process_inspector import MacProcessInspector
from .process_inspector import ProcessInspector


def create_process_inspector() -> ProcessInspector:
    if sys.platform == "darwin":
        return MacProcessInspector()
    if sys.platform.startswith("linux"):
        return LinuxProcessInspector()
    raise RuntimeError(f"unsupported platform for process inspection: {sys.platform}")

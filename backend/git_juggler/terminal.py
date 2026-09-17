from __future__ import annotations

import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


async def run_terminal_session(websocket: WebSocket, cwd: Path) -> None:
    """Spawn a real shell in a PTY rooted at `cwd` and relay it over the socket.

    Wire protocol (JSON text frames both ways):
      client -> server: {"type": "input", "data": "<keystrokes>"}
                        {"type": "resize", "cols": n, "rows": n}
      server -> client: {"type": "output", "data": "<shell output>"}
    """
    shell = os.environ.get("SHELL", "/bin/bash")
    pid, master_fd = pty.fork()

    if pid == 0:  # child
        os.chdir(cwd)
        os.execvp(shell, [shell])
        os._exit(1)  # pragma: no cover - unreachable

    loop = asyncio.get_running_loop()
    output_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    def _on_readable() -> None:
        try:
            data = os.read(master_fd, 65536)
        except OSError:
            data = b""
        if not data:
            loop.remove_reader(master_fd)
            output_queue.put_nowait(None)
            return
        output_queue.put_nowait(data)

    loop.add_reader(master_fd, _on_readable)

    async def pump_output() -> None:
        while True:
            chunk = await output_queue.get()
            if chunk is None:
                break
            await websocket.send_text(json.dumps({"type": "output", "data": chunk.decode(errors="replace")}))

    output_task = asyncio.create_task(pump_output())

    try:
        while True:
            text = await websocket.receive_text()
            try:
                payload = json.loads(text)
            except ValueError:
                continue
            msg_type = payload.get("type")
            if msg_type == "input":
                os.write(master_fd, payload.get("data", "").encode())
            elif msg_type == "resize":
                _set_winsize(master_fd, int(payload.get("rows", 24)), int(payload.get("cols", 80)))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            loop.remove_reader(master_fd)
        except (ValueError, OSError):
            pass
        output_task.cancel()
        try:
            os.kill(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass

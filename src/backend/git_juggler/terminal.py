from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect

# Wire protocol (JSON text frames both ways), shared by both platform
# implementations below:
#   client -> server: {"type": "input", "data": "<keystrokes>"}
#                     {"type": "resize", "cols": n, "rows": n}
#   server -> client: {"type": "output", "data": "<shell output>"}


async def run_terminal_session(websocket: WebSocket, cwd: Path) -> None:
    """Spawn a real shell in a pseudo-terminal rooted at `cwd` and relay it
    over the socket. POSIX and Windows need genuinely different pty APIs
    (openpty/fork vs ConPTY), so this just dispatches to whichever this
    process is running on; the platform-only imports (fcntl/pty/termios,
    winpty) happen inside each implementation so neither is ever required
    on the other platform.
    """
    if sys.platform == "win32":
        await _run_windows_session(websocket, cwd)
    else:
        await _run_posix_session(websocket, cwd)


_MAX_FD = 4096
_SHELL_KILL_GRACE_S = 2.0
_reapers: set[asyncio.Task[None]] = set()


def _signal_shell_group(pid: int, sig: int) -> None:
    # pty.fork() makes the shell a session leader, so its pid is also its
    # process group id: signalling the group reaches foreground jobs too, not
    # just the shell.
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass
    except PermissionError:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def _try_reap(pid: int) -> bool:
    try:
        reaped, _ = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return True
    return reaped == pid


def _hang_up_shell(pid: int) -> None:
    """SIGHUP the shell's process group and reap the shell without blocking
    the event loop; escalate to SIGKILL if it ignores the hang-up."""
    import signal

    _signal_shell_group(pid, signal.SIGHUP)
    if _try_reap(pid):
        return

    async def _reap() -> None:
        waited = 0.0
        while waited < _SHELL_KILL_GRACE_S:
            await asyncio.sleep(0.1)
            waited += 0.1
            if _try_reap(pid):
                return
        _signal_shell_group(pid, signal.SIGKILL)
        for _ in range(20):
            await asyncio.sleep(0.1)
            if _try_reap(pid):
                return

    task = asyncio.get_running_loop().create_task(_reap())
    _reapers.add(task)
    task.add_done_callback(_reapers.discard)


async def _run_posix_session(websocket: WebSocket, cwd: Path) -> None:
    import fcntl
    import pty
    import struct
    import termios

    def _set_winsize(fd: int, rows: int, cols: int) -> None:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

    shell = os.environ.get("SHELL", "/bin/bash")
    pid, master_fd = pty.fork()

    if pid == 0:  # child
        # The server's listening socket is inheritable (uvicorn marks it so),
        # and a shell that keeps it open would hold the port even after the
        # server dies.
        os.closerange(3, _MAX_FD)
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
        _hang_up_shell(pid)
        try:
            os.close(master_fd)
        except OSError:
            pass


async def _run_windows_session(websocket: WebSocket, cwd: Path) -> None:
    # Imported lazily so POSIX systems never need this dependency installed,
    # and so a missing install fails inside one terminal connection instead
    # of at process startup (see pyproject.toml: pywinpty is a Windows-only
    # extra, `sys_platform == "win32"`).
    from winpty import PtyProcess

    shell = os.environ.get("COMSPEC", "cmd.exe")
    process = PtyProcess.spawn(shell, cwd=str(cwd), dimensions=(24, 80))

    loop = asyncio.get_running_loop()
    output_queue: asyncio.Queue[str | None] = asyncio.Queue()

    # winpty's read() is a blocking call (there's no fd to hand to the
    # asyncio selector on Windows), so it has to live on its own thread;
    # results are handed back to the event loop via call_soon_threadsafe.
    def _read_loop() -> None:
        while True:
            try:
                data = process.read(65536)
            except EOFError:
                loop.call_soon_threadsafe(output_queue.put_nowait, None)
                return
            if not data:
                loop.call_soon_threadsafe(output_queue.put_nowait, None)
                return
            loop.call_soon_threadsafe(output_queue.put_nowait, data)

    reader_thread = threading.Thread(target=_read_loop, daemon=True)
    reader_thread.start()

    async def pump_output() -> None:
        while True:
            chunk = await output_queue.get()
            if chunk is None:
                break
            await websocket.send_text(json.dumps({"type": "output", "data": chunk}))

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
                process.write(payload.get("data", ""))
            elif msg_type == "resize":
                process.setwinsize(int(payload.get("rows", 24)), int(payload.get("cols", 80)))
    except WebSocketDisconnect:
        pass
    finally:
        output_task.cancel()
        try:
            process.terminate(force=True)
        except Exception:
            pass

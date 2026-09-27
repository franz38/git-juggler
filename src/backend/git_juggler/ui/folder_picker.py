from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys

from ..schemas import BrowseDirectoryResponse, BrowseEntry


class NativePickerUnavailable(Exception):
    """No native folder dialog can be shown on this machine."""


def browse_directory(raw_path: str | None) -> BrowseDirectoryResponse:
    """List the subdirectories of a path, for the repo-search-path folder
    picker. Read-only -- never creates, renames, or deletes anything."""
    path = Path(raw_path).expanduser().resolve() if raw_path else Path.home()
    if not path.is_dir():
        path = path.parent if path.parent.is_dir() else Path.home()

    entries: list[BrowseEntry] = []
    try:
        for child in sorted(path.iterdir(), key=lambda p: p.name.lower()):
            try:
                if child.is_dir():
                    entries.append(BrowseEntry(name=child.name, path=str(child)))
            except OSError:
                continue
    except PermissionError:
        pass

    parent = str(path.parent) if path.parent != path else None
    return BrowseDirectoryResponse(path=str(path), parent=parent, entries=entries)


def _command() -> list[str]:
    if sys.platform == "darwin":
        return [
            "osascript",
            "-e",
            'POSIX path of (choose folder with prompt "Choose a folder to scan for git repos")',
        ]
    if sys.platform == "win32":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"
        )
        return ["powershell", "-NoProfile", "-STA", "-Command", script]
    if shutil.which("zenity"):
        return ["zenity", "--file-selection", "--directory"]
    if shutil.which("kdialog"):
        return ["kdialog", "--getexistingdirectory", "."]
    raise NativePickerUnavailable("no zenity or kdialog found")


def pick_folder() -> str | None:
    """Show the OS's native folder dialog and return the chosen absolute path,
    or None if the user cancelled. Only meaningful when the backend runs on the
    same machine as the browser. Read-only -- nothing on disk is touched."""
    cmd = _command()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise NativePickerUnavailable(str(e)) from e
    if proc.returncode != 0:
        # osascript exits non-zero on cancel ("User canceled"); zenity/kdialog exit 1.
        return None
    path = proc.stdout.strip()
    if len(path) > 1:
        path = path.rstrip("/\\") or path
    return path or None

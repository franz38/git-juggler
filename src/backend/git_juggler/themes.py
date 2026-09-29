"""Read-only discovery of installed VS Code color themes.

VS Code extensions declare themes in ``package.json`` under
``contributes.themes``; each entry points at a JSONC file with a ``colors``
map and an optional ``include`` that chains to a parent theme. We flatten the
chain here (the browser can't read those files) and hand the frontend a plain
``{id, label, uiTheme, colors}`` per theme.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .schemas import VscodeTheme

_HOME = Path.home()
_LOCAL_APPDATA = os.environ.get("LOCALAPPDATA")
_PROGRAM_FILES = os.environ.get("ProgramFiles")


def _windows_builtin_extension_roots() -> list[Path]:
    """Built-in-theme roots for the user-scope and machine-scope Windows
    installers. Most installs put extensions directly under
    ``resources/app``, but some updates nest an extra content-hash directory
    (e.g. ``Microsoft VS Code/7debcd0e2a/resources/app/extensions``,
    referenced by that install's own ``bin/code.cmd`` launcher) -- so both
    the direct path and a one-level-deep glob are checked."""
    roots: list[Path] = []
    install_roots: list[Path] = []
    if _LOCAL_APPDATA:
        install_roots.append(Path(_LOCAL_APPDATA) / "Programs" / "Microsoft VS Code")
    if _PROGRAM_FILES:
        install_roots.append(Path(_PROGRAM_FILES) / "Microsoft VS Code")
    for install_root in install_roots:
        roots.append(install_root / "resources" / "app" / "extensions")
        try:
            roots.extend(install_root.glob("*/resources/app/extensions"))
        except OSError:
            pass
    return roots


# Directories that contain one sub-directory per extension.
EXTENSION_ROOTS: list[Path] = [
    _HOME / ".vscode" / "extensions",
    _HOME / ".vscode-insiders" / "extensions",
    # Built-in themes shipped with the app (Dark Modern, Solarized, ...).
    Path("/Applications/Visual Studio Code.app/Contents/Resources/app/extensions"),
    Path("/usr/share/code/resources/app/extensions"),
    Path("/usr/lib/code/extensions"),
    *_windows_builtin_extension_roots(),
]

_MAX_INCLUDE_DEPTH = 8


def strip_jsonc(text: str) -> str:
    """Remove ``//`` and ``/* */`` comments and trailing commas, outside strings."""
    out: list[str] = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True
            out.append(c)
            i += 1
        elif c == "/" and text[i + 1 : i + 2] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and text[i + 1 : i + 2] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
        else:
            out.append(c)
            i += 1
    stripped = "".join(out)
    # Trailing commas: safe as a regex now because comments are gone and a
    # string containing ",}" would have to be ",}" inside quotes, which we guard
    # against by only matching when the comma is followed by whitespace + closer
    # and is not inside a string (checked by a second string-aware pass).
    result: list[str] = []
    in_str = False
    j, m = 0, len(stripped)
    while j < m:
        c = stripped[j]
        if in_str:
            result.append(c)
            if c == "\\" and j + 1 < m:
                result.append(stripped[j + 1])
                j += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            result.append(c)
        elif c == ",":
            k = j + 1
            while k < m and stripped[k].isspace():
                k += 1
            if k >= m or stripped[k] not in "}]":
                result.append(c)
        else:
            result.append(c)
        j += 1
    return "".join(result)


def _load_json(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None
    # Most files (every package.json, many themes) are strict JSON: parse them
    # with the C parser and only fall back to the slow pure-Python JSONC
    # stripper when that fails. Stripping large extension manifests up front
    # made a full scan take seconds.
    try:
        data = json.loads(text)
    except ValueError:
        try:
            data = json.loads(strip_jsonc(text))
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def load_theme_colors(path: Path, ext_dir: Path, _depth: int = 0) -> dict[str, str] | None:
    """Colors of the theme at ``path``, with its ``include`` chain merged in.

    Only files inside ``ext_dir`` are followed, so a crafted theme can't make
    us read arbitrary files.
    """
    if _depth > _MAX_INCLUDE_DEPTH or not _inside(path, ext_dir):
        return None
    data = _load_json(path)
    if data is None:
        return None

    colors: dict[str, str] = {}
    include = data.get("include")
    if isinstance(include, str):
        parent = load_theme_colors((path.parent / include).resolve(), ext_dir, _depth + 1)
        if parent:
            colors.update(parent)

    own = data.get("colors")
    if isinstance(own, dict):
        colors.update({k: v for k, v in own.items() if isinstance(k, str) and isinstance(v, str)})
    return colors


_NLS_REF = re.compile(r"^%(.+)%$")


def _localize(label: str, nls: dict) -> str:
    m = _NLS_REF.match(label)
    if not m:
        return label
    value = nls.get(m.group(1))
    if isinstance(value, dict):  # {"message": "...", "comment": [...]}
        value = value.get("message")
    return value if isinstance(value, str) else m.group(1)


_VERSIONED_DIR = re.compile(r"^(?P<name>.+?)-(?P<version>\d+(?:\.\d+)*)(?:-.+)?$")


def _split_extension_dir(name: str) -> tuple[str, tuple[int, ...]]:
    """``pub.ext-1.2.3-darwin-arm64`` -> (``pub.ext``, (1, 2, 3)).

    The id we hand out must survive extension upgrades, so it omits the version.
    """
    m = _VERSIONED_DIR.match(name)
    if not m:
        return name, ()
    return m.group("name"), tuple(int(p) for p in m.group("version").split("."))


def discover_themes(roots: list[Path] | None = None) -> list[VscodeTheme]:
    # id -> (extension version, theme); when several versions of the same
    # extension are installed, the newest wins.
    found: dict[str, tuple[tuple[int, ...], VscodeTheme]] = {}

    for root in roots if roots is not None else EXTENSION_ROOTS:
        try:
            ext_dirs = sorted(p for p in root.iterdir() if p.is_dir())
        except OSError:
            continue

        for ext_dir in ext_dirs:
            package = _load_json(ext_dir / "package.json")
            contributed = ((package or {}).get("contributes") or {}).get("themes")
            if not isinstance(contributed, list):
                continue
            nls = _load_json(ext_dir / "package.nls.json") or {}

            for entry in contributed:
                if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                    continue
                ext_name, version = _split_extension_dir(ext_dir.name)
                theme_id = f"vscode:{ext_name}/{entry['path'].removeprefix('./')}"
                if theme_id in found and found[theme_id][0] >= version:
                    continue
                colors = load_theme_colors(ext_dir / entry["path"], ext_dir)
                if not colors:
                    continue
                label = entry.get("label") or entry.get("id") or Path(entry["path"]).stem
                found[theme_id] = (
                    version,
                    VscodeTheme(
                        id=theme_id,
                        label=_localize(str(label), nls),
                        uiTheme=str(entry.get("uiTheme") or "vs-dark"),
                        colors=colors,
                    ),
                )

    return sorted((t for _, t in found.values()), key=lambda t: t.label.lower())

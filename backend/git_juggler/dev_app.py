"""ASGI app factory used only by `uvicorn --reload`, which needs an import
string (not a live app object) so it can restart the app in a subprocess.
The scanned root path is passed through an env var by main.py.
"""

from __future__ import annotations

import os
from pathlib import Path

from .app import create_app

_root_path = Path(os.environ["GIT_JUGGLER_ROOT"])
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

app = create_app(_root_path, frontend_dist=_frontend_dist if _frontend_dist.exists() else None)

from __future__ import annotations

import argparse
import os
import threading
import webbrowser
from importlib import resources
from pathlib import Path

import uvicorn

from .app import create_app


def packaged_frontend_dist() -> Path | None:
    candidate = resources.files("git_juggler").joinpath("frontend_dist")
    if candidate.is_dir():
        return Path(str(candidate))

    # Local fallback for running from the source tree after `npm run build`.
    source_tree_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
    if source_tree_dist.exists():
        return source_tree_dist

    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="git-juggler")
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Directory whose first-level children will be scanned for git repos (default: cwd)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="Enable dev auto-reload")
    parser.add_argument("--no-open", action="store_true", help="Do not open the app in a browser")
    return parser.parse_args(argv)


def browser_url(host: str, port: int) -> str:
    browse_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    return f"http://{browse_host}:{port}"


def cli() -> None:
    args = parse_args()
    root_path = Path(args.path).expanduser().resolve()
    if not root_path.is_dir():
        raise SystemExit(f"Not a directory: {root_path}")

    if not args.no_open:
        threading.Timer(0.75, webbrowser.open, args=(browser_url(args.host, args.port),)).start()

    if args.reload:
        os.environ["GIT_JUGGLER_ROOT"] = str(root_path)
        uvicorn.run("git_juggler.dev_app:app", host=args.host, port=args.port, reload=True)
    else:
        app = create_app(root_path, frontend_dist=packaged_frontend_dist())
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    cli()

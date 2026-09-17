from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app


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
    return parser.parse_args(argv)


def cli() -> None:
    args = parse_args()
    root_path = Path(args.path).expanduser().resolve()
    if not root_path.is_dir():
        raise SystemExit(f"Not a directory: {root_path}")

    if args.reload:
        os.environ["GIT_JUGGLER_ROOT"] = str(root_path)
        uvicorn.run("git_juggler.dev_app:app", host=args.host, port=args.port, reload=True)
    else:
        frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
        app = create_app(root_path, frontend_dist=frontend_dist if frontend_dist.exists() else None)
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    cli()

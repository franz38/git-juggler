from __future__ import annotations

import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


# On Windows every git.exe launch would otherwise flash a console window.
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Process spawn (and the pipe round trip) dominates the cost of every call
# here, most of all on Windows, so independent git invocations run concurrently.
GIT_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="git-data")


class GitCommandError(RuntimeError):
    pass


def run_git(repo_path: Path, *args: str, stdin: str | None = None) -> str:
    """Run one read-only git command and return its stdout.

    `--no-optional-locks` keeps `git status` from refreshing (and so locking)
    the index behind the user's back while they run their own git commands.
    Output is decoded leniently: a commit message in some odd encoding must not
    take the whole graph down.
    """
    proc = subprocess.run(
        ["git", "--no-optional-locks", *args],
        cwd=repo_path,
        input=stdin.encode("utf-8") if stdin is not None else None,
        stdin=None if stdin is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=CREATE_NO_WINDOW,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise GitCommandError(
            f"git {' '.join(args[:2])} failed ({proc.returncode}): {detail}"
        )
    return proc.stdout.decode("utf-8", errors="replace")


def run_git_or_empty(repo_path: Path, *args: str) -> str:
    try:
        return run_git(repo_path, *args)
    except GitCommandError:
        return ""

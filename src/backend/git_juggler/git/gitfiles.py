"""A checkout's layout and HEAD read straight from git's own files.

The same small files `git rev-parse` reads, without spawning git: a few reads
instead of a process (which is what costs, especially on Windows). Anything
outside the everyday layouts raises UnsupportedLayout so callers can ask git.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

HEADS = "refs/heads/"
_OBJECT_ID = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")  # SHA-1 or SHA-256


class UnsupportedLayout(Exception):
    """A layout these readers don't handle (bare repo, reftable, symbolic
    branch ref, being inside .git, unexpected content, ...): ask git."""


def resolve_git_dir(dot_git: Path) -> Path:
    """Resolve a repo's own git-dir from its `.git` entry: a plain directory
    for a normal checkout, or (for a worktree checkout) a file containing
    `gitdir: <path>` pointing at the real one under the main repo's
    `.git/worktrees/<name>`."""
    if dot_git.is_dir():
        return dot_git
    content = dot_git.read_text(encoding="utf-8", errors="replace").strip()
    prefix = "gitdir:"
    if not content.lower().startswith(prefix):
        return dot_git
    target = Path(content[len(prefix) :].strip())
    if not target.is_absolute():
        target = (dot_git.parent / target).resolve()
    return target


def resolve_common_dir(git_dir: Path) -> Path:
    """No-subprocess equivalent of `git rev-parse --git-common-dir`: reads
    the same `commondir` file GitPython's own `common_dir` property reads
    internally. Absent for a non-worktree repo, whose own git-dir already
    *is* the common dir."""
    commondir_file = git_dir / "commondir"
    try:
        content = commondir_file.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return git_dir
    common = Path(content)
    if not common.is_absolute():
        common = (git_dir / common).resolve()
    return common


@dataclass(frozen=True)
class Checkout:
    top_level: Path  # `git rev-parse --show-toplevel`
    git_dir: Path  # this checkout's own git-dir (holds HEAD)
    common_dir: Path  # `git rev-parse --git-common-dir` (holds the branches)


def find_checkout(directory: Path) -> Checkout | None:
    """The checkout containing `directory` (an existing, resolved directory),
    found the way git discovers it: the nearest ancestor with a `.git` entry.
    None when there is none (not in a repo)."""
    for candidate in (directory, *directory.parents):
        if candidate.name == ".git":
            raise UnsupportedLayout("inside a git-dir")
        dot_git = candidate / ".git"
        try:
            found = dot_git.exists()
        except OSError as exc:
            raise UnsupportedLayout(str(exc)) from exc
        if not found:
            if (candidate / "HEAD").is_file() and (candidate / "objects").is_dir():
                raise UnsupportedLayout("bare repository or git-dir")
            continue
        try:
            git_dir = resolve_git_dir(dot_git)
            if not (git_dir / "HEAD").is_file():
                raise UnsupportedLayout(f"no HEAD in {git_dir}")
            return Checkout(top_level=candidate, git_dir=git_dir, common_dir=resolve_common_dir(git_dir))
        except OSError as exc:
            raise UnsupportedLayout(str(exc)) from exc
    return None


def read_head(checkout: Checkout) -> tuple[str | None, str] | None:
    """(branch, commit) of the checkout's HEAD, branch None when detached.
    None for a branch with no commits yet (where `git rev-parse HEAD` fails)."""
    try:
        content = (checkout.git_dir / "HEAD").read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise UnsupportedLayout(str(exc)) from exc
    if _OBJECT_ID.fullmatch(content):
        return None, content
    if not content.startswith("ref: "):
        raise UnsupportedLayout(f"unexpected HEAD: {content[:40]!r}")
    ref = content[len("ref: ") :].strip()
    if not ref.startswith(HEADS):
        raise UnsupportedLayout(f"HEAD points outside refs/heads: {ref}")
    commit = read_branch_commit(checkout.common_dir, ref)
    return (ref[len(HEADS) :], commit) if commit is not None else None


def read_branch_commit(common_dir: Path, ref: str) -> str | None:
    """The commit a branch ref points at: its loose ref file, else its line
    in packed-refs. None if it exists in neither (a branch with no commits)."""
    if (common_dir / "reftable").exists():
        raise UnsupportedLayout("reftable ref storage")
    try:
        value: str | None = common_dir.joinpath(*ref.split("/")).read_text(encoding="utf-8").strip()
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError):
        value = None
    except OSError as exc:
        raise UnsupportedLayout(str(exc)) from exc
    if value is not None:
        if _OBJECT_ID.fullmatch(value):
            return value
        raise UnsupportedLayout(f"{ref} is not a plain commit ref")
    try:
        packed = (common_dir / "packed-refs").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise UnsupportedLayout(str(exc)) from exc
    for line in packed:
        if not line or line[0] in "#^":
            continue
        commit, _, name = line.partition(" ")
        if name == ref and _OBJECT_ID.fullmatch(commit):
            return commit
    return None

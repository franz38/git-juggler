from __future__ import annotations

import re
from pathlib import Path

from git import Repo

from .schemas import FileDiff

# Patches beyond this size are cut off; a side-by-side view of a multi-MB diff
# would freeze the browser anyway.
MAX_PATCH_BYTES = 1_000_000

# Object id of git's empty tree, used as the "before" side for root commits and
# for repos that have no HEAD yet.
_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

# Context lines big enough to make git emit the whole file as a single hunk.
_FULL_CONTEXT = "-U1000000"

_BINARY_RE = re.compile(r"^(Binary files .* differ|GIT binary patch)$", re.MULTILINE)


def _build_result(raw: bytes) -> FileDiff:
    text = raw[:MAX_PATCH_BYTES].decode("utf-8", errors="replace")
    if _BINARY_RE.search(text):
        return FileDiff(patch="", binary=True)
    return FileDiff(patch=text, truncated=len(raw) > MAX_PATCH_BYTES)


def _run_diff(repo: Repo, *args: str) -> bytes:
    # `--no-index` exits 1 when the files differ, so a non-zero status is not an error.
    out = repo.git.diff(
        "--no-color",
        *args,
        with_exceptions=False,
        stdout_as_string=False,
        strip_newline_in_stdout=False,
    )
    return out if isinstance(out, bytes) else out.encode()


def _context(full: bool) -> list[str]:
    return [_FULL_CONTEXT] if full else []


def _paths(path: str, old_path: str | None) -> list[str]:
    return [old_path, path] if old_path and old_path != path else [path]


def get_commit_file_diff(repo_path: Path, sha: str, path: str, old_path: str | None = None, full: bool = False) -> FileDiff:
    repo = Repo(repo_path)
    commit = repo.commit(sha)
    base = commit.parents[0].hexsha if commit.parents else _EMPTY_TREE
    raw = _run_diff(repo, "-M", *_context(full), base, commit.hexsha, "--", *_paths(path, old_path))
    return _build_result(raw)


def get_working_file_diff(repo_path: Path, path: str, old_path: str | None = None, full: bool = False) -> FileDiff:
    repo = Repo(repo_path)
    root = Path(repo.working_tree_dir or repo_path).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError("path escapes the repository")

    tracked = bool(repo.git.ls_files("--", path).strip())
    if not tracked:
        if not target.is_file():
            raise FileNotFoundError(path)
        raw = _run_diff(repo, "--no-index", "--", "/dev/null", path)
        return _build_result(raw)

    base = "HEAD" if repo.head.is_valid() else _EMPTY_TREE
    raw = _run_diff(repo, "-M", *_context(full), base, "--", *_paths(path, old_path))
    return _build_result(raw)

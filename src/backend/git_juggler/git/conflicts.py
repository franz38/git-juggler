from __future__ import annotations

import json
import secrets
from pathlib import Path

from .. import config
from ..schemas import ConflictFile, ConflictFileContent, ConflictState
from .command import GitCommandError, run_git, run_git_bytes, run_git_or_empty
from .status import ParsedStatus

MAX_CONFLICT_FILE_BYTES = 1_000_000

_CONFLICT_LABELS = {
    "DD": "both_deleted",
    "AU": "added_by_us",
    "UD": "deleted_by_them",
    "UA": "added_by_them",
    "DU": "deleted_by_us",
    "AA": "both_added",
    "UU": "both_modified",
}


def _git_path(repo_path: Path, name: str) -> Path | None:
    raw = run_git_or_empty(repo_path, "rev-parse", "--git-path", name).strip()
    if not raw:
        return None
    return (repo_path / raw).resolve() if not Path(raw).is_absolute() else Path(raw)


def conflict_operation(repo_path: Path) -> str | None:
    checks = [
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
    ]
    for name, operation in checks:
        path = _git_path(repo_path, name)
        if path and path.exists():
            return operation
    return None


def _stages_by_path(repo_path: Path) -> dict[str, set[int]]:
    raw = run_git_or_empty(repo_path, "ls-files", "-u", "-z")
    stages: dict[str, set[int]] = {}
    for token in raw.split("\x00"):
        if not token:
            continue
        meta, _, path = token.partition("\t")
        parts = meta.split(" ")
        if len(parts) < 3 or not path:
            continue
        try:
            stage = int(parts[2])
        except ValueError:
            continue
        stages.setdefault(path, set()).add(stage)
    return stages


def build_conflict_state(repo_path: Path, parsed: ParsedStatus) -> ConflictState:
    operation = conflict_operation(repo_path)
    stages = _stages_by_path(repo_path) if parsed.conflicts else {}
    files = [
        ConflictFile(
            path=path,
            status=_CONFLICT_LABELS.get(code, "unmerged"),
            base_available=1 in stages.get(path, set()),
            ours_available=2 in stages.get(path, set()),
            theirs_available=3 in stages.get(path, set()),
        )
        for path, code in sorted(parsed.conflicts.items())
    ]
    return ConflictState(
        operation=operation,
        files=files,
        can_continue=operation is not None and not files,
    )


def _repo_root(repo_path: Path) -> Path:
    raw = run_git(repo_path, "rev-parse", "--show-toplevel").strip()
    return Path(raw).resolve()


def _safe_worktree_path(repo_path: Path, path: str) -> Path:
    root = _repo_root(repo_path)
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError("path escapes the repository")
    return target


def _decode_content(raw: bytes) -> tuple[str | None, bool, bool]:
    if len(raw) > MAX_CONFLICT_FILE_BYTES:
        return None, False, True
    if b"\x00" in raw[:8192]:
        return None, True, False
    return raw.decode("utf-8", errors="replace"), False, False


def _stage_content(repo_path: Path, stage: int, path: str) -> tuple[str | None, bool, bool]:
    try:
        return _decode_content(run_git_bytes(repo_path, "show", f":{stage}:{path}"))
    except GitCommandError:
        return None, False, False


def get_conflict_file_content(repo_path: Path, path: str) -> ConflictFileContent:
    target = _safe_worktree_path(repo_path, path)
    binary = False
    too_large = False

    base, stage_binary, stage_large = _stage_content(repo_path, 1, path)
    binary = binary or stage_binary
    too_large = too_large or stage_large
    ours, stage_binary, stage_large = _stage_content(repo_path, 2, path)
    binary = binary or stage_binary
    too_large = too_large or stage_large
    theirs, stage_binary, stage_large = _stage_content(repo_path, 3, path)
    binary = binary or stage_binary
    too_large = too_large or stage_large

    worktree = None
    if target.is_file():
        try:
            worktree, worktree_binary, worktree_large = _decode_content(target.read_bytes())
            binary = binary or worktree_binary
            too_large = too_large or worktree_large
        except OSError:
            worktree = None

    if binary or too_large:
        base = ours = theirs = worktree = None
    return ConflictFileContent(
        path=path,
        binary=binary,
        too_large=too_large,
        base=base,
        ours=ours,
        theirs=theirs,
        worktree=worktree,
    )


def _token_dir() -> Path:
    path = config.CONFIG_DIR / "resolve-tokens"
    path.mkdir(parents=True, exist_ok=True)
    return path


def create_resolution_token(repo_id: str, path: str, content: str) -> str:
    token = secrets.token_urlsafe(24)
    payload = {"repo_id": repo_id, "path": path, "content": content}
    (_token_dir() / f"{token}.json").write_text(json.dumps(payload), encoding="utf-8")
    return token


def consume_resolution_token(token: str, expected_path: str, repo_path: Path) -> None:
    if not token or "/" in token or "\\" in token:
        raise ValueError("invalid token")
    token_path = _token_dir() / f"{token}.json"
    payload = json.loads(token_path.read_text(encoding="utf-8"))
    path = payload.get("path")
    content = payload.get("content")
    if path != expected_path or not isinstance(content, str):
        raise ValueError("resolution token does not match this file")
    target = _safe_worktree_path(repo_path, expected_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    token_path.unlink(missing_ok=True)

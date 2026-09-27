from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..schemas import FileChange


STATUS_ARGS = ("status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")
NUMSTAT_ARGS = ("diff", "HEAD", "--numstat", "-z")

# Untracked files bigger than this aren't read just to count their lines.
UNTRACKED_COUNT_LIMIT = 1024 * 1024


def diff_status(change_type: str) -> str:
    return {
        "A": "added",
        "D": "deleted",
        "M": "modified",
        "R": "renamed",
        "T": "modified",
    }.get(change_type, "modified")


def is_excluded(path: str, excluded_paths: list[str]) -> bool:
    normalized = path.strip("/")
    for excluded in excluded_paths:
        norm = excluded.strip().strip("/")
        if norm and (normalized == norm or normalized.startswith(f"{norm}/")):
            return True
    return False


@dataclass
class ParsedStatus:
    current_branch: str | None = None
    head_commit: str | None = None
    changes: dict[str, str] = field(default_factory=dict)


def parse_status(raw: str) -> ParsedStatus:
    """Parse `git status --porcelain=v2 --branch -z`: the branch header plus
    staged, unstaged and untracked changes in a single pass over the tree."""
    parsed = ParsedStatus()
    tokens = raw.split("\x00")
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if not token:
            continue
        kind = token[0]
        if kind == "#":
            header, _, value = token[2:].partition(" ")
            if header == "branch.oid":
                parsed.head_commit = None if value == "(initial)" else value
            elif header == "branch.head":
                parsed.current_branch = None if value == "(detached)" else value
            continue
        if kind == "?":
            parsed.changes[token[2:]] = "untracked"
            continue
        if kind == "1":
            fields = token.split(" ", 8)
            xy, path = fields[1], fields[8]
        elif kind == "2":
            fields = token.split(" ", 9)
            xy, path = fields[1], fields[9]
            i += 1  # the rename source path follows as its own NUL-terminated field
        elif kind == "u":
            fields = token.split(" ", 10)
            xy, path = "MM", fields[10]
        else:
            continue
        staged, unstaged = xy[0], xy[1]
        # An unstaged change on top of a staged one wins, as before.
        change = unstaged if unstaged != "." else staged
        parsed.changes[path] = diff_status(change)
    return parsed


def parse_numstat(raw: str) -> dict[str, tuple[int, int] | None]:
    """Parse `git diff --numstat -z`: path -> (additions, deletions), or None
    for binary files. Renames list the destination path."""
    stats: dict[str, tuple[int, int] | None] = {}
    tokens = raw.split("\x00")
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if not token:
            continue
        added, _, rest = token.partition("\t")
        deleted, _, path = rest.partition("\t")
        if not path:
            # Rename/copy: source and destination follow as their own fields.
            path = tokens[i + 1] if i + 1 < len(tokens) else ""
            i += 2
        if not path:
            continue
        stats[path] = (
            (int(added), int(deleted))
            if added.isdigit() and deleted.isdigit()
            else None
        )
    return stats


def count_untracked_lines(repo_path: Path, path: str) -> int | None:
    try:
        file_path = repo_path / path
        if file_path.stat().st_size > UNTRACKED_COUNT_LIMIT:
            return None
        data = file_path.read_bytes()
    except OSError:
        return None
    if b"\x00" in data[:8192]:
        return None
    return data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)


def uncommitted_files(
    parsed: ParsedStatus,
    excluded_paths: list[str],
    numstat_raw: str = "",
    repo_path: Path | None = None,
) -> list[FileChange]:
    stats = parse_numstat(numstat_raw)
    files: list[FileChange] = []
    for path, status in sorted(parsed.changes.items()):
        if is_excluded(path, excluded_paths):
            continue
        counts = stats.get(path)
        if status == "untracked" and repo_path is not None:
            lines = count_untracked_lines(repo_path, path)
            counts = (lines, 0) if lines is not None else None
        files.append(
            FileChange(
                path=path,
                status=status,
                additions=counts[0] if counts else None,
                deletions=counts[1] if counts else None,
            )
        )
    return files

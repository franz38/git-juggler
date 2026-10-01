from __future__ import annotations

import re
from pathlib import Path

from ..schemas import CommitDetail, FileChange, PersonInfo
from .command import run_git
from .status import parse_numstat

_STATUS_MAP = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "modified",
}

# A hex object name only: the value goes on git's command line, so anything
# else (e.g. a leading "-") must never reach it.
_SHA = re.compile(r"[0-9a-fA-F]{4,64}")

# No field can contain a NUL, and the raw message (%B) comes last, so the
# output splits cleanly into these nine fields followed by the diff.
_DETAIL_FIELDS = 9
_DETAIL_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%B"

# Metadata, file list and line counts from one git process. Process spawn is
# what costs, most of all on Windows; this used to take four of them (two
# GitPython cat-file helpers, a diff-tree and a numstat diff, both of which
# redid rename detection).
_DETAIL_ARGS = (
    # -m --first-parent: a merge is diffed against its first parent only, i.e.
    # what it brought into the branch. Pinning log.diffMerges keeps a user's
    # own setting (e.g. "combined") from replacing that; git versions that
    # predate the setting ignore it and already behave this way.
    "-c", "log.diffMerges=first-parent",
    "log", "-1", "--no-walk",
    "--no-show-signature", "--no-color", "--encoding=UTF-8",
    "-m", "--first-parent",
    # The initial commit diffs against the empty tree even with log.showRoot=false.
    "--root",
    "-M", "--raw", "--numstat", "-z",
    f"--format={_DETAIL_FORMAT}",
)


def _parse_files(diff: str) -> list[FileChange]:
    """Parse `--raw --numstat -z` output: every raw entry first (one path, or
    source and destination for a rename/copy), then the numstat entries for
    the same files."""
    tokens = diff.lstrip("\n").split("\x00")
    changes: list[tuple[str, str, str | None]] = []
    i = 0
    while i < len(tokens) and tokens[i].startswith(":"):
        status = tokens[i].rsplit(" ", 1)[-1][:1]
        if status in ("R", "C") and i + 2 < len(tokens):
            old_path, path = tokens[i + 1], tokens[i + 2]
            i += 3
        elif i + 1 < len(tokens):
            old_path, path = None, tokens[i + 1]
            i += 2
        else:
            break
        changes.append((status, path, old_path if old_path != path else None))
    stats = parse_numstat("\x00".join(tokens[i:]))

    files: list[FileChange] = []
    for status, path, old_path in changes:
        counts = stats.get(path)
        files.append(
            FileChange(
                path=path,
                status=_STATUS_MAP.get(status, "modified"),
                old_path=old_path,
                additions=counts[0] if counts else None,
                deletions=counts[1] if counts else None,
            )
        )
    files.sort(key=lambda f: f.path)
    return files


def get_commit_detail(repo_path: Path, sha: str) -> CommitDetail:
    if not _SHA.fullmatch(sha):
        raise ValueError(f"not a commit hash: {sha!r}")
    raw = run_git(repo_path, *_DETAIL_ARGS, sha, "--")
    fields = raw.split("\x00", _DETAIL_FIELDS)
    if len(fields) < _DETAIL_FIELDS:
        raise LookupError(f"commit not found: {sha}")
    hexsha, parents, author_name, author_email, committer_name, committer_email, authored, committed = fields[:8]
    message = fields[8]
    diff = fields[9] if len(fields) > _DETAIL_FIELDS else ""

    return CommitDetail(
        hash=hexsha,
        short_hash=hexsha[:7],
        parents=parents.split(),
        author=PersonInfo(name=author_name, email=author_email),
        committer=PersonInfo(name=committer_name, email=committer_email),
        authored_date=authored,
        committed_date=committed,
        subject=message.split("\n", 1)[0],
        message=message,
        files=_parse_files(diff),
    )

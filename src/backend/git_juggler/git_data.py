from __future__ import annotations

import hashlib
import subprocess
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

from . import config
from .git_utils import parse_worktree_branches
from .schemas import CommitSummary, FileChange, PersonInfo, RefsInfo, RepoStatusResponse

# Commits per graph page. The graph endpoint returns the newest page first and
# the frontend asks for the next (older) page when the user scrolls to the end.
GRAPH_PAGE_SIZE = 1000

# On Windows every git.exe launch would otherwise flash a console window.
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Process spawn (and the pipe round trip) dominates the cost of every call
# here, most of all on Windows, so independent git invocations run concurrently.
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="git-data")


class GitCommandError(RuntimeError):
    pass


class HistoryChangedError(LookupError):
    """The page cursor is no longer part of the repo's history."""


def _run_git(repo_path: Path, *args: str, stdin: str | None = None) -> str:
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
        creationflags=_CREATE_NO_WINDOW,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise GitCommandError(
            f"git {' '.join(args[:2])} failed ({proc.returncode}): {detail}"
        )
    return proc.stdout.decode("utf-8", errors="replace")


def _run_git_or_empty(repo_path: Path, *args: str) -> str:
    try:
        return _run_git(repo_path, *args)
    except GitCommandError:
        return ""


# --- refs -------------------------------------------------------------------

_REF_FORMAT = "%(refname)%09%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(committerdate:unix)%09%(upstream)%09%(upstream:remotename)"
_HEADS = "refs/heads/"
_TAGS = "refs/tags/"
_REMOTES = "refs/remotes/"


@dataclass(frozen=True)
class _Ref:
    name: str  # full ref name, e.g. refs/heads/main
    object_sha: (
        str  # what the ref itself points at (the tag object, for annotated tags)
    )
    commit: str | None  # the commit it resolves to, None when it isn't one
    date: int  # committer date of that commit (0 when unknown)
    upstream: str
    upstream_remote: str

    @property
    def short(self) -> str:
        for prefix in (_HEADS, _TAGS, _REMOTES):
            if self.name.startswith(prefix):
                return self.name[len(prefix) :]
        return self.name


def _parse_refs(raw: str) -> list[_Ref]:
    refs: list[_Ref] = []
    for line in raw.split("\n"):
        fields = line.split("\t")
        if len(fields) < 8:
            continue
        name, sha, kind, peeled_sha, peeled_kind, date, upstream, upstream_remote = (
            fields[:8]
        )
        commit = (
            sha
            if kind == "commit"
            else (peeled_sha if peeled_kind == "commit" else None)
        )
        refs.append(
            _Ref(
                name=name,
                object_sha=sha,
                commit=commit,
                date=int(date) if date.isdigit() else 0,
                upstream=upstream,
                upstream_remote=upstream_remote,
            )
        )
    return refs


def _is_remote_head(ref: _Ref) -> bool:
    return ref.name.startswith(_REMOTES) and ref.name.endswith("/HEAD")


def _refs_signature(refs: list[_Ref], worktree_branches: list[str]) -> str:
    """Cheap fingerprint of every ref plus the worktree branch set, so the
    frontend can notice new/moved/deleted branches, tags and worktrees."""
    parts = [f"{ref.name}={ref.object_sha}" for ref in refs]
    parts.extend(f"wt:{b}" for b in sorted(worktree_branches))
    return hashlib.sha1("\n".join(sorted(parts)).encode()).hexdigest()


# --- stashes ----------------------------------------------------------------


@dataclass(frozen=True)
class StashInfo:
    ref: str
    sha: str
    base_sha: str
    committed_date: int


def _parse_stashes(raw: str) -> list[StashInfo]:
    """Stashes as graphable side commits.

    Git represents a stash as a synthetic merge commit whose first parent is
    the commit it was created from. The other parents are implementation
    details for index/untracked state, so the graph only draws the base edge.
    """
    stashes: list[StashInfo] = []
    for line in raw.split("\n"):
        fields = line.split("\t")
        if len(fields) < 4 or not fields[0] or not fields[1]:
            continue
        ref, sha, parents, date = fields[:4]
        base = parents.split(" ")[0] if parents else ""
        if not base:
            continue
        stashes.append(
            StashInfo(
                ref=ref,
                sha=sha,
                base_sha=base,
                committed_date=int(date) if date.isdigit() else 0,
            )
        )
    return stashes


_STASH_ARGS = ("stash", "list", "--format=%gd%x09%H%x09%P%x09%ct")


# --- history (ordering + branch ownership), cached per refs state ------------


@dataclass
class _History:
    key: str
    ordered: list[str]  # every commit, oldest first (stashes spliced in by date)
    parents: dict[str, list[str]]
    owner: dict[str, str]
    stashes_by_commit: dict[str, list[str]]
    positions: dict[str, int] = field(default_factory=dict)


_HISTORY_CACHE_SIZE = 8
_history_cache: OrderedDict[str, _History] = OrderedDict()
_history_lock = threading.Lock()


def _cache_get(repo_key: str, key: str | None) -> _History | None:
    with _history_lock:
        history = _history_cache.get(repo_key)
        if history is None or (key is not None and history.key != key):
            return None
        _history_cache.move_to_end(repo_key)
        return history


def _cache_put(repo_key: str, history: _History) -> None:
    with _history_lock:
        _history_cache[repo_key] = history
        _history_cache.move_to_end(repo_key)
        while len(_history_cache) > _HISTORY_CACHE_SIZE:
            _history_cache.popitem(last=False)


def _head_sort_key(ref: _Ref, current_branch: str | None) -> tuple[int, int]:
    """Current branch first, then main/master, then most-recently-committed."""
    name = ref.short
    if current_branch and name == current_branch:
        priority = 0
    elif name in ("main", "master"):
        priority = 1
    else:
        priority = 2
    return (priority, -ref.date)


def _history_key(refs: list[_Ref], stash_raw: str, current_branch: str | None) -> str:
    parts = [
        f"{ref.name}={ref.object_sha}"
        for ref in refs
        if ref.name.startswith((_HEADS, _TAGS, _REMOTES))
    ]
    parts.sort()
    parts.append(f"stash:{stash_raw}")
    parts.append(f"current:{current_branch}")
    return hashlib.sha1("\n".join(parts).encode()).hexdigest()


def _build_history(
    repo_path: Path,
    refs: list[_Ref],
    stashes: list[StashInfo],
    current_branch: str | None,
    key: str,
) -> _History:
    heads = [r for r in refs if r.name.startswith(_HEADS) and r.commit]
    tags = [r for r in refs if r.name.startswith(_TAGS) and r.commit]
    remote_refs = [
        r
        for r in refs
        if r.name.startswith(_REMOTES) and r.commit and not _is_remote_head(r)
    ]

    # Walk history reachable from branches, tags, remotes, and stash bases, then
    # explicitly add stash commits as side nodes. Including stash bases keeps a
    # stash attached after its original base was abandoned by a rebase.
    # We still avoid `--all` so remote-tracking branches do not silently expand
    # the local graph.
    tips: list[str] = []
    seen_tips: set[str] = set()
    for ref in [*heads, *tags, *remote_refs]:
        if ref.commit not in seen_tips:
            seen_tips.add(ref.commit)
            tips.append(ref.commit)
    for stash in stashes:
        if stash.base_sha not in seen_tips:
            seen_tips.add(stash.base_sha)
            tips.append(stash.base_sha)

    # One light listing of the whole history (sha, parents, date). Per-commit
    # metadata is only fetched later, for the page actually being returned.
    # --date-order (not --topo-order): children still precede parents, but
    # otherwise rows follow commit dates, so a branch's newer commits aren't
    # pulled below an older merge just because that merge is topologically newer.
    raw = _run_git(
        repo_path,
        "log",
        "--date-order",
        "--no-show-signature",
        "--format=%H %P %ct",
        "--stdin",
        stdin="\n".join(tips) + "\n",
    )
    newest_first: list[tuple[str, list[str], int]] = []
    for line in raw.split("\n"):
        fields = line.split(" ")
        if len(fields) < 2 or not fields[0]:
            continue
        # A root commit has an empty %P, leaving a blank field between sha and date.
        newest_first.append(
            (
                fields[0],
                [p for p in fields[1:-1] if p],
                int(fields[-1]) if fields[-1].isdigit() else 0,
            )
        )

    ordered_meta = list(reversed(newest_first))  # oldest first
    dates = {sha: date for sha, _, date in ordered_meta}
    parents_map: dict[str, list[str]] = {
        sha: parents for sha, parents, _ in ordered_meta
    }
    ordered = [sha for sha, _, _ in ordered_meta]

    stash_base_by_sha = {s.sha: s.base_sha for s in stashes}
    for stash in sorted(
        (s for s in stashes if s.sha not in parents_map),
        key=lambda s: (s.committed_date, s.sha),
    ):
        insert_at = 0
        for index, sha in enumerate(ordered):
            if sha == stash.base_sha or dates[sha] <= stash.committed_date:
                insert_at = index + 1
        ordered.insert(insert_at, stash.sha)
        dates[stash.sha] = stash.committed_date
        parents_map[stash.sha] = [stash.base_sha]
    for sha, base in stash_base_by_sha.items():
        if sha in parents_map:
            parents_map[sha] = [base]

    children_map: dict[str, list[str]] = {}
    for sha, parents in parents_map.items():
        for p in parents:
            children_map.setdefault(p, []).append(sha)

    # Branch-ownership classification: git doesn't record which branch a
    # commit "belongs" to, so we infer it by walking each branch tip's
    # first-parent chain and claiming unowned commits, mirroring what
    # `git log --graph --all` / gitk effectively do. The checked-out branch
    # is claimed first so its lane reads as the "straight" one.
    owner: dict[str, str] = {}
    for head in sorted(heads, key=lambda r: _head_sort_key(r, current_branch)):
        sha: str | None = head.commit
        while sha is not None and sha not in owner and sha in parents_map:
            owner[sha] = head.short
            parents = parents_map.get(sha, [])
            sha = parents[0] if parents else None

    for ref in sorted(remote_refs, key=lambda r: -r.date):
        sha = ref.commit
        while sha is not None and sha not in owner and sha in parents_map:
            owner[sha] = ref.short
            parents = parents_map.get(sha, [])
            sha = parents[0] if parents else None

    stashes_by_commit: dict[str, list[str]] = {}
    for stash in stashes:
        owner[stash.sha] = stash.ref
        stashes_by_commit.setdefault(stash.sha, []).append(stash.ref)

    # Fallback for commits only reachable via a merge's non-first-parent edge
    # (e.g. a feature branch whose ref was deleted after merging): inherit
    # the owner from a newer child, processing newest -> oldest.
    for sha in reversed(ordered):
        if sha not in owner:
            inherited = None
            for child in children_map.get(sha, []):
                if child in owner:
                    inherited = owner[child]
                    break
            owner[sha] = inherited or "unknown"

    return _History(
        key=key,
        ordered=ordered,
        parents=parents_map,
        owner=owner,
        stashes_by_commit=stashes_by_commit,
        positions={sha: index for index, sha in enumerate(ordered)},
    )


_COMMIT_FORMAT = "%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%s%x1e"


def _commit_metadata(repo_path: Path, shas: list[str]) -> dict[str, tuple[str, ...]]:
    """Author/committer/dates/subject for exactly these commits, in one call."""
    if not shas:
        return {}
    raw = _run_git(
        repo_path,
        "log",
        "--no-walk=unsorted",
        "--no-show-signature",
        "--encoding=UTF-8",
        f"--format={_COMMIT_FORMAT}",
        "--stdin",
        stdin="\n".join(shas) + "\n",
    )
    metadata: dict[str, tuple[str, ...]] = {}
    for record in raw.split("\x1e"):
        record = record.lstrip("\n")
        if not record:
            continue
        fields = record.split("\x00")
        if len(fields) == 8:
            metadata[fields[0]] = tuple(fields[1:])
    return metadata


# --- status -----------------------------------------------------------------


def _diff_status(change_type: str) -> str:
    return {
        "A": "added",
        "D": "deleted",
        "M": "modified",
        "R": "renamed",
        "T": "modified",
    }.get(change_type, "modified")


def _is_excluded(path: str, excluded_paths: list[str]) -> bool:
    normalized = path.strip("/")
    for excluded in excluded_paths:
        norm = excluded.strip().strip("/")
        if norm and (normalized == norm or normalized.startswith(f"{norm}/")):
            return True
    return False


@dataclass
class _ParsedStatus:
    current_branch: str | None = None
    head_commit: str | None = None
    changes: dict[str, str] = field(default_factory=dict)


_STATUS_ARGS = ("status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")


def _parse_status(raw: str) -> _ParsedStatus:
    """Parse `git status --porcelain=v2 --branch -z`: the branch header plus
    staged, unstaged and untracked changes in a single pass over the tree."""
    parsed = _ParsedStatus()
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
        parsed.changes[path] = _diff_status(change)
    return parsed


_NUMSTAT_ARGS = ("diff", "HEAD", "--numstat", "-z")
# Untracked files bigger than this aren't read just to count their lines.
_UNTRACKED_COUNT_LIMIT = 1024 * 1024


def _parse_numstat(raw: str) -> dict[str, tuple[int, int] | None]:
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


def _count_untracked_lines(repo_path: Path, path: str) -> int | None:
    try:
        file_path = repo_path / path
        if file_path.stat().st_size > _UNTRACKED_COUNT_LIMIT:
            return None
        data = file_path.read_bytes()
    except OSError:
        return None
    if b"\x00" in data[:8192]:
        return None
    return data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)


def _uncommitted_files(
    parsed: _ParsedStatus,
    excluded_paths: list[str],
    numstat_raw: str = "",
    repo_path: Path | None = None,
) -> list[FileChange]:
    stats = _parse_numstat(numstat_raw)
    files: list[FileChange] = []
    for path, status in sorted(parsed.changes.items()):
        if _is_excluded(path, excluded_paths):
            continue
        counts = stats.get(path)
        if status == "untracked" and repo_path is not None:
            lines = _count_untracked_lines(repo_path, path)
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


@dataclass
class _Upstream:
    commit: str
    remote: str
    branch: str


def _current_upstream(
    current_branch: str | None, refs_by_name: dict[str, _Ref]
) -> _Upstream | None:
    if not current_branch:
        return None
    head = refs_by_name.get(_HEADS + current_branch)
    if (
        head is None
        or not head.upstream.startswith(_REMOTES)
        or not head.upstream_remote
    ):
        return None
    upstream = refs_by_name.get(head.upstream)
    if upstream is None or not upstream.commit:
        return None
    prefix = f"{_REMOTES}{head.upstream_remote}/"
    branch = (
        head.upstream[len(prefix) :]
        if head.upstream.startswith(prefix)
        else head.upstream[len(_REMOTES) :]
    )
    return _Upstream(commit=upstream.commit, remote=head.upstream_remote, branch=branch)


def _status_response(
    refs: list[_Ref],
    worktree_raw: str,
    status_raw: str,
    numstat_raw: str = "",
    repo_path: Path | None = None,
) -> RepoStatusResponse:
    parsed = _parse_status(status_raw)
    files = _uncommitted_files(
        parsed, config.load_excluded_paths(), numstat_raw, repo_path
    )
    refs_by_name = {ref.name: ref for ref in refs}
    upstream = _current_upstream(parsed.current_branch, refs_by_name)
    return RepoStatusResponse(
        current_branch=parsed.current_branch,
        head_commit=parsed.head_commit,
        upstream_commit=upstream.commit if upstream else None,
        upstream_remote=upstream.remote if upstream else None,
        upstream_branch=upstream.branch if upstream else None,
        is_dirty=bool(files),
        uncommitted_files=files,
        refs_signature=_refs_signature(refs, parse_worktree_branches(worktree_raw)),
    )


def get_repo_status(repo_path: Path) -> RepoStatusResponse:
    refs_future = _pool.submit(
        _run_git, repo_path, "for-each-ref", f"--format={_REF_FORMAT}"
    )
    worktree_future = _pool.submit(
        _run_git_or_empty, repo_path, "worktree", "list", "--porcelain"
    )
    status_future = _pool.submit(_run_git, repo_path, *_STATUS_ARGS)
    numstat_future = _pool.submit(_run_git_or_empty, repo_path, *_NUMSTAT_ARGS)
    return _status_response(
        _parse_refs(refs_future.result()),
        worktree_future.result(),
        status_future.result(),
        numstat_future.result(),
        repo_path,
    )


# --- graph ------------------------------------------------------------------


class GraphData(NamedTuple):
    commits: list[CommitSummary]  # oldest first
    branches: list[str]
    current_branch: str | None
    head_commit: str | None
    upstream_commit: str | None
    upstream_remote: str | None
    upstream_branch: str | None
    is_dirty: bool
    uncommitted_files: list[FileChange]
    checked_out_branches: list[str]
    refs_signature: str
    has_more: bool
    next_cursor: str | None  # pass as `before` to get the next, older page


def _empty_graph(
    status: RepoStatusResponse | None, branches: list[str], checked_out: list[str]
) -> GraphData:
    status = status or RepoStatusResponse()
    return GraphData(
        [],
        branches,
        status.current_branch,
        status.head_commit,
        status.upstream_commit,
        status.upstream_remote,
        status.upstream_branch,
        status.is_dirty,
        status.uncommitted_files,
        checked_out,
        status.refs_signature,
        False,
        None,
    )


def get_graph(
    repo_path: Path, limit: int = GRAPH_PAGE_SIZE, before: str | None = None
) -> GraphData:
    """One page of the commit graph, newest page first.

    Without `before` this is the newest `limit` commits plus the repo-wide
    context (branches, status, upstream). With `before` (the `next_cursor` of
    the previous page) it is the `limit` commits older than that commit, served
    from the same cached history snapshot as the first page.
    """
    repo_key = str(repo_path)
    history = _cache_get(repo_key, None) if before is not None else None

    if history is not None:
        # Later page: no need to re-read refs or status, the snapshot the first
        # page was cut from already holds everything ordering-related.
        refs = _parse_refs(
            _run_git(repo_path, "for-each-ref", f"--format={_REF_FORMAT}")
        )
        status = None
        checked_out: list[str] = []
    else:
        refs_future = _pool.submit(
            _run_git, repo_path, "for-each-ref", f"--format={_REF_FORMAT}"
        )
        worktree_future = _pool.submit(
            _run_git_or_empty, repo_path, "worktree", "list", "--porcelain"
        )
        stash_future = _pool.submit(_run_git_or_empty, repo_path, *_STASH_ARGS)
        status_future = _pool.submit(_run_git, repo_path, *_STATUS_ARGS)
        numstat_future = _pool.submit(
            _run_git_or_empty, repo_path, *_NUMSTAT_ARGS
        )
        refs = _parse_refs(refs_future.result())
        worktree_raw = worktree_future.result()
        stash_raw = stash_future.result()
        status = _status_response(
            refs,
            worktree_raw,
            status_future.result(),
            numstat_future.result(),
            repo_path,
        )
        checked_out = parse_worktree_branches(worktree_raw)
        key = _history_key(refs, stash_raw, status.current_branch)
        history = _cache_get(repo_key, key)

    heads = [r for r in refs if r.name.startswith(_HEADS)]
    branch_names = [r.short for r in heads]
    if not heads:
        return _empty_graph(status, [], checked_out)

    if history is None:
        assert status is not None
        history = _build_history(
            repo_path, refs, _parse_stashes(stash_raw), status.current_branch, key
        )
        _cache_put(repo_key, history)

    ordered = history.ordered
    if before is None:
        end = len(ordered)
    else:
        position = history.positions.get(before)
        if position is None:
            raise HistoryChangedError(before)
        end = position
    start = max(0, end - max(1, limit))
    page = ordered[start:end]
    has_more = start > 0

    tags_by_commit: dict[str, list[str]] = {}
    branches_by_commit: dict[str, list[str]] = {}
    remote_branches_by_commit: dict[str, list[str]] = {}
    for ref in refs:
        if not ref.commit:
            continue
        if ref.name.startswith(_TAGS):
            tags_by_commit.setdefault(ref.commit, []).append(ref.short)
        elif ref.name.startswith(_HEADS):
            branches_by_commit.setdefault(ref.commit, []).append(ref.short)
        elif ref.name.startswith(_REMOTES) and not _is_remote_head(ref):
            remote_branches_by_commit.setdefault(ref.commit, []).append(ref.short)
    metadata = _commit_metadata(repo_path, page)
    summaries: list[CommitSummary] = []
    for sha in page:
        meta = metadata.get(sha)
        if meta is None:
            continue
        (
            author_name,
            author_email,
            committer_name,
            committer_email,
            authored,
            committed,
            subject,
        ) = meta
        summaries.append(
            CommitSummary(
                hash=sha,
                short_hash=sha[:7],
                parents=history.parents[sha],
                author=PersonInfo(name=author_name, email=author_email),
                committer=PersonInfo(name=committer_name, email=committer_email),
                authored_date=authored,
                committed_date=committed,
                subject=subject,
                branch=history.owner.get(sha, "unknown"),
                refs=RefsInfo(
                    branches=branches_by_commit.get(sha, []),
                    remote_branches=remote_branches_by_commit.get(sha, []),
                    tags=tags_by_commit.get(sha, []),
                    stashes=history.stashes_by_commit.get(sha, []),
                ),
            )
        )

    status = status or RepoStatusResponse()
    return GraphData(
        summaries,
        branch_names,
        status.current_branch,
        status.head_commit,
        status.upstream_commit,
        status.upstream_remote,
        status.upstream_branch,
        status.is_dirty,
        status.uncommitted_files,
        checked_out,
        status.refs_signature,
        has_more,
        page[0] if has_more and page else None,
    )


def get_commit_hashes(repo_path: Path) -> set[str]:
    """Every commit hash of the graph's history (all pages), for matching CI
    runs to commits without paying for a whole graph payload."""
    refs_future = _pool.submit(
        _run_git, repo_path, "for-each-ref", f"--format={_REF_FORMAT}"
    )
    stash_future = _pool.submit(_run_git_or_empty, repo_path, *_STASH_ARGS)
    branch_future = _pool.submit(
        _run_git_or_empty, repo_path, "symbolic-ref", "--quiet", "--short", "HEAD"
    )
    refs = _parse_refs(refs_future.result())
    stash_raw = stash_future.result()
    current_branch = branch_future.result().strip() or None
    if not any(r.name.startswith(_HEADS) for r in refs):
        return set()
    repo_key = str(repo_path)
    key = _history_key(refs, stash_raw, current_branch)
    history = _cache_get(repo_key, key)
    if history is None:
        history = _build_history(
            repo_path, refs, _parse_stashes(stash_raw), current_branch, key
        )
        _cache_put(repo_key, history)
    return set(history.ordered)

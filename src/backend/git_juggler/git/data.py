from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

from .. import config
from ..schemas import CommitSummary, FileChange, PersonInfo, RefsInfo, RepoStatusResponse, TagInfo
from .command import GIT_POOL as _pool
from .command import GitCommandError, run_git as _run_git, run_git_or_empty as _run_git_or_empty
from .refs import HEADS as _HEADS
from .refs import REF_FORMAT as _REF_FORMAT
from .refs import REMOTES as _REMOTES
from .refs import TAGS as _TAGS
from .refs import Ref as _Ref
from .refs import is_remote_head as _is_remote_head
from .refs import parse_refs as _parse_refs
from .refs import refs_signature as _refs_signature
from .status import NUMSTAT_ARGS as _NUMSTAT_ARGS
from .status import STATUS_ARGS as _STATUS_ARGS
from .status import ParsedStatus as _ParsedStatus
from .status import parse_numstat as _parse_numstat
from .status import parse_status as _parse_status
from .status import uncommitted_files as _uncommitted_files
from .utils import parse_worktree_branches

# Commits per graph page. The graph endpoint returns the newest page first and
# the frontend asks for the next (older) page when the user scrolls to the end.
GRAPH_PAGE_SIZE = 500

class HistoryChangedError(LookupError):
    """The page cursor is no longer part of the repo's history."""


# --- refs -------------------------------------------------------------------


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
    tags: list[TagInfo]  # every tag in the repo, newest first


def _tag_infos(refs: list[_Ref]) -> list[TagInfo]:
    tags = [
        TagInfo(
            name=ref.short,
            commit=ref.commit,
            annotated=ref.object_sha != ref.commit,
            created=ref.created,
        )
        for ref in refs
        if ref.name.startswith(_TAGS) and ref.commit
    ]
    tags.sort(key=lambda tag: (tag.created, tag.name), reverse=True)
    return tags


def _empty_graph(
    status: RepoStatusResponse | None,
    branches: list[str],
    checked_out: list[str],
    tags: list[TagInfo],
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
        tags,
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
    tags = _tag_infos(refs)
    if not heads:
        return _empty_graph(status, [], checked_out, tags)

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
        tags,
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

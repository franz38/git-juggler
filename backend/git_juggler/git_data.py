from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from git import Head, Repo

from .git_utils import get_current_branch
from .schemas import CommitSummary, FileChange, PersonInfo, RefsInfo, RepoStatusResponse


def _head_sort_key(head: Head, current_branch: str | None) -> tuple[int, int]:
    """Current branch first, then main/master, then most-recently-committed."""
    if current_branch and head.name == current_branch:
        priority = 0
    elif head.name in ("main", "master"):
        priority = 1
    else:
        priority = 2
    return (priority, -head.commit.committed_date)


@dataclass(frozen=True)
class StashInfo:
    ref: str
    sha: str
    base_sha: str


def _stash_infos(repo: Repo) -> list[StashInfo]:
    """Return stash commits as graphable side commits.

    Git represents a stash as a synthetic merge commit whose first parent is
    the commit it was created from. The other parents are implementation
    details for index/untracked state, so the graph only draws the base edge.
    """
    stashes: list[StashInfo] = []
    try:
        raw = repo.git.stash("list")
    except Exception:
        return stashes
    for line in raw.splitlines():
        ref, sep, _ = line.partition(":")
        ref = ref.strip()
        if not sep or not ref:
            continue
        try:
            stash_commit = repo.commit(ref)
        except Exception:
            continue
        if not stash_commit.parents:
            continue
        base_sha = stash_commit.parents[0].hexsha
        stashes.append(StashInfo(ref=ref, sha=stash_commit.hexsha, base_sha=base_sha))
    return stashes


def _current_upstream_commit(repo: Repo) -> str | None:
    try:
        upstream = repo.active_branch.tracking_branch()
    except TypeError:
        return None
    if upstream is None:
        return None
    try:
        return upstream.commit.hexsha
    except Exception:
        return None


def _diff_status(change_type: str) -> str:
    return {
        "A": "added",
        "D": "deleted",
        "M": "modified",
        "R": "renamed",
        "T": "modified",
    }.get(change_type, "modified")


def _uncommitted_files(repo: Repo) -> list[FileChange]:
    changes: dict[str, str] = {}

    def add_change(path: str | None, status: str) -> None:
        if path:
            changes[path] = status

    try:
        for diff in repo.index.diff("HEAD"):
            add_change(diff.b_path or diff.a_path, _diff_status(diff.change_type))
    except Exception:
        pass

    try:
        for diff in repo.index.diff(None):
            add_change(diff.b_path or diff.a_path, _diff_status(diff.change_type))
    except Exception:
        pass

    for path in repo.untracked_files:
        add_change(path, "untracked")

    return [FileChange(path=path, status=status) for path, status in sorted(changes.items())]


def get_repo_status(repo_path: Path) -> RepoStatusResponse:
    repo = Repo(repo_path)
    try:
        head_commit = repo.head.commit.hexsha
    except Exception:
        head_commit = None
    return RepoStatusResponse(
        current_branch=get_current_branch(repo),
        head_commit=head_commit,
        upstream_commit=_current_upstream_commit(repo),
        is_dirty=repo.is_dirty(untracked_files=True),
        uncommitted_files=_uncommitted_files(repo),
    )


def get_graph(repo_path: Path) -> tuple[list[CommitSummary], list[str], str | None, str | None, str | None, bool, list[FileChange]]:
    repo = Repo(repo_path)
    heads = list(repo.heads)
    tags = list(repo.tags)
    current_branch = get_current_branch(repo)
    status = get_repo_status(repo_path)
    upstream_commit = status.upstream_commit
    is_dirty = status.is_dirty
    uncommitted_files = status.uncommitted_files
    try:
        head_commit = repo.head.commit.hexsha
    except Exception:
        head_commit = None

    if not heads:
        return [], [], current_branch, head_commit, upstream_commit, is_dirty, uncommitted_files

    tags_by_commit: dict[str, list[str]] = {}
    for t in tags:
        tags_by_commit.setdefault(t.commit.hexsha, []).append(t.name)

    branches_by_commit: dict[str, list[str]] = {}
    for h in heads:
        branches_by_commit.setdefault(h.commit.hexsha, []).append(h.name)

    stash_infos = _stash_infos(repo)
    stashes_by_commit: dict[str, list[str]] = {}
    for stash in stash_infos:
        stashes_by_commit.setdefault(stash.sha, []).append(stash.ref)
    stash_base_by_sha = {stash.sha: stash.base_sha for stash in stash_infos}

    # Walk history reachable from branches and tags, then explicitly add stash
    # commits as side nodes. We still avoid `--all` so remote-tracking branches
    # do not silently expand the local graph.
    raw_commits = list(repo.iter_commits(branches=True, tags=True, topo_order=True, reverse=True))
    commits_by_sha = {c.hexsha: c for c in raw_commits}
    stash_commits = []
    for stash in stash_infos:
        if stash.sha not in commits_by_sha:
            try:
                stash_commits.append((stash, repo.commit(stash.sha)))
            except Exception:
                continue
    for stash, stash_commit in sorted(stash_commits, key=lambda item: (item[1].committed_date, item[1].hexsha)):
        insert_at = 0
        for index, commit in enumerate(raw_commits):
            if commit.hexsha == stash.base_sha or commit.committed_date <= stash_commit.committed_date:
                insert_at = index + 1
        raw_commits.insert(insert_at, stash_commit)
        commits_by_sha[stash.sha] = stash_commit
    ordered_shas = [c.hexsha for c in raw_commits]
    parents_map = {
        c.hexsha: [stash_base_by_sha[c.hexsha]] if c.hexsha in stash_base_by_sha else [p.hexsha for p in c.parents]
        for c in raw_commits
    }

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
    for h in sorted(heads, key=lambda h: _head_sort_key(h, current_branch)):
        sha: str | None = h.commit.hexsha
        while sha is not None and sha not in owner and sha in commits_by_sha:
            owner[sha] = h.name
            parents = parents_map.get(sha, [])
            sha = parents[0] if parents else None

    for stash in stash_infos:
        owner[stash.sha] = stash.ref

    # Fallback for commits only reachable via a merge's non-first-parent edge
    # (e.g. a feature branch whose ref was deleted after merging): inherit
    # the owner from a newer child, processing newest -> oldest.
    for sha in reversed(ordered_shas):
        if sha not in owner:
            inherited = None
            for child in children_map.get(sha, []):
                if child in owner:
                    inherited = owner[child]
                    break
            owner[sha] = inherited or "unknown"

    summaries: list[CommitSummary] = []
    for sha in ordered_shas:
        c = commits_by_sha[sha]
        summaries.append(
            CommitSummary(
                hash=c.hexsha,
                short_hash=c.hexsha[:7],
                parents=parents_map[sha],
                author=PersonInfo(name=c.author.name or "", email=c.author.email or ""),
                committer=PersonInfo(name=c.committer.name or "", email=c.committer.email or ""),
                authored_date=c.authored_datetime.isoformat(),
                committed_date=c.committed_datetime.isoformat(),
                subject=c.summary if isinstance(c.summary, str) else c.summary.decode(),
                branch=owner.get(sha, "unknown"),
                refs=RefsInfo(
                    branches=branches_by_commit.get(sha, []),
                    tags=tags_by_commit.get(sha, []),
                    stashes=stashes_by_commit.get(sha, []),
                ),
            )
        )

    return summaries, [h.name for h in heads], current_branch, head_commit, upstream_commit, is_dirty, uncommitted_files

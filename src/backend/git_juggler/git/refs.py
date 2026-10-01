from __future__ import annotations

import hashlib
from dataclasses import dataclass


REF_FORMAT = "%(refname)%09%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(committerdate:unix)%09%(upstream)%09%(upstream:remotename)%09%(creatordate:unix)"
HEADS = "refs/heads/"
TAGS = "refs/tags/"
REMOTES = "refs/remotes/"


@dataclass(frozen=True)
class Ref:
    name: str  # full ref name, e.g. refs/heads/main
    object_sha: str  # what the ref itself points at (the tag object, for annotated tags)
    commit: str | None  # the commit it resolves to, None when it isn't one
    date: int  # committer date of that commit (0 when unknown)
    upstream: str
    upstream_remote: str
    # When the ref's own object was made: the tagger date for an annotated
    # tag, the committer date otherwise (0 when unknown).
    created: int = 0

    @property
    def short(self) -> str:
        for prefix in (HEADS, TAGS, REMOTES):
            if self.name.startswith(prefix):
                return self.name[len(prefix) :]
        return self.name


def parse_refs(raw: str) -> list[Ref]:
    refs: list[Ref] = []
    for line in raw.split("\n"):
        fields = line.split("\t")
        if len(fields) < 8:
            continue
        name, sha, kind, peeled_sha, peeled_kind, date, upstream, upstream_remote = (
            fields[:8]
        )
        created = fields[8] if len(fields) > 8 else ""
        commit = (
            sha
            if kind == "commit"
            else (peeled_sha if peeled_kind == "commit" else None)
        )
        refs.append(
            Ref(
                name=name,
                object_sha=sha,
                commit=commit,
                date=int(date) if date.isdigit() else 0,
                upstream=upstream,
                upstream_remote=upstream_remote,
                created=int(created) if created.isdigit() else 0,
            )
        )
    return refs


def is_remote_head(ref: Ref) -> bool:
    return ref.name.startswith(REMOTES) and ref.name.endswith("/HEAD")


def refs_signature(refs: list[Ref], worktree_branches: list[str]) -> str:
    """Cheap fingerprint of every ref plus the worktree branch set, so the
    frontend can notice new/moved/deleted branches, tags and worktrees."""
    parts = [f"{ref.name}={ref.object_sha}" for ref in refs]
    parts.extend(f"wt:{branch}" for branch in sorted(worktree_branches))
    return hashlib.sha1("\n".join(sorted(parts)).encode()).hexdigest()

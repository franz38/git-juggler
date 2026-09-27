from __future__ import annotations

from pathlib import Path

from git import NULL_TREE, Repo

from .git.command import run_git_or_empty
from .git.status import parse_numstat
from .schemas import CommitDetail, FileChange, PersonInfo

_STATUS_MAP = {
    "A": "added",
    "M": "modified",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "modified",
}


def get_commit_detail(repo_path: Path, sha: str) -> CommitDetail:
    repo = Repo(repo_path)
    commit = repo.commit(sha)

    if commit.parents:
        diffs = commit.parents[0].diff(commit)
        numstat_raw = run_git_or_empty(
            repo_path, "diff", "--numstat", "-z", "-M",
            commit.parents[0].hexsha, commit.hexsha,
        )
    else:
        diffs = commit.diff(NULL_TREE)
        numstat_raw = run_git_or_empty(
            repo_path, "diff-tree", "--root", "--no-commit-id", "-r", "--numstat", "-z", "-M",
            commit.hexsha,
        )
    stats = parse_numstat(numstat_raw)

    files: list[FileChange] = []
    for d in diffs:
        status = _STATUS_MAP.get(d.change_type or "M", "modified")
        path = d.b_path or d.a_path or "?"
        old_path = d.a_path if d.a_path and d.a_path != path else None
        counts = stats.get(path)
        files.append(
            FileChange(
                path=path,
                status=status,
                old_path=old_path,
                additions=counts[0] if counts else None,
                deletions=counts[1] if counts else None,
            )
        )
    files.sort(key=lambda f: f.path)

    subject = commit.summary if isinstance(commit.summary, str) else commit.summary.decode()
    message = commit.message if isinstance(commit.message, str) else commit.message.decode()

    return CommitDetail(
        hash=commit.hexsha,
        short_hash=commit.hexsha[:7],
        parents=[p.hexsha for p in commit.parents],
        author=PersonInfo(name=commit.author.name or "", email=commit.author.email or ""),
        committer=PersonInfo(name=commit.committer.name or "", email=commit.committer.email or ""),
        authored_date=commit.authored_datetime.isoformat(),
        committed_date=commit.committed_datetime.isoformat(),
        subject=subject,
        message=message,
        files=files,
    )

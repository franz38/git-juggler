from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path

from .process_info import ProcessInfo, classify_process, executable_basename


ROOT_CWD_SCORE = 1
SESSION_DIRECTORY_SCORE = 1
CHILD_CWD_SCORE = 7
GIT_PROCESS_CWD_SCORE = 12
BUILD_TEST_CWD_SCORE = 8
COMMAND_PATH_SCORE = 9
COMMAND_TARGET_SCORE = 12
FILE_ACCESS_SCORE = 12


@dataclass(frozen=True)
class WorktreeEvidence:
    type: str
    path: str
    pid: int | None = None
    command: str | None = None
    executable: str | None = None
    process_role: str | None = None
    tool: str | None = None
    score: int = 0


def process_role(process: ProcessInfo, root_pid: int, child_depths: dict[int, int]) -> str:
    if process.pid == root_pid:
        return "root"
    if child_depths.get(process.pid) == 1:
        return "direct-child"
    return "descendant"


def cwd_evidence(process: ProcessInfo, root_pid: int, child_depths: dict[int, int]) -> WorktreeEvidence | None:
    if not process.cwd:
        return None
    role = process_role(process, root_pid, child_depths)
    classification = classify_process(process)
    score = ROOT_CWD_SCORE if role == "root" else CHILD_CWD_SCORE
    evidence_type = "process-cwd"
    if role == "root":
        evidence_type = "root-process-cwd"
    if classification.is_git:
        score = max(score, GIT_PROCESS_CWD_SCORE)
        evidence_type = "git-process"
    elif classification.is_build_or_test:
        score = max(score, BUILD_TEST_CWD_SCORE)

    return WorktreeEvidence(
        type=evidence_type,
        path=process.cwd,
        pid=process.pid,
        executable=process.executable,
        process_role=role,
        score=score,
    )


def session_directory_evidence(process: ProcessInfo) -> WorktreeEvidence | None:
    if not process.cwd:
        return None
    return WorktreeEvidence(
        type="session-directory",
        path=process.cwd,
        pid=process.pid,
        executable=process.executable,
        process_role="root",
        score=SESSION_DIRECTORY_SCORE,
    )


def command_path_evidence(process: ProcessInfo, root_pid: int, child_depths: dict[int, int]) -> list[WorktreeEvidence]:
    if process.arguments:
        args = process.arguments
    elif process.command_line:
        try:
            args = shlex.split(process.command_line)
        except ValueError:
            return []
    else:
        return []
    if not args:
        return []

    role = process_role(process, root_pid, child_depths)
    command_name = executable_basename(args[0]).lower()
    evidence: list[WorktreeEvidence] = []

    def add_path(raw_path: str, score: int = COMMAND_PATH_SCORE, evidence_type: str = "command-path", tool: str | None = command_name) -> None:
        path = _resolve_existing_path(raw_path, process.cwd)
        if path is None:
            return
        evidence.append(
            WorktreeEvidence(
                type=evidence_type,
                path=str(path),
                pid=process.pid,
                command=process.command_line,
                executable=process.executable,
                process_role=role,
                tool=tool,
                score=score,
            )
        )

    if command_name == "git":
        for index, arg in enumerate(args[:-1]):
            if arg == "-C":
                add_path(args[index + 1], score=COMMAND_TARGET_SCORE, evidence_type="git-command-path", tool="git")
    elif command_name == "make":
        for index, arg in enumerate(args[:-1]):
            if arg == "-C":
                add_path(args[index + 1], score=COMMAND_TARGET_SCORE, evidence_type="command-path", tool="make")
    elif command_name == "npm":
        for index, arg in enumerate(args[:-1]):
            if arg == "--prefix":
                add_path(args[index + 1], score=COMMAND_TARGET_SCORE, evidence_type="command-path", tool="npm")

    for arg in args[1:]:
        if arg.startswith("-"):
            continue
        add_path(arg)

    return evidence


def file_access_evidence(process: ProcessInfo, root_pid: int, child_depths: dict[int, int]) -> list[WorktreeEvidence]:
    if not process.open_files:
        return []
    role = process_role(process, root_pid, child_depths)
    evidence: list[WorktreeEvidence] = []
    for raw_path in process.open_files:
        path = _resolve_existing_path(raw_path, None)
        if path is None or not path.is_file():
            continue
        evidence.append(
            WorktreeEvidence(
                type="file-access",
                path=str(path),
                pid=process.pid,
                executable=process.executable,
                process_role=role,
                score=FILE_ACCESS_SCORE,
            )
        )
    return evidence


def _resolve_existing_path(raw_path: str, cwd: str | None) -> Path | None:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        if cwd is None:
            return None
        path = Path(cwd) / path
    try:
        resolved = path.resolve()
    except OSError:
        return None
    if not resolved.exists():
        return None
    return resolved

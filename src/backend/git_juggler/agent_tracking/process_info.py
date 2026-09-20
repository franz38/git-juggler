from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProcessInfo:
    pid: int
    parent_pid: int | None
    executable: str | None = None
    command_line: str | None = None
    arguments: list[str] | None = None
    open_files: list[str] | None = None
    cwd: str | None = None


@dataclass(frozen=True)
class ProcessClassification:
    is_shell: bool = False
    is_git: bool = False
    is_build_or_test: bool = False


DEFAULT_SHELL_EXECUTABLES = frozenset({"bash", "zsh", "sh", "fish"})
DEFAULT_GIT_EXECUTABLES = frozenset({"git"})
DEFAULT_BUILD_TEST_EXECUTABLES = frozenset(
    {
        "node",
        "npm",
        "pnpm",
        "yarn",
        "bun",
        "dotnet",
        "python",
        "python3",
        "pytest",
        "java",
        "gradle",
        "mvn",
        "cargo",
        "go",
        "make",
        "cmake",
    }
)


def executable_basename(value: str | None) -> str:
    if not value:
        return ""
    return value.rsplit("/", 1)[-1]


def classify_process(
    process: ProcessInfo,
    shells: frozenset[str] = DEFAULT_SHELL_EXECUTABLES,
    git_commands: frozenset[str] = DEFAULT_GIT_EXECUTABLES,
    build_test_commands: frozenset[str] = DEFAULT_BUILD_TEST_EXECUTABLES,
) -> ProcessClassification:
    name = executable_basename(process.executable).lower()
    return ProcessClassification(
        is_shell=name in shells,
        is_git=name in git_commands,
        is_build_or_test=name in build_test_commands,
    )

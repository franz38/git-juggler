from __future__ import annotations

import unittest
from unittest.mock import patch

from git_juggler import ci
from git_juggler.ci import github_actions, jenkins
from git_juggler.schemas import ActivePipeline, CiRunInfo, CiStage, RepoSummary


def _repo(name: str) -> RepoSummary:
    return RepoSummary(id=f"k::{name}", name=name, path=f"/tmp/{name}", repository_id=name)


def _run(number: int, created_at: str, provider: str = "github_actions") -> CiRunInfo:
    return CiRunInfo(provider=provider, status="running", name="CI", number=number, url=f"u{number}", created_at=created_at)


class ActivePipelinesTest(unittest.TestCase):
    def test_collects_across_repos_newest_first(self) -> None:
        runs = {
            "a": [_run(1, "2026-01-01T10:00:00Z")],
            "b": [_run(2, "2026-01-01T11:00:00Z")],
            "c": [],
        }
        with (
            patch.object(github_actions, "get_active_runs", lambda path, cfg, head_sha=None: runs[path.name]),
            patch.object(jenkins, "get_active_builds", lambda path, cfg: []),
        ):
            result = ci.get_active_pipelines([_repo("a"), _repo("b"), _repo("c")], None, None)

        self.assertEqual([(p.repo_name, p.run.number) for p in result], [("b", 2), ("a", 1)])

    def test_respects_disabled_providers(self) -> None:
        with (
            patch.object(github_actions, "get_active_runs", lambda path, cfg, head_sha=None: [_run(1, "2026-01-01T10:00:00Z")]) as gh,
            patch.object(jenkins, "get_active_builds", lambda path, cfg: [_run(2, "2026-01-01T10:00:00Z", "jenkins")]),
        ):
            self.assertEqual(ci.get_active_pipelines([_repo("a")], {"enabled": False}, None), [])
            only_jenkins = ci.get_active_pipelines([_repo("a")], {"enabled": False}, {"enabled": True})
            self.assertEqual([p.run.provider for p in only_jenkins], ["jenkins"])
        self.assertIsNotNone(gh)

    def test_no_repos(self) -> None:
        self.assertEqual(ci.get_active_pipelines([], None, None), [])

    def test_deduplicates_same_active_run_across_repo_entries(self) -> None:
        run = _run(1, "2026-01-01T10:00:00Z")
        run.run_id = "123"
        with (
            patch.object(github_actions, "get_active_runs", lambda path, cfg, head_sha=None: [run]),
            patch.object(jenkins, "get_active_builds", lambda path, cfg: []),
        ):
            result = ci.get_active_pipelines([_repo("a"), _repo("a-worktree")], None, None)

        self.assertEqual([(p.repo_name, p.run.run_id) for p in result], [("a", "123")])

    def test_stage_dispatch_by_provider(self) -> None:
        stages = [CiStage(name="build", status="success")]
        with (
            patch.object(github_actions, "get_run_stages", lambda path, cfg, run_id: stages),
            patch.object(jenkins, "get_build_stages", lambda path, cfg, run_id: None),
        ):
            from pathlib import Path

            self.assertEqual(ci.get_ci_run_stages(Path("/tmp/a"), "github_actions", "1", None, None), stages)
            self.assertIsNone(ci.get_ci_run_stages(Path("/tmp/a"), "jenkins", "u", None, {"enabled": True}))
            self.assertIsNone(ci.get_ci_run_stages(Path("/tmp/a"), "jenkins", "u", None, None))
            self.assertIsNone(ci.get_ci_run_stages(Path("/tmp/a"), "github_actions", "1", {"enabled": False}, None))
            self.assertIsNone(ci.get_ci_run_stages(Path("/tmp/a"), "other", "1", None, None))


class SchemaTest(unittest.TestCase):
    def test_nested_stage_steps_serialize(self) -> None:
        run = _run(1, "2026-01-01T10:00:00Z")
        run.stages = [CiStage(name="build", status="running", steps=[CiStage(name="checkout", status="success")])]
        payload = ActivePipeline(repo_id="k::a", repo_name="a", run=run).model_dump(mode="json")
        self.assertEqual(payload["run"]["stages"][0]["steps"][0]["name"], "checkout")


if __name__ == "__main__":
    unittest.main()

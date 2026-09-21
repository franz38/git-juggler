from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler import jenkins


class JenkinsBuildParsingTest(unittest.TestCase):
    def test_normalizes_build_status(self) -> None:
        self.assertEqual(jenkins._normalize_status("SUCCESS", False), "success")
        self.assertEqual(jenkins._normalize_status("FAILURE", False), "failure")
        self.assertEqual(jenkins._normalize_status("UNSTABLE", False), "unstable")
        self.assertEqual(jenkins._normalize_status("ABORTED", False), "aborted")
        self.assertEqual(jenkins._normalize_status(None, True), "running")
        self.assertEqual(jenkins._normalize_status(None, False), "unknown")

    def test_extracts_commit_shas_from_common_sources(self) -> None:
        self.assertEqual(
            jenkins._extract_commit_shas(
                {
                    "actions": [
                        {"lastBuiltRevision": {"SHA1": "a" * 40}},
                        {"parameters": [{"name": "GIT_COMMIT", "value": "b" * 40}]},
                    ],
                    "changeSet": {"items": [{"commitId": "c" * 40}]},
                }
            ),
            {"a" * 40, "b" * 40, "c" * 40},
        )

    def test_extracts_multibranch_job_name(self) -> None:
        self.assertEqual(
            jenkins._job_name("https://jenkins.example.com/job/my-pipeline/job/main/"),
            "my-pipeline/main",
        )

    def test_maps_builds_to_matching_commits(self) -> None:
        repo_path = Path("/tmp/repo")
        sha = "a" * 40
        config = {
            "enabled": True,
            "build_limit": 10,
            "jobs": [{"repo_path": str(repo_path), "job_url": "https://jenkins.example.com/job/my-pipeline/job/main"}],
        }

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            if "tree=builds" in url:
                return {"builds": [{"number": 7, "url": "https://jenkins.example.com/job/my-pipeline/job/main/7/"}]}
            return {
                "number": 7,
                "url": "https://jenkins.example.com/job/my-pipeline/job/main/7/",
                "result": "SUCCESS",
                "building": False,
                "timestamp": 1_700_000_000_000,
                "duration": 120000,
                "actions": [{"lastBuiltRevision": {"SHA1": sha, "branch": [{"name": "origin/main"}]}}],
                "changeSet": {"items": []},
            }

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_jenkins_builds(repo_path, {sha}, config)

        self.assertEqual(list(builds), [sha])
        self.assertEqual(builds[sha][0].provider, "jenkins")
        self.assertEqual(builds[sha][0].status, "success")
        self.assertEqual(builds[sha][0].name, "my-pipeline/main")
        self.assertEqual(builds[sha][0].number, 7)
        self.assertEqual(builds[sha][0].branch, "origin/main")

    def test_maps_wfapi_stages(self) -> None:
        payload = {
            "stages": [
                {"name": "Build", "status": "SUCCESS", "startTimeMillis": 1_700_000_000_000, "durationMillis": 5000},
                {"name": "Test", "status": "IN_PROGRESS", "startTimeMillis": 1_700_000_006_000, "durationMillis": 1000},
                {"name": "Approve", "status": "PAUSED_PENDING_INPUT"},
                {"name": "Deploy", "status": "NOT_EXECUTED"},
            ]
        }
        with patch.object(jenkins, "_fetch_json", lambda url, headers: payload):
            stages = jenkins._fetch_build_stages("https://jenkins.example.com/job/p/7/", {})

        assert stages is not None
        self.assertEqual([s.status for s in stages], ["success", "running", "action_required", "pending"])
        self.assertEqual(stages[0].duration_ms, 5000)

    def test_missing_wfapi_returns_none(self) -> None:
        with patch.object(jenkins, "_fetch_json", lambda url, headers: None):
            self.assertIsNone(jenkins._fetch_build_stages("https://jenkins.example.com/job/p/7/", {}))

    def test_stages_only_followed_under_configured_job(self) -> None:
        repo_path = Path("/tmp/repo")
        config = {"jobs": [{"repo_path": str(repo_path), "job_url": "https://jenkins.example.com/job/p"}]}
        fetched: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            return {"stages": []}

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            self.assertIsNone(jenkins.get_build_stages(repo_path, config, "https://evil.example.com/job/p/7/"))
            self.assertIsNone(jenkins.get_build_stages(repo_path, config, "https://jenkins.example.com/job/p-other/7/"))
            self.assertEqual(jenkins.get_build_stages(repo_path, config, "https://jenkins.example.com/job/p/7/"), [])
        self.assertEqual(len(fetched), 1)

    def test_active_builds_only_include_building_ones(self) -> None:
        repo_path = Path("/tmp/repo")
        config = {"jobs": [{"repo_path": str(repo_path), "job_url": "https://jenkins.example.com/job/p"}]}

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            if "wfapi" in url:
                return {"stages": [{"name": "Build", "status": "IN_PROGRESS"}]}
            return {
                "builds": [
                    {"number": 8, "url": "https://jenkins.example.com/job/p/8/", "building": True, "result": None},
                    {"number": 7, "url": "https://jenkins.example.com/job/p/7/", "building": False, "result": "SUCCESS"},
                ]
            }

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_active_builds(repo_path, config)

        self.assertEqual([b.number for b in builds], [8])
        self.assertEqual(builds[0].status, "running")
        self.assertEqual(builds[0].run_id, "https://jenkins.example.com/job/p/8/")
        self.assertEqual(builds[0].stages[0].status, "running")


if __name__ == "__main__":
    unittest.main()

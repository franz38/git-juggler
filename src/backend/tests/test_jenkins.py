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


if __name__ == "__main__":
    unittest.main()

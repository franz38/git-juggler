from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git_juggler.ci import jenkins, run_cache


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
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": [str(repo_path)],
                    "job_url": "https://jenkins.example.com/job/my-pipeline/job/main",
                }
            ],
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

    def test_renders_parameterized_rule_for_repo(self) -> None:
        repo_path = Path("/tmp/widgets")
        sha = "a" * 40
        config = {
            "enabled": True,
            "build_limit": 10,
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": ["/tmp/{repo_name}"],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}",
                }
            ],
        }
        fetched_urls: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched_urls.append(url)
            if "tree=builds" in url:
                return {"builds": [{"number": 7, "url": "https://jenkins.example.com/job/widgets/7/"}]}
            return {
                "number": 7,
                "url": "https://jenkins.example.com/job/widgets/7/",
                "result": "SUCCESS",
                "building": False,
                "actions": [{"lastBuiltRevision": {"SHA1": sha}}],
                "changeSet": {"items": []},
            }

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_jenkins_builds(repo_path, {sha}, config)

        self.assertIn(sha, builds)
        self.assertTrue(fetched_urls[0].startswith("https://jenkins.example.com/job/widgets/api/json"))

    def test_wildcard_rule_matches_any_repo(self) -> None:
        repo_path = Path("/tmp/repo with spaces")
        matches = jenkins._matching_job_configs(
            {"rules": [{"id": "r1", "name": "Rule", "repo_paths": ["*"], "job_url": "https://jenkins.example.com/job/{repo_name_url}"}]},
            repo_path,
        )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["job_url"], "https://jenkins.example.com/job/repo%20with%20spaces")

    def test_rule_matches_many_repos_and_renders_each_repo_name(self) -> None:
        config = {
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": ["/tmp/api", "/tmp/web"],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}",
                }
            ]
        }

        api_matches = jenkins._matching_job_configs(config, Path("/tmp/api"))
        web_matches = jenkins._matching_job_configs(config, Path("/tmp/web"))
        other_matches = jenkins._matching_job_configs(config, Path("/tmp/other"))

        self.assertEqual(api_matches[0]["job_url"], "https://jenkins.example.com/job/api")
        self.assertEqual(web_matches[0]["job_url"], "https://jenkins.example.com/job/web")
        self.assertEqual(other_matches, [])

    def test_branch_pipeline_is_only_rendered_with_branch_context(self) -> None:
        config = {
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": ["/tmp/api"],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}",
                }
            ]
        }

        self.assertEqual(jenkins._matching_job_configs(config, Path("/tmp/api")), [])
        matches = jenkins._matching_job_configs(config, Path("/tmp/api"), "feature/foo")

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["job_url"], "https://jenkins.example.com/job/api/job/feature%2Ffoo")

    def test_maps_builds_from_each_branch_job_for_branch_template(self) -> None:
        repo_path = Path("/tmp/api")
        sha = "a" * 40
        config = {
            "build_limit": 10,
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": [str(repo_path)],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}",
                }
            ],
        }
        fetched_urls: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched_urls.append(url)
            if url.startswith("https://jenkins.example.com/job/api/job/feature%2Ffoo/"):
                return None  # no Jenkins job for this branch
            if "tree=builds" in url:
                return {"builds": [{"number": 2, "url": "https://jenkins.example.com/job/api/job/main/2/"}]}
            return {
                "number": 2,
                "url": "https://jenkins.example.com/job/api/job/main/2/",
                "result": "FAILURE",
                "building": False,
                "actions": [{"lastBuiltRevision": {"SHA1": sha}}],
                "changeSet": {"items": []},
            }

        with patch.object(jenkins, "_branch_names", lambda path: ["main", "feature/foo"]), patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_jenkins_builds(repo_path, {sha}, config)

        self.assertEqual(list(builds), [sha])
        self.assertEqual(builds[sha][0].name, "api/main")
        self.assertEqual(builds[sha][0].status, "failure")
        self.assertTrue(any(url.startswith("https://jenkins.example.com/job/api/job/feature%2Ffoo/api/json") for url in fetched_urls))

    def test_active_builds_without_branch_check_each_branch_job(self) -> None:
        repo_path = Path("/tmp/api")
        config = {
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": [str(repo_path)],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}",
                }
            ]
        }

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            if url.startswith("https://jenkins.example.com/job/api/job/main/api/json"):
                return {"builds": [{"number": 4, "url": "https://jenkins.example.com/job/api/job/main/4/", "result": None, "building": True}]}
            return None

        with (
            patch.object(jenkins, "_branch_names", lambda path: ["main", "feature/foo"]),
            patch.object(jenkins, "_fetch_json", fake_fetch_json),
            patch.object(jenkins, "_fetch_build_stages", lambda url, headers: None),
        ):
            builds = jenkins.get_active_builds(repo_path, config)

        self.assertEqual([(build.name, build.number, build.status) for build in builds], [("api/main", 4, "running")])

    def test_recent_builds_include_finished_ones_from_each_branch_job(self) -> None:
        repo_path = Path("/tmp/api")
        config = {"rules": [{"id": "r1", "name": "Rule", "repo_paths": [str(repo_path)], "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}"}]}
        fetched: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            if url.startswith("https://jenkins.example.com/job/api/job/main/api/json"):
                return {
                    "builds": [
                        {"number": 5, "url": "https://jenkins.example.com/job/api/job/main/5/", "building": True, "result": None},
                        {"number": 4, "url": "https://jenkins.example.com/job/api/job/main/4/", "building": False, "result": "FAILURE"},
                    ]
                }
            return None

        with patch.object(jenkins, "_branch_names", lambda path: ["main", "dev"]), patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_recent_builds(repo_path, config, 3)

        self.assertEqual([(b.number, b.status) for b in builds], [(5, "running"), (4, "failure")])
        self.assertIn("%7B0%2C3%7D", fetched[0])  # tree=...{0,3}

    def test_build_url_tracking_allows_branch_template_prefix(self) -> None:
        repo_path = Path("/tmp/api")
        sha = "a" * 40
        config = {
            "rules": [
                {
                    "id": "r1",
                    "name": "Rule",
                    "repo_paths": [str(repo_path)],
                    "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}",
                }
            ]
        }

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            return {
                "number": 7,
                "url": "https://jenkins.example.com/job/api/job/feature%2Ffoo/7/",
                "result": None,
                "building": True,
                "actions": [{"lastBuiltRevision": {"SHA1": sha}}],
            }

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            builds = jenkins.get_builds_by_url(repo_path, config, ["https://jenkins.example.com/job/api/job/feature%2Ffoo/7/"])

        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0].head_sha, sha)

    def test_rule_connection_renders_default_branch_url(self) -> None:
        repo_path = Path("/tmp/api")
        config = {"username": "u", "api_token_env": "TOKEN", "rules": []}
        rule = {"id": "r1", "name": "Rule", "repo_paths": [str(repo_path)], "job_url": "https://jenkins.example.com/job/{repo_name_url}/job/{branch_name_url}"}
        fetched: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            return {"name": "main"}

        with patch.object(jenkins, "_default_branch", lambda path: "main"), patch.object(jenkins, "_fetch_json", fake_fetch_json):
            ok, message = jenkins.test_rule_connection(config, rule, repo_path)

        self.assertTrue(ok)
        self.assertEqual(fetched, ["https://jenkins.example.com/job/api/job/main/api/json"])
        self.assertIn("api (main): connected", message)

    def test_rule_connection_reports_missing_default_branch(self) -> None:
        with patch.object(jenkins, "_default_branch", lambda path: None):
            ok, message = jenkins.test_rule_connection({"enabled": True}, {"job_url": "https://jenkins.example.com/job/p"}, Path("/tmp/api"))

        self.assertFalse(ok)
        self.assertIn("no local main or master branch", message)

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

    def test_prefers_graph_view_stages_with_parallel_branches_and_steps(self) -> None:
        tree = {
            "status": "ok",
            "data": {
                "stages": [
                    {"id": "6", "name": "Checkout SCM", "state": "success", "children": [], "totalDurationMillis": 2000},
                    {
                        "id": "15",
                        "name": "Mock CI",
                        "state": "running",
                        "children": [
                            {"id": "23", "name": "Lint", "state": "success", "children": [], "startTimeMillis": 1_700_000_000_000},
                            {"id": "24", "name": "E2E", "state": "running", "children": []},
                        ],
                    },
                    {"id": "30", "name": "Deploy", "state": "not_built", "children": [], "placeholder": True},
                ]
            },
        }
        all_steps = {
            "status": "ok",
            "data": {
                "steps": [
                    {"id": "44", "name": "#!/bin/bash\n  echo lint\n  sleep 1", "title": "", "state": "success", "stageId": "23"},
                    {"id": "45", "name": "sh", "title": "Run e2e", "state": "running", "stageId": "24"},
                ]
            },
        }
        fetched: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            if url.endswith("/stages/tree"):
                return tree
            if url.endswith("/stages/allSteps"):
                return all_steps
            return None

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            stages = jenkins._fetch_build_stages("https://jenkins.example.com/job/p/7/", {})

        assert stages is not None
        self.assertEqual([(s.name, s.status) for s in stages], [("Checkout SCM", "success"), ("Lint", "success"), ("E2E", "running"), ("Deploy", "pending")])
        self.assertEqual([(s.name, s.status) for s in stages[1].steps or []], [("echo lint", "success")])
        self.assertEqual([(s.name, s.status) for s in stages[2].steps or []], [("Run e2e", "running")])
        self.assertIsNone(stages[3].steps)
        self.assertFalse(any("wfapi" in url for url in fetched))

    def test_stages_only_followed_under_configured_job(self) -> None:
        repo_path = Path("/tmp/repo")
        config = {"rules": [{"id": "r1", "name": "Rule", "repo_paths": [str(repo_path)], "job_url": "https://jenkins.example.com/job/p"}]}
        fetched: list[str] = []

        def fake_fetch_json(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            return {"stages": []}

        with patch.object(jenkins, "_fetch_json", fake_fetch_json):
            self.assertIsNone(jenkins.get_build_stages(repo_path, config, "https://evil.example.com/job/p/7/"))
            self.assertIsNone(jenkins.get_build_stages(repo_path, config, "https://jenkins.example.com/job/p-other/7/"))
            self.assertEqual(jenkins.get_build_stages(repo_path, config, "https://jenkins.example.com/job/p/7/"), [])
        self.assertTrue(fetched)
        self.assertTrue(all(url.startswith("https://jenkins.example.com/job/p/7/") for url in fetched))

    def test_active_builds_only_include_building_ones(self) -> None:
        repo_path = Path("/tmp/repo")
        config = {"rules": [{"id": "r1", "name": "Rule", "repo_paths": [str(repo_path)], "job_url": "https://jenkins.example.com/job/p"}]}

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


class FakeJenkins:
    """A single job `https://j/job/p` whose builds can be edited between calls."""

    job = "https://j/job/p"

    def __init__(self) -> None:
        self.builds: dict[int, dict] = {}  # number -> {"sha", "timestamp"}
        self.first_number: int | None = None
        self.listing_cap = 50
        self.fetched: list[str] = []

    def add(self, number: int, sha: str, timestamp: int = 1_700_000_000_000) -> None:
        self.builds[number] = {"sha": sha, "timestamp": timestamp}

    def url(self, number: int) -> str:
        return f"{self.job}/{number}/"

    def fetch_json(self, url: str, headers: dict[str, str]) -> dict | None:
        self.fetched.append(url)
        if url.startswith(f"{self.job}/api/json"):
            numbers = sorted(self.builds, reverse=True)[: self.listing_cap]
            first = self.first_number if self.first_number is not None else (min(self.builds) if self.builds else None)
            return {
                "builds": [
                    {
                        "number": n,
                        "url": self.url(n),
                        "timestamp": self.builds[n]["timestamp"],
                        "result": "SUCCESS",
                        "building": False,
                        "actions": [{"lastBuiltRevision": {"SHA1": self.builds[n]["sha"]}}],
                    }
                    for n in numbers
                ],
                "firstBuild": {"number": first} if first is not None else None,
            }
        for n, build in self.builds.items():
            if url.startswith(f"{self.url(n)}api/json"):
                return {
                    "number": n,
                    "url": self.url(n),
                    "result": "SUCCESS",
                    "building": False,
                    "timestamp": build["timestamp"],
                    "actions": [{"lastBuiltRevision": {"SHA1": build["sha"]}}],
                    "changeSet": {"items": []},
                }
            if url.startswith(f"{self.url(n)}stages/tree"):
                return {"data": {"stages": [{"id": "1", "name": "Build", "state": "success", "children": []}]}}
            if url.startswith(f"{self.url(n)}stages/allSteps"):
                return {"data": {"steps": []}}
        return None

    def build_detail_fetches(self) -> list[str]:
        return [url for url in self.fetched if "/api/json" in url and not url.startswith(f"{self.job}/api/json")]


class JenkinsRunCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        run_cache.configure(Path(self._tmp.name) / "ci.sqlite")
        self.jenkins = FakeJenkins()
        self.repo_path = Path("/tmp/repo")
        self.config = {"build_limit": 50, "rules": [{"id": "r1", "name": "Rule", "repo_paths": [str(self.repo_path)], "job_url": FakeJenkins.job}]}
        self.patch = patch.object(jenkins, "_fetch_json", self.jenkins.fetch_json)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        run_cache.configure(None)
        self._tmp.cleanup()

    def builds(self, *shas: str) -> dict[str, list]:
        return jenkins.get_jenkins_builds(self.repo_path, set(shas), self.config)

    def test_finished_build_is_fetched_once(self) -> None:
        self.jenkins.add(7, "a" * 40)
        self.assertEqual(len(self.builds("a" * 40)["a" * 40]), 1)
        self.assertEqual(len(self.jenkins.build_detail_fetches()), 1)

        self.jenkins.fetched.clear()
        second = self.builds("a" * 40)
        self.assertEqual([(b.number, b.archived) for b in second["a" * 40]], [(7, False)])
        self.assertEqual(self.jenkins.build_detail_fetches(), [])

    def test_deleted_build_is_kept_and_marked_archived(self) -> None:
        self.jenkins.add(5, "a" * 40)
        self.jenkins.add(7, "b" * 40)
        self.builds("a" * 40, "b" * 40)

        del self.jenkins.builds[5]  # Jenkins discarded it
        result = self.builds("a" * 40, "b" * 40)

        self.assertEqual([(b.number, b.archived) for b in result["a" * 40]], [(5, True)])
        self.assertEqual([(b.number, b.archived) for b in result["b" * 40]], [(7, False)])

    def test_build_older_than_capped_listing_is_not_archived(self) -> None:
        self.jenkins.add(5, "a" * 40)
        self.jenkins.add(7, "b" * 40)
        self.builds("a" * 40, "b" * 40)

        self.jenkins.listing_cap = 1  # 5 still exists, just past the listing
        result = self.builds("a" * 40)

        self.assertEqual([(b.number, b.archived) for b in result["a" * 40]], [(5, False)])

    def test_recreated_job_with_reused_number_is_refetched(self) -> None:
        self.jenkins.add(7, "a" * 40, timestamp=1_700_000_000_000)
        self.builds("a" * 40)

        self.jenkins.add(7, "c" * 40, timestamp=1_800_000_000_000)
        self.jenkins.fetched.clear()
        result = self.builds("a" * 40, "c" * 40)

        self.assertEqual(len(self.jenkins.build_detail_fetches()), 1)
        self.assertNotIn("a" * 40, result)
        self.assertEqual([b.number for b in result["c" * 40]], [7])

    def test_stages_of_finished_build_come_from_cache(self) -> None:
        self.jenkins.add(7, "a" * 40)
        self.builds("a" * 40)

        first = jenkins.get_build_stages(self.repo_path, self.config, self.jenkins.url(7))
        self.jenkins.fetched.clear()
        second = jenkins.get_build_stages(self.repo_path, self.config, self.jenkins.url(7))

        self.assertEqual([s.name for s in first or []], ["Build"])
        self.assertEqual(second, first)
        self.assertEqual(self.jenkins.fetched, [])

    def test_recent_builds_include_archived_ones(self) -> None:
        self.jenkins.add(5, "a" * 40)
        self.jenkins.add(7, "b" * 40)
        jenkins.get_recent_builds(self.repo_path, self.config, 10)

        del self.jenkins.builds[5]
        recent = jenkins.get_recent_builds(self.repo_path, self.config, 10)

        self.assertEqual(sorted((b.number, b.archived) for b in recent), [(5, True), (7, False)])


if __name__ == "__main__":
    unittest.main()

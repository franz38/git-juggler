from __future__ import annotations

import io
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from git_juggler import ci, github_actions, jenkins
from git_juggler.schemas import CiRunInfo, CiStage


def _run(provider: str, run_id: str, status: str = "running") -> CiRunInfo:
    return CiRunInfo(provider=provider, status=status, name="CI", number=1, url="u", run_id=run_id)


class PollDispatchTest(unittest.TestCase):
    def test_discovery_asks_every_enabled_provider_for_all_active_runs(self) -> None:
        calls: list[tuple[str, object, object]] = []

        def gh(path, cfg, run_ids, head_sha=None):
            calls.append(("gh", run_ids, head_sha))
            return [_run("github_actions", "1")]

        def jk(path, cfg, run_ids, head_sha=None):
            calls.append(("jk", run_ids, head_sha))
            return [_run("jenkins", "http://j/job/x/3/")]

        with patch.object(github_actions, "poll_runs", gh), patch.object(jenkins, "poll_runs", jk):
            runs = ci.poll_ci_runs(Path("/tmp/a"), None, "abc", None, {"enabled": True})

        self.assertEqual([r.provider for r in runs], ["github_actions", "jenkins"])
        self.assertEqual(calls, [("gh", None, "abc"), ("jk", None, "abc")])

    def test_tracking_only_asks_the_named_providers_about_their_runs(self) -> None:
        seen: dict[str, list[str] | None] = {}

        def gh(path, cfg, run_ids, head_sha=None):
            seen["gh"] = run_ids
            return []

        def jk(path, cfg, run_ids, head_sha=None):
            seen["jk"] = run_ids
            return []

        with patch.object(github_actions, "poll_runs", gh), patch.object(jenkins, "poll_runs", jk):
            # the Jenkins run id is a URL, so it contains ':' itself
            ci.poll_ci_runs(Path("/tmp/a"), ["github_actions:11", "github_actions:12"], None, None, {"enabled": True})
            self.assertEqual(seen, {"gh": ["11", "12"]})
            seen.clear()
            ci.poll_ci_runs(Path("/tmp/a"), ["jenkins:http://j/job/x/3/"], None, None, {"enabled": True})
            self.assertEqual(seen, {"jk": ["http://j/job/x/3/"]})

    def test_malformed_refs_are_ignored(self) -> None:
        with patch.object(github_actions, "poll_runs", lambda *a, **k: self.fail("should not be called")):
            self.assertEqual(ci.poll_ci_runs(Path("/tmp/a"), ["nonsense", "github_actions:"], None, None, None), [])


class GitHubTrackingTest(unittest.TestCase):
    CONFIG = {"repos": [{"repo_path": "/tmp/repo", "owner": "o", "repo": "r"}]}

    def test_get_runs_by_id_fetches_stages_only_for_running_runs(self) -> None:
        urls: list[str] = []

        def fake(url: str, headers: dict[str, str]) -> dict | None:
            urls.append(url)
            if url.endswith("/runs/1/jobs?per_page=100"):
                return {"jobs": [{"name": "build", "status": "in_progress", "conclusion": None}]}
            if url.endswith("/runs/1"):
                return {"id": 1, "status": "in_progress", "conclusion": None, "run_number": 5, "head_sha": "abc"}
            if url.endswith("/runs/2"):
                return {"id": 2, "status": "completed", "conclusion": "success", "run_number": 4, "head_sha": "def"}
            return None

        with patch.object(github_actions, "_get_json_cached", fake):
            runs = github_actions.get_runs_by_id(Path("/tmp/repo"), self.CONFIG, ["1", "2", "../x"])

        self.assertEqual([(r.run_id, r.status, r.head_sha) for r in runs], [("1", "running", "abc"), ("2", "success", "def")])
        self.assertEqual(runs[0].stages[0].name, "build")
        self.assertIsNone(runs[1].stages)
        self.assertFalse(any("/runs/2/jobs" in url or ".." in url for url in urls))

    def test_discovery_narrows_to_the_commit(self) -> None:
        urls: list[str] = []

        def fake(url: str, headers: dict[str, str]) -> dict | None:
            urls.append(url)
            return {"workflow_runs": []}

        with patch.object(github_actions, "_get_json_cached", fake):
            github_actions.poll_runs(Path("/tmp/repo"), self.CONFIG, None, "abc123")
        self.assertIn("head_sha=abc123", urls[0])


class EtagCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        github_actions._ETAG_CACHE.clear()

    def test_sends_if_none_match_and_serves_cached_body_on_304(self) -> None:
        sent: list[dict[str, str]] = []

        class FakeResponse(io.BytesIO):
            headers = {"ETag": '"v1"'}

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(request, timeout=10):
            sent.append(dict(request.header_items()))
            if len(sent) == 1:
                return FakeResponse(b'{"id": 7}')
            raise HTTPError(request.full_url, 304, "Not Modified", {}, None)

        with patch.object(github_actions, "urlopen", fake_urlopen):
            first = github_actions._get_json_cached("https://api/x", {})
            second = github_actions._get_json_cached("https://api/x", {})

        self.assertEqual(first, {"id": 7})
        self.assertEqual(second, {"id": 7})
        self.assertNotIn("If-none-match", sent[0])
        self.assertEqual(sent[1].get("If-none-match"), '"v1"')

    def test_error_without_cache_returns_none(self) -> None:
        def fake_urlopen(request, timeout=10):
            raise HTTPError(request.full_url, 500, "boom", {}, None)

        with patch.object(github_actions, "urlopen", fake_urlopen):
            self.assertIsNone(github_actions._get_json_cached("https://api/y", {}))


class JenkinsTrackingTest(unittest.TestCase):
    CONFIG = {"jobs": [{"repo_path": "/tmp/repo", "job_url": "http://j/job/app"}]}

    def test_only_urls_under_a_configured_job_are_fetched(self) -> None:
        fetched: list[str] = []

        def fake_fetch_build(url: str, headers: dict[str, str]) -> dict | None:
            fetched.append(url)
            return {"number": 3, "url": url + "/", "building": True, "result": None, "actions": [{"lastBuiltRevision": {"SHA1": "abc"}}]}

        stages = [CiStage(name="build", status="running")]
        with (
            patch.object(jenkins, "_fetch_build", fake_fetch_build),
            patch.object(jenkins, "_fetch_build_stages", lambda url, headers: stages),
        ):
            runs = jenkins.get_builds_by_url(
                Path("/tmp/repo"),
                self.CONFIG,
                ["http://j/job/app/3/", "http://evil/job/app/3/", "http://j/job/app/../other/1/", "http://j/job/app-other/1/"],
            )

        self.assertEqual(fetched, ["http://j/job/app/3"])
        self.assertEqual(len(runs), 1)
        self.assertEqual((runs[0].status, runs[0].head_sha, runs[0].stages), ("running", "abc", stages))

    def test_finished_build_has_no_stages(self) -> None:
        build = {"number": 3, "url": "http://j/job/app/3/", "building": False, "result": "SUCCESS", "actions": []}
        with (
            patch.object(jenkins, "_fetch_build", lambda url, headers: build),
            patch.object(jenkins, "_fetch_build_stages", lambda url, headers: self.fail("no stages for a finished build")),
        ):
            runs = jenkins.get_builds_by_url(Path("/tmp/repo"), self.CONFIG, ["http://j/job/app/3"])
        self.assertEqual([(r.status, r.stages) for r in runs], [("success", None)])


if __name__ == "__main__":
    unittest.main()

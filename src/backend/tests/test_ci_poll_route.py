from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.routing import APIRoute

from git_juggler import app as app_module
from git_juggler.api import ci as ci_api
from git_juggler.schemas import CiRunInfo


class CiPollRouteTest(unittest.TestCase):
    """The route is checked through FastAPI's route metadata and by calling its
    endpoint function (no HTTP client is installed for tests)."""

    def _route(self) -> APIRoute:
        app = app_module.create_app(Path("/tmp"))
        routes = list(app.routes)
        for route in app.routes:
            if hasattr(route, "original_router"):
                routes.extend(route.original_router.routes)
        return next(r for r in routes if isinstance(r, APIRoute) and r.path == "/api/repos/{repo_id}/ci/poll")

    def test_run_is_a_repeatable_query_param_and_head_sha_is_optional(self) -> None:
        route = self._route()
        self.assertEqual(route.methods, {"GET"})
        query = {field.name: field for field in route.dependant.query_params}
        self.assertEqual(set(query), {"run", "head_sha", "branch_name"})
        self.assertFalse(query["run"].field_info.is_required())
        self.assertFalse(query["head_sha"].field_info.is_required())
        self.assertFalse(query["branch_name"].field_info.is_required())
        # a list-typed query param is what makes `?run=a&run=b` arrive as ["a", "b"]
        self.assertIn("list", str(query["run"].field_info.annotation))

    def test_endpoint_forwards_refs_and_commit(self) -> None:
        captured: dict = {}

        def fake_poll(path, refs, head_sha, branch_name, github_config, jenkins_config):
            captured.update(path=path, refs=refs, head_sha=head_sha, branch_name=branch_name)
            return [CiRunInfo(provider="jenkins", status="running", name="x", number=1, url="u", run_id="r", head_sha=head_sha)]

        route = self._route()
        with (
            patch.object(ci_api, "resolve_repo_path", lambda paths, repo_id: Path("/tmp/repo")),
            patch.object(ci_api, "poll_ci_runs", fake_poll),
        ):
            runs = route.endpoint(repo_id="k::x", run=["github_actions:1"], head_sha="abc", branch_name="main")
            self.assertEqual(captured, {"path": Path("/tmp/repo"), "refs": ["github_actions:1"], "head_sha": "abc", "branch_name": "main"})
            self.assertEqual(runs[0].head_sha, "abc")

            route.endpoint(repo_id="k::x", run=None, head_sha=None, branch_name=None)
            self.assertIsNone(captured["refs"])


if __name__ == "__main__":
    unittest.main()

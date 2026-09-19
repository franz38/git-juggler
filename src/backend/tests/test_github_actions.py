from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from git import Repo

from git_juggler import github_actions
from git_juggler.github_actions import _inferred_repo_config, _matching_run_sha, _repo_config_from_remote_url


class FakeResponse:
    def __init__(self, body: dict) -> None:
        self.body = body

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.body).encode("utf-8")


class GitHubActionsRepoInferenceTest(unittest.TestCase):
    def test_parses_github_https_remote(self) -> None:
        self.assertEqual(
            _repo_config_from_remote_url("https://github.com/octo-org/octo-repo.git"),
            {"api_base_url": "https://api.github.com", "owner": "octo-org", "repo": "octo-repo"},
        )

    def test_parses_github_ssh_remote(self) -> None:
        self.assertEqual(
            _repo_config_from_remote_url("git@github.com:octo-org/octo-repo.git"),
            {"api_base_url": "https://api.github.com", "owner": "octo-org", "repo": "octo-repo"},
        )

    def test_parses_github_enterprise_remote(self) -> None:
        self.assertEqual(
            _repo_config_from_remote_url("ssh://git@github.example.com/octo-org/octo-repo.git"),
            {"api_base_url": "https://github.example.com/api/v3", "owner": "octo-org", "repo": "octo-repo"},
        )

    def test_ignores_ssh_alias_remote(self) -> None:
        self.assertIsNone(_repo_config_from_remote_url("git@github-work:octo-org/octo-repo.git"))

    def test_infers_from_origin_remote(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            repo = Repo.init(path)
            repo.create_remote("origin", "https://github.com/octo-org/octo-repo.git")

            self.assertEqual(
                _inferred_repo_config(path),
                {"api_base_url": "https://api.github.com", "owner": "octo-org", "repo": "octo-repo"},
            )

    def test_matches_tag_triggered_run_by_head_branch(self) -> None:
        commit_sha = "a" * 40
        self.assertEqual(
            _matching_run_sha(
                {"head_sha": "b" * 40, "head_branch": "v1.0.0"},
                {commit_sha},
                {"v1.0.0": commit_sha},
            ),
            commit_sha,
        )

    def test_matches_tag_triggered_run_with_refs_tags_prefix(self) -> None:
        commit_sha = "a" * 40
        self.assertEqual(
            _matching_run_sha(
                {"head_sha": "b" * 40, "head_branch": "refs/tags/v1.0.0"},
                {commit_sha},
                {"v1.0.0": commit_sha},
            ),
            commit_sha,
        )

    def test_fetches_paginated_workflow_runs(self) -> None:
        first_page = {"workflow_runs": [{"id": idx} for idx in range(github_actions.GITHUB_RUNS_PER_PAGE)]}
        second_page = {"workflow_runs": [{"id": 999}]}
        calls = []

        def fake_urlopen(request: object, timeout: int) -> FakeResponse:
            calls.append(request)
            return FakeResponse(first_page if len(calls) == 1 else second_page)

        with patch.object(github_actions, "urlopen", fake_urlopen):
            runs = github_actions._fetch_workflow_runs({}, {"owner": "octo-org", "repo": "octo-repo"})

        self.assertEqual(len(calls), 2)
        self.assertEqual(len(runs), github_actions.GITHUB_RUNS_PER_PAGE + 1)
        self.assertEqual(runs[-1]["id"], 999)


if __name__ == "__main__":
    unittest.main()

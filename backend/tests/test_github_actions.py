from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from git import Repo

from git_juggler.github_actions import _inferred_repo_config, _repo_config_from_remote_url


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


if __name__ == "__main__":
    unittest.main()

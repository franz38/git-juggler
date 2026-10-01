from __future__ import annotations

import pytest

from git_juggler import config
from git_juggler.ci import run_cache


@pytest.fixture(autouse=True)
def _isolated_ci_cache(tmp_path, monkeypatch):
    """Keep every test off the user's real CI run cache: `create_app` turns the
    cache on under `config.CONFIG_DIR`, so point that at a temp dir, and leave
    the cache off once the test is done."""
    monkeypatch.setattr(config, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    yield
    run_cache.configure(None)

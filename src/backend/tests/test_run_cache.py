from __future__ import annotations

from pathlib import Path

import pytest

from git_juggler.ci import run_cache
from git_juggler.schemas import CiRunInfo, CiStage


@pytest.fixture
def cache(tmp_path: Path):
    run_cache.configure(tmp_path / "ci.sqlite")
    return run_cache


def _run(run_id: str, status: str = "success", created_at: str = "2026-01-01T10:00:00Z") -> CiRunInfo:
    return CiRunInfo(provider="jenkins", status=status, name="job", number=1, url=run_id, run_id=run_id, created_at=created_at)


def test_off_until_configured() -> None:
    run_cache.put("jenkins", "s", _run("u1"), {"a"})
    assert run_cache.get("jenkins", "u1") is None
    assert run_cache.for_scope_prefixes("jenkins", ["s"]) == []


def test_round_trip_keeps_run_and_accumulates_shas(cache) -> None:
    cache.put("jenkins", "https://j/job/p", _run("u1"), {"a"})
    cache.put("jenkins", "https://j/job/p", _run("u1"), {"b"})

    stored = cache.get("jenkins", "u1")
    assert stored is not None
    assert stored.scope == "https://j/job/p"
    assert stored.run.status == "success"
    assert stored.shas == {"a", "b"}


def test_only_finished_runs_are_stored(cache) -> None:
    for status in ("running", "pending", "unknown"):
        cache.put("jenkins", "s", _run(f"u-{status}", status), set())
        assert cache.get("jenkins", f"u-{status}") is None


def test_stages_stored_only_when_all_final_and_survive_put(cache) -> None:
    cache.put("jenkins", "s", _run("u1"), set())
    cache.put_stages("jenkins", "u1", [CiStage(name="build", status="success", steps=[CiStage(name="sh", status="running")])])
    assert cache.get("jenkins", "u1").run.stages is None

    cache.put_stages("jenkins", "u1", [CiStage(name="build", status="failure", steps=[CiStage(name="sh", status="failure")])])
    cache.put("jenkins", "s", _run("u1"), set())

    stages = cache.get("jenkins", "u1").run.stages
    assert [(s.name, s.status) for s in stages] == [("build", "failure")]
    assert stages[0].steps[0].name == "sh"


def test_scope_prefixes_match_whole_segments_newest_first(cache) -> None:
    cache.put("jenkins", "https://j/job/p/job/main", _run("u1", created_at="2026-01-01T10:00:00Z"), set())
    cache.put("jenkins", "https://j/job/p/job/dev", _run("u2", created_at="2026-01-01T11:00:00Z"), set())
    cache.put("jenkins", "https://j/job/p2", _run("u3"), set())
    cache.put("jenkins", "https://j/job/p_x", _run("u4"), set())

    assert [c.run.run_id for c in cache.for_scope_prefixes("jenkins", ["https://j/job/p"])] == ["u2", "u1"]
    assert [c.run.run_id for c in cache.for_scope_prefixes("jenkins", ["https://j/job/p/"], limit=1)] == ["u2"]
    assert [c.run.run_id for c in cache.for_scope_prefixes("jenkins", ["https://j/job/p2"])] == ["u3"]
    assert cache.for_scope_prefixes("github_actions", ["https://j/job/p"]) == []


def test_get_many_delete_and_clear(cache) -> None:
    cache.put("jenkins", "s", _run("u1"), set())
    cache.put("jenkins", "s", _run("u2"), set())

    assert set(cache.get_many("jenkins", ["u1", "u2", "missing"])) == {"u1", "u2"}
    cache.delete("jenkins", "u1")
    assert cache.get("jenkins", "u1") is None
    cache.clear()
    assert cache.get("jenkins", "u2") is None

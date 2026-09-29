"""Persistent store of finished CI runs and their stages.

A finished run never changes, so once seen it is kept (forever, until cleared
from the settings): the providers skip refetching it, and a run the CI server
has since deleted (e.g. Jenkins discarding old builds) can still be shown.

Only final runs are stored, and a run's stages only once every stage/step is
final too. The store is off until `configure()` is called (at app start), so
tests and throwaway instances never touch the user's real cache.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from ..schemas import CiRunInfo, CiStage

_UNFINISHED_RUN = {"running", "pending", "unknown"}
_UNFINISHED_STAGE = {"running", "pending", "unknown", "action_required"}

_lock = threading.Lock()
_db_path: Path | None = None


@dataclass
class CachedRun:
    scope: str
    run: CiRunInfo  # with `stages` when they have been stored
    shas: set[str]


def configure(path: Path | None) -> None:
    """Turn the store on at `path` (None turns it off)."""
    global _db_path
    with _lock:
        _db_path = path
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        with _connect(path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS runs ("
                " provider TEXT NOT NULL, run_id TEXT NOT NULL, scope TEXT NOT NULL,"
                " run_json TEXT NOT NULL, stages_json TEXT, shas_json TEXT NOT NULL,"
                " created_at TEXT, cached_at REAL NOT NULL,"
                " PRIMARY KEY (provider, run_id))"
            )
            db.execute("CREATE INDEX IF NOT EXISTS runs_scope ON runs (provider, scope)")


@contextmanager
def _connect(path: Path) -> Iterator[sqlite3.Connection]:
    """One short-lived connection per operation: committed and closed."""
    db = sqlite3.connect(path, timeout=5)
    try:
        with db:
            yield db
    finally:
        db.close()


def is_final_run(run: CiRunInfo) -> bool:
    return run.status not in _UNFINISHED_RUN


def _stages_final(stages: list[CiStage]) -> bool:
    return all(stage.status not in _UNFINISHED_STAGE and _stages_final(stage.steps or []) for stage in stages)


def _row_to_cached(row: tuple) -> CachedRun:
    scope, run_json, stages_json, shas_json = row
    run = CiRunInfo.model_validate_json(run_json)
    if stages_json:
        run.stages = [CiStage.model_validate(item) for item in json.loads(stages_json)]
    return CachedRun(scope=scope, run=run, shas=set(json.loads(shas_json)))


def get(provider: str, run_id: str) -> CachedRun | None:
    with _lock:
        if _db_path is None:
            return None
        try:
            with _connect(_db_path) as db:
                row = db.execute(
                    "SELECT scope, run_json, stages_json, shas_json FROM runs WHERE provider = ? AND run_id = ?",
                    (provider, run_id),
                ).fetchone()
        except sqlite3.Error:
            return None
    return _row_to_cached(row) if row else None


def get_many(provider: str, run_ids: list[str]) -> dict[str, CachedRun]:
    """Stored runs among `run_ids`, by run id (one query per 500 ids)."""
    ids = list(dict.fromkeys(run_ids))
    found: dict[str, CachedRun] = {}
    with _lock:
        if _db_path is None or not ids:
            return found
        try:
            with _connect(_db_path) as db:
                for start in range(0, len(ids), 500):
                    chunk = ids[start : start + 500]
                    rows = db.execute(
                        "SELECT run_id, scope, run_json, stages_json, shas_json FROM runs"
                        f" WHERE provider = ? AND run_id IN ({', '.join('?' for _ in chunk)})",
                        [provider, *chunk],
                    ).fetchall()
                    for row in rows:
                        found[row[0]] = _row_to_cached(row[1:])
        except sqlite3.Error:
            return {}
    return found


def put(provider: str, scope: str, run: CiRunInfo, shas: set[str]) -> None:
    """Store a finished run (anything else is ignored). Stages already stored
    for it are kept; commit hashes accumulate across sightings."""
    if not run.run_id or not is_final_run(run):
        return
    with _lock:
        if _db_path is None:
            return
        try:
            with _connect(_db_path) as db:
                row = db.execute(
                    "SELECT shas_json FROM runs WHERE provider = ? AND run_id = ?", (provider, run.run_id)
                ).fetchone()
                all_shas = sorted(shas | (set(json.loads(row[0])) if row else set()))
                run_json = run.model_copy(update={"stages": None, "archived": False}).model_dump_json()
                db.execute(
                    "INSERT INTO runs (provider, run_id, scope, run_json, shas_json, created_at, cached_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT (provider, run_id) DO UPDATE SET scope = excluded.scope,"
                    " run_json = excluded.run_json, shas_json = excluded.shas_json,"
                    " created_at = excluded.created_at",
                    (provider, run.run_id, scope, run_json, json.dumps(all_shas), run.created_at, time.time()),
                )
        except sqlite3.Error:
            return


def put_stages(provider: str, run_id: str, stages: list[CiStage]) -> None:
    """Attach stages to a stored run, once they are all final."""
    if not stages or not _stages_final(stages):
        return
    with _lock:
        if _db_path is None:
            return
        try:
            with _connect(_db_path) as db:
                db.execute(
                    "UPDATE runs SET stages_json = ? WHERE provider = ? AND run_id = ?",
                    (json.dumps([stage.model_dump(mode="json") for stage in stages]), provider, run_id),
                )
        except sqlite3.Error:
            return


def delete(provider: str, run_id: str) -> None:
    with _lock:
        if _db_path is None:
            return
        try:
            with _connect(_db_path) as db:
                db.execute("DELETE FROM runs WHERE provider = ? AND run_id = ?", (provider, run_id))
        except sqlite3.Error:
            return


def for_scope_prefixes(provider: str, prefixes: list[str], limit: int | None = None) -> list[CachedRun]:
    """Stored runs whose scope is one of `prefixes` or lies under one (whole
    path segments: `.../job/p` covers `.../job/p/job/main`, not `.../job/p2`),
    newest first."""
    prefixes = [prefix.rstrip("/") for prefix in dict.fromkeys(prefixes) if prefix.rstrip("/")]
    if not prefixes:
        return []
    # substr() rather than LIKE: URLs are full of `_`, a LIKE wildcard.
    where = " OR ".join("scope = ? OR substr(scope, 1, ?) = ?" for _ in prefixes)
    params: list[object] = [provider]
    for prefix in prefixes:
        params.extend([prefix, len(prefix) + 1, f"{prefix}/"])
    sql = f"SELECT scope, run_json, stages_json, shas_json FROM runs WHERE provider = ? AND ({where}) ORDER BY created_at DESC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    with _lock:
        if _db_path is None:
            return []
        try:
            with _connect(_db_path) as db:
                rows = db.execute(sql, params).fetchall()
        except sqlite3.Error:
            return []
    return [_row_to_cached(row) for row in rows]


def clear() -> None:
    with _lock:
        if _db_path is None:
            return
        try:
            with _connect(_db_path) as db:
                db.execute("DELETE FROM runs")
        except sqlite3.Error:
            return

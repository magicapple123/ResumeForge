# SPDX-License-Identifier: Apache-2.0
"""Read-only inspection of an existing stress run directory.

``--check-only`` is the *only* inspection entry point and it is strictly
read-only:

- opens the SQLite file with ``mode=ro`` (SQLite refuses writes, and no
  ``-wal``/``-shm`` side files are created),
- prints per-table row counts,
- summarizes ``manifest.json`` when present,
- cross-checks physical ``user_files`` entries against ``user_file`` rows.

It never seeds, never drops, never deletes, and never imports ``app``.
Exit code 0 = checks passed, 2 = target missing or inconsistent.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any

from .manifest import read_manifest

DB_FILENAME = "stress.db"
USER_FILES_DIRNAME = "user_files"


def _connect_read_only(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def _table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows]


def _quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def inspect_existing(target: Path) -> int:
    """Inspect an existing run directory (or direct db path); print a report."""
    if target.is_dir():
        run_dir = target
        db_path = run_dir / DB_FILENAME
    elif target.is_file():
        db_path = target
        run_dir = db_path.parent
    else:
        print(
            f"check-only: target does not exist (read-only, nothing created): {target}",
            file=sys.stderr,
        )
        return 2
    if not db_path.is_file():
        print(f"check-only: no {DB_FILENAME} under {run_dir}", file=sys.stderr)
        return 2

    problems: list[str] = []
    try:
        connection = _connect_read_only(db_path)
    except sqlite3.Error as exc:
        print(f"check-only: cannot open database read-only: {exc}", file=sys.stderr)
        return 2

    counts: dict[str, int] = {}
    try:
        for name in _table_names(connection):
            try:
                counts[name] = int(
                    connection.execute(f"SELECT COUNT(*) FROM {_quoted(name)}").fetchone()[0]
                )
            except sqlite3.Error as exc:
                problems.append(f"table {name}: {exc}")
    finally:
        connection.close()

    total_rows = sum(counts.values())
    print(f"check-only (read-only) database: {db_path}")
    print(f"tables: {len(counts)}, total rows: {total_rows}")
    for name in sorted(counts):
        print(f"  {name}: {counts[name]}")

    manifest: dict[str, Any] | None = read_manifest(run_dir)
    if manifest is None:
        problems.append(f"no readable manifest.json in {run_dir}")
        print("manifest: MISSING")
    else:
        print(
            "manifest: seed={seed} scale_counts.job={job} schema_head={head} "
            "created_at={created}".format(
                seed=manifest.get("seed"),
                job=(manifest.get("scale_counts") or {}).get("job"),
                head=manifest.get("schema_head"),
                created=manifest.get("created_at"),
            )
        )

    # Physical user_files <-> DB rows consistency (read-only on both sides).
    user_files_dir = run_dir / USER_FILES_DIRNAME
    disk_names: set[str] = set()
    if user_files_dir.is_dir():
        disk_names = {item.name for item in user_files_dir.iterdir() if item.is_file()}
    referenced: set[str] = set()
    if "user_file" in counts:
        connection = _connect_read_only(db_path)
        try:
            referenced = {
                str(row[0])
                for row in connection.execute("SELECT disk_name FROM user_file").fetchall()
            }
        finally:
            connection.close()
        missing_on_disk = sorted(referenced - disk_names)
        if missing_on_disk:
            problems.append(
                f"{len(missing_on_disk)} user_file rows have no physical file "
                f"(first: {missing_on_disk[0]})"
            )
    print(f"user_files: {len(disk_names)} on disk, {len(referenced)} referenced by DB")

    if problems:
        print("check-only: PROBLEMS FOUND:")
        for item in problems:
            print(f"  - {item}")
        return 2
    print("check-only: OK")
    return 0

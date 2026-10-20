# SPDX-License-Identifier: Apache-2.0
"""Seed context: everything the generators need, passed explicitly.

The original script kept ``engine`` / ``rng`` / ``NOW`` / count constants as
module globals, which is why merely importing it re-built a database. Here
the generators receive a :class:`SeedContext` value and nothing is global.
"""

from __future__ import annotations

import random
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .counts import ScaleCounts

# The dataset's "now". A fixed anchor (same policy as seed_demo_data) keeps
# reruns reproducible; the real wall-clock time of the run is recorded in
# the manifest separately.
NOW_ANCHOR = datetime(2026, 10, 12, 12, 0, 0)
EVENT_RANGE_START = datetime(2025, 8, 1, 0, 0, 0)


def row(**kwargs: Any) -> dict[str, Any]:
    """Build one insert row as a plain dict (kept from the original script)."""
    return kwargs


def date_str(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


class SeedContext:
    """Runtime handles for one seeding run.

    ``engine``/``tables``/``base_resume_content`` are produced by
    :mod:`stress_seed.schema` *after* the CLI has validated paths, so
    importing this module stays side-effect free.
    """

    def __init__(
        self,
        *,
        engine: Any,
        tables: dict[str, Any],
        counts: ScaleCounts,
        out_dir: Path,
        db_path: Path,
        user_files_dir: Path,
        base_resume_content: dict[str, Any],
        seed: int,
        now: datetime = NOW_ANCHOR,
    ) -> None:
        self.engine = engine
        self.tables = tables
        self.counts = counts
        self.out_dir = out_dir
        self.db_path = db_path
        self.user_files_dir = user_files_dir
        self.base_resume_content = base_resume_content
        self.seed = seed
        self.now = now
        self.rng = random.Random(seed)
        self.started = time.perf_counter()
        self.event_range_start = EVENT_RANGE_START

    # -- insertion helper ---------------------------------------------------
    def insert(self, table: str, rows: list[dict[str, Any]], chunk: int = 400) -> None:
        """Core batch insert: chunked multi-value lists to stay under the
        per-statement parameter limit."""
        if not rows:
            return
        from sqlalchemy import insert

        target = self.tables[table]
        for start in range(0, len(rows), chunk):
            with self.engine.begin() as conn:
                conn.execute(insert(target), rows[start : start + chunk])

    # -- time helpers -------------------------------------------------------
    def elapsed_seconds(self) -> float:
        """Wall-clock seconds since the context was created."""
        return time.perf_counter() - self.started

    def rand_dt(self, begin: datetime, end: datetime) -> datetime:
        """Random instant in ``[begin, end)`` drawn from the run RNG."""
        span = int((end - begin).total_seconds())
        return begin + timedelta(seconds=self.rng.randint(0, max(span, 1)))

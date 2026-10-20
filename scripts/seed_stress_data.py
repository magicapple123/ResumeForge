# SPDX-License-Identifier: Apache-2.0
"""Generate a fully fictional large-scale stress dataset (isolated sandbox only).

This is the thin CLI entry point; all logic lives in the ``stress_seed``
package next to this file (``scripts/stress_seed/``).

Safety contract (production-audit PR-01 -- replaces the old monolithic
script whose module-level code rebuilt a database on every import):

- Importing this file or any ``stress_seed`` module has NO side effects:
  no directory is created, no engine is built, no file is written.
- ``--help`` and invalid arguments are handled by argparse before anything
  touches the filesystem.
- Seeding always writes into a fresh run-id directory
  (``stress-<timestamp>-<rand>/``) strictly inside the sandbox root
  (default ``runtime/stress``). An existing target is rejected -- there is
  deliberately no overwrite path and nothing is ever deleted.
- Output layout per run::

      stress-<timestamp>-<rand>/
        stress.db          <- built with a real `alembic upgrade head`
        user_files/        <- physical copies matching the user_file table
        manifest.json      <- seed, scale, schema head, engine URL, hashes
        import_report.md   <- per-table row counts

- ``--check-only <run-dir-or-db>`` is strictly read-only (SQLite ``mode=ro``):
  table counts, manifest summary, user_files consistency. It never seeds
  and never drops anything.

Usage (repository root, Windows)::

    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py
    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py --scale 2000
    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py --check-only runtime\\stress\\stress-<...>
    backend\\.venv\\Scripts\\python.exe scripts\\seed_stress_data.py --api-check

Serving the generated dataset with an isolated backend instance (backend
directory)::

    $env:DATABASE_URL = "sqlite:///D:/ResumeForge/runtime/stress/stress-<...>/stress.db"
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 9412
"""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from stress_seed.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())

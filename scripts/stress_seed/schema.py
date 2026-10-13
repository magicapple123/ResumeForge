"""Lazy app bindings, engine creation, and Alembic schema initialization.

Everything here imports the application lazily and only inside functions,
so importing this module never builds an engine or touches the filesystem.

Schema policy: the database is initialized with a real ``alembic upgrade
head`` (currently ``0046_search_fts``), exactly like production -- never
with ``Base.metadata.create_all``. The Alembic head revision is returned so
the manifest can pin the schema version the dataset was built against.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def prepare_environment(db_path: Path) -> str:
    """Set the environment *before* any ``app`` import happens.

    ``app.config`` freezes ``database_url`` at import time, so the variable
    must be in place first. Logging to ``backend/data/logs`` is disabled:
    a stress run must not write anywhere outside its sandbox.
    """
    url = "sqlite:///" + db_path.resolve().as_posix()
    os.environ["DATABASE_URL"] = url
    os.environ["LOG_FILE_ENABLED"] = "false"
    return url


def load_app_metadata() -> tuple[dict[str, Any], dict[str, Any]]:
    """Import the app models (registering all tables) and the resume sample.

    Returns ``(tables, base_resume_content)``. Must be called after
    :func:`prepare_environment`.
    """
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    from app import models  # noqa: F401 - import registers every mapped table
    from app.database import Base
    from app.services.resume.resume_sample import sample_resume_content

    return dict(Base.metadata.tables), sample_resume_content().model_dump()


def create_engine_for(db_path: Path) -> Any:
    """Create a dedicated engine and assert it really binds the declared file.

    The audit found that a directory-level ``active.json`` pointer can
    silently redirect ``app.database``'s engine elsewhere; this script owns
    its engine, and this assertion pins the actual bound URL to the declared
    output path instead of trusting string configuration.
    """
    from sqlalchemy import create_engine

    expected = db_path.resolve()
    engine = create_engine("sqlite:///" + expected.as_posix())
    actual_raw = getattr(engine.url, "database", None)
    actual = Path(str(actual_raw or "")).resolve() if actual_raw else None
    if actual != expected:
        engine.dispose()
        raise RuntimeError(
            f"engine URL does not match the declared output: "
            f"engine={actual!r} declared={str(expected)!r}"
        )
    return engine


def init_schema(engine: Any) -> str:
    """Initialize the schema via ``alembic upgrade head``; return the head id."""
    from alembic import command
    from alembic.migration import MigrationContext
    from app.database_migrations import build_alembic_config

    config = build_alembic_config(engine)
    command.upgrade(config, "head")
    with engine.connect() as connection:
        revision = MigrationContext.configure(connection).get_current_revision()
    if not revision:
        raise RuntimeError("alembic upgrade head left no version stamp in the database")
    return str(revision)


def table_counts(engine: Any, tables: dict[str, Any]) -> dict[str, int]:
    """Row count of every registered table (single connection, read-only)."""
    from sqlalchemy import func, select

    counts: dict[str, int] = {}
    with engine.begin() as connection:
        for name, table in sorted(tables.items()):
            counts[name] = int(
                connection.execute(select(func.count()).select_from(table)).scalar() or 0
            )
    return counts

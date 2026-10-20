# SPDX-License-Identifier: Apache-2.0
"""Command-line interface: parsing first, assembly second.

Contract implemented here (production-audit PR-01):

- argparse runs before anything else; ``--help`` and argument errors touch
  no file, create no directory, and build no engine.
- Importing any module of this package has no side effects; ``run_seed``
  is the single assembly point that prepares the environment, imports the
  app, builds an engine, and initializes the schema with a real
  ``alembic upgrade head``.
- Seeding writes only into a fresh run-id directory strictly inside the
  sandbox root. An existing target is rejected; there is no overwrite mode.
- ``--check-only`` is strictly read-only (see :mod:`stress_seed.inspect`).
- Nothing is ever deleted: old stress artifacts are left untouched.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime
from pathlib import Path

from .counts import ALLOWED_SCALES, ScaleCounts, counts_for_scale
from .paths import PathSafetyError, ensure_inside_sandbox, propose_run_dir, validate_target_dir

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SANDBOX_ROOT = REPO_ROOT / "runtime" / "stress"
DEFAULT_SEED = 20261012
DB_FILENAME = "stress.db"
USER_FILES_DIRNAME = "user_files"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="seed_stress_data.py",
        description=(
            "Generate a fully fictional large-scale stress dataset in an isolated "
            "sandbox directory (never touches backend/data or any real database)."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--out",
        type=str,
        default=None,
        metavar="DIR",
        help=(
            "output run directory; must not exist and must lie strictly inside "
            "the sandbox root. Default: a fresh stress-<timestamp>-<rand> "
            "directory under the sandbox root."
        ),
    )
    parser.add_argument(
        "--sandbox-root",
        type=str,
        default=str(DEFAULT_SANDBOX_ROOT),
        metavar="DIR",
        help="sandbox root: every output must resolve strictly inside this directory",
    )
    parser.add_argument(
        "--scale",
        type=int,
        choices=list(ALLOWED_SCALES),
        default=500,
        help="target number of job rows (other domains scale proportionally)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help="random seed; same seed + same scale reproduces the same dataset",
    )
    parser.add_argument(
        "--check-only",
        type=str,
        default=None,
        metavar="TARGET",
        help=(
            "read-only inspection of an existing run directory (or .db file): "
            "prints table counts, manifest summary and user_files consistency. "
            "Never seeds, never writes."
        ),
    )
    parser.add_argument(
        "--api-check",
        action="store_true",
        help="after seeding, run the read-only endpoint self-check via TestClient",
    )
    return parser


def run_seed(
    *,
    out_dir: Path | None,
    sandbox_root: Path,
    counts: ScaleCounts,
    seed: int,
    argv: list[str],
    api_check: bool = False,
) -> int:
    """Assemble one seeding run; returns the process exit code."""
    counts.validate()
    try:
        target = (
            out_dir
            if out_dir is not None
            else propose_run_dir(sandbox_root, datetime.now(), random.Random())
        )
        resolved = validate_target_dir(target, sandbox_root)
    except PathSafetyError as exc:
        print(f"refusing to seed: {exc}", file=sys.stderr)
        return 2
    ensure_inside_sandbox(resolved, sandbox_root)

    db_path = resolved / DB_FILENAME
    user_files_dir = resolved / USER_FILES_DIRNAME

    # ---- from here on the run owns the directory: create it and write -------
    resolved.mkdir(parents=True)
    user_files_dir.mkdir()

    from . import schema

    engine_url = schema.prepare_environment(db_path)
    engine = None
    try:
        tables, base_resume_content = schema.load_app_metadata()
        engine = schema.create_engine_for(db_path)
        schema_head = schema.init_schema(engine)
        print(f"schema initialized at alembic head: {schema_head}")

        from .context import NOW_ANCHOR, SeedContext
        from .pipeline import seed_all

        ctx = SeedContext(
            engine=engine,
            tables=tables,
            counts=counts,
            out_dir=resolved,
            db_path=db_path,
            user_files_dir=user_files_dir,
            base_resume_content=base_resume_content,
            seed=seed,
            now=NOW_ANCHOR,
        )
        seed_all(ctx)

        from .manifest import build_manifest, write_manifest
        from .report import write_import_report

        counts_map = schema.table_counts(engine, tables)
        duration = ctx.elapsed_seconds()
        engine.dispose()
        engine = None

        manifest = build_manifest(
            out_dir=resolved,
            db_path=db_path,
            engine_url=engine_url,
            schema_head=schema_head,
            seed=seed,
            counts=counts.as_dict(),
            table_counts=counts_map,
            user_files_dir=user_files_dir,
            now_anchor=NOW_ANCHOR,
            cli_argv=argv,
            duration_seconds=duration,
        )
        write_manifest(resolved, manifest)
        empty_tables = write_import_report(
            out_dir=resolved,
            db_path=db_path,
            user_files_dir=user_files_dir,
            counts=counts_map,
            elapsed=duration,
            now_anchor=NOW_ANCHOR,
        )
    except Exception as exc:  # noqa: BLE001 - CLI boundary: report and fail cleanly
        if engine is not None:
            engine.dispose()
        print(f"seeding failed (run directory kept for inspection): {resolved}", file=sys.stderr)
        print(f"  {type(exc).__name__}: {exc}", file=sys.stderr)
        # 造数失败必须可定位：完整 traceback 帮助确认是哪个生成器、哪一行越界。
        import traceback

        traceback.print_exc(file=sys.stderr)
        return 1

    total_rows = sum(counts_map.values())
    print(f"stress dataset written: {db_path}")
    print(
        f"tables={len(counts_map)} rows={total_rows} "
        f"user_files={len(manifest['user_files'])} "
        f"duration={duration:.1f}s empty_tables={empty_tables or 'none'}"
    )
    print(f"manifest: {resolved / 'manifest.json'}")

    if api_check:
        from .apicheck import run_api_checks

        return run_api_checks()
    return 0


def main(argv: list[str] | None = None) -> int:
    """Parse arguments first, then dispatch; no side effects before this point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    argv_list = list(sys.argv[1:] if argv is None else argv)

    if args.check_only is not None:
        from .inspect import inspect_existing

        return inspect_existing(Path(args.check_only))

    return run_seed(
        out_dir=Path(args.out) if args.out else None,
        sandbox_root=Path(args.sandbox_root),
        counts=counts_for_scale(args.scale),
        seed=args.seed,
        argv=argv_list,
        api_check=args.api_check,
    )

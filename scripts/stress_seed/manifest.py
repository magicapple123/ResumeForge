"""Manifest writing: one JSON file per run describing exactly what was built."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

MANIFEST_FILENAME = "manifest.json"

CHUNK = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(CHUNK)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def build_manifest(
    *,
    out_dir: Path,
    db_path: Path,
    engine_url: str,
    schema_head: str,
    seed: int,
    counts: dict[str, int],
    table_counts: dict[str, int],
    user_files_dir: Path,
    now_anchor: datetime,
    cli_argv: list[str],
    duration_seconds: float,
) -> dict[str, Any]:
    """Assemble the manifest payload (hashing the database and user files)."""
    user_files: list[dict[str, Any]] = []
    if user_files_dir.is_dir():
        for item in sorted(user_files_dir.iterdir()):
            if item.is_file():
                user_files.append(
                    {
                        "name": item.name,
                        "size_bytes": item.stat().st_size,
                        "sha256": sha256_file(item),
                    }
                )
    return {
        "manifest_version": 2,
        "tool": "scripts/seed_stress_data.py",
        "python": sys.version.split()[0],
        "seed": seed,
        "scale_counts": counts,
        "schema_head": schema_head,
        "engine_url": engine_url,
        "database": str(db_path.resolve()),
        "database_size_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "database_sha256": sha256_file(db_path) if db_path.exists() else "",
        "table_counts": table_counts,
        "user_files_dir": str(user_files_dir.resolve()),
        "user_files": user_files,
        "now_anchor": now_anchor.isoformat(),
        "created_at": datetime.now().astimezone().isoformat(),
        "cli_argv": cli_argv,
        "duration_seconds": round(duration_seconds, 3),
    }


def write_manifest(out_dir: Path, payload: dict[str, Any]) -> Path:
    """Write ``manifest.json`` into the run directory and return its path."""
    manifest_path = out_dir / MANIFEST_FILENAME
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest_path


def read_manifest(run_dir: Path) -> dict[str, Any] | None:
    """Read the manifest of an existing run directory, if any."""
    manifest_path = run_dir / MANIFEST_FILENAME
    if not manifest_path.is_file():
        return None
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None

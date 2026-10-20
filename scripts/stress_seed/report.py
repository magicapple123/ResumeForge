# SPDX-License-Identifier: Apache-2.0
"""Markdown import report written next to the generated database."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

REPORT_FILENAME = "import_report.md"


def write_import_report(
    *,
    out_dir: Path,
    db_path: Path,
    user_files_dir: Path,
    counts: dict[str, int],
    elapsed: float,
    now_anchor: datetime,
) -> list[str]:
    """Write ``import_report.md`` into the run directory; return empty tables."""
    db_size = db_path.stat().st_size
    user_file_items = sorted(user_files_dir.iterdir()) if user_files_dir.is_dir() else []
    user_files_size = sum(item.stat().st_size for item in user_file_items if item.is_file())
    lines = [
        "# Stress dataset import report",
        "",
        f"- Data anchor: {now_anchor.isoformat()} (fixed anchor, not the real run time)",
        f"- Database: `{db_path}`, size {db_size / 1024 / 1024:.1f} MB",
        f"- User file copies: `{user_files_dir}`, {len(user_file_items)} files,"
        f" {user_files_size / 1024 / 1024:.1f} MB total",
        f"- Import duration: {elapsed:.1f} seconds",
        "",
        "| Table | Rows |",
        "| --- | ---: |",
    ]
    for name in sorted(counts):
        lines.append(f"| {name} | {counts[name]} |")
    empty_tables = [name for name, count in counts.items() if count == 0]
    lines.append("")
    lines.append(f"{len(counts)} tables total; empty tables: {empty_tables or 'none'}.")
    report_path = out_dir / REPORT_FILENAME
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return empty_tables


def format_summary(counts: dict[str, int], extra: dict[str, Any]) -> list[str]:
    """Human-readable summary lines shared by CLI output paths."""
    total_rows = sum(counts.values())
    lines = [
        f"tables={len(counts)} rows={total_rows}",
        *(f"{key}={value}" for key, value in extra.items()),
    ]
    return lines

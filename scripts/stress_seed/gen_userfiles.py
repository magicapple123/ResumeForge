"""User-file generator: physical copies plus matching ``user_file`` rows.

Each file is written once, hashed, and registered with the exact ``disk_name``
it was written under, so the physical directory and the database references
stay consistent by construction. The directory lives inside the run directory
(``<run>/user_files``), mirroring the app's own "database sibling directory"
convention for file-backed SQLite databases.
"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta

from .blobs import make_docx_bytes, make_pdf_bytes, make_png_bytes
from .context import SeedContext, row
from .vocab import PLACEHOLDER_PARA


def register_user_file(
    ctx: SeedContext,
    rows: list[dict],
    original_name: str,
    mime: str,
    payload: bytes,
    source_type: str,
) -> None:
    """Write one physical copy and append the matching insert row."""
    sha = hashlib.sha256(payload).hexdigest()
    disk_name = f"{sha[:16]}-{original_name}"[:160]
    (ctx.user_files_dir / disk_name).write_bytes(payload)
    rows.append(
        row(
            sha256=sha,
            disk_name=disk_name,
            original_name=original_name,
            mime=mime,
            size=len(payload),
            source_type=source_type,
            source_ref=f"{source_type}:{len(rows) + 1}",
            sources_json=json.dumps([{"source_type": source_type, "source_ref": source_type}]),
            created_at=ctx.now - timedelta(hours=len(rows)),
        )
    )


def seed_user_files(ctx: SeedContext) -> None:
    """Generate the physical file corpus and the ``user_file`` table rows."""
    rng = ctx.rng
    user_file_rows: list[dict] = []

    for i in range(ctx.counts.user_file_png):
        target = int(rng.uniform(0.3 * 1024 * 1024, 2.0 * 1024 * 1024))
        register_user_file(
            ctx,
            user_file_rows,
            f"压力测试截图-{i + 1}.png",
            "image/png",
            make_png_bytes(rng, target),
            ("material", "photo", "job_note", "candidate_image")[i % 4],
        )
    for i in range(ctx.counts.user_file_pdf):
        register_user_file(
            ctx,
            user_file_rows,
            f"压力测试文档-{i + 1}.pdf",
            "application/pdf",
            make_pdf_bytes(
                rng, f"ResumeForge stress placeholder {i + 1}", pad_kb=rng.uniform(30, 120)
            ),
            "material",
        )
    for i in range(ctx.counts.user_file_docx):
        register_user_file(
            ctx,
            user_file_rows,
            f"压力测试简历-{i + 1}.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            make_docx_bytes(200 + i * 10),
            "material",
        )
    for i in range(ctx.counts.user_file_md):
        register_user_file(
            ctx,
            user_file_rows,
            f"压力测试笔记-{i + 1}.md",
            "text/markdown",
            (
                "\n\n".join(
                    f"# 虚构笔记 {i + 1}-{k}\n\n{PLACEHOLDER_PARA.format(n=k)}" for k in range(30)
                )
            ).encode(),
            "chat_attachment" if i % 2 else "material",
        )
    for i in range(ctx.counts.user_file_txt):
        register_user_file(
            ctx,
            user_file_rows,
            f"压力测试记录-{i + 1}.txt",
            "text/plain",
            (
                "\n".join(
                    f"虚构记录行 {i + 1}-{k} {PLACEHOLDER_PARA.format(n=k)}" for k in range(200)
                )
            ).encode(),
            "job_note" if i % 2 else "chat_attachment",
        )

    ctx.insert("user_file", user_file_rows)

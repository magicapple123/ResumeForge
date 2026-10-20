# SPDX-License-Identifier: Apache-2.0
"""Resume-domain generator: resume records, generate tasks, delivery records,
templates and share packages."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta

from .context import SeedContext, row
from .vocab import RESUME_SUMMARIES, TEMPLATE_NAMES, TITLES


def make_resume_content(ctx: SeedContext, index: int) -> dict:
    data = json.loads(json.dumps(ctx.base_resume_content, ensure_ascii=False))
    data["job_intent"] = TITLES[index % len(TITLES)]
    data["summary"] = RESUME_SUMMARIES[index % len(RESUME_SUMMARIES)]
    return data


def seed_resumes(ctx: SeedContext, job_rows: list[dict]) -> tuple[list[dict], dict[int, dict]]:
    """Insert resume records; return (rows, contents-by-id) for later domains."""
    now = ctx.now
    count = ctx.counts.resume
    resume_rows: list[dict] = []
    resume_contents: dict[int, dict] = {}
    for i in range(count):
        job = job_rows[i % len(job_rows)]
        content = make_resume_content(ctx, i)
        resume_contents[i + 1] = content
        parent = i + 1 - 50 if (i >= 50 and i % 12 == 0) else None
        resume_rows.append(
            row(
                id=i + 1,
                title=f"{job['title']} - {job['company']}（第{i + 1}版）",
                job_id=job["id"],
                job_title=job["title"],
                company=job["company"],
                content=content,
                warnings=[],
                source="manual" if i % 5 == 0 else "ai",
                favorite=i % 9 == 0,
                model="" if i % 5 == 0 else "deepseek-v4-flash",
                tone="standard",
                enhancement_enabled=i % 3 == 0,
                enhancement_level="strong" if i % 3 == 0 else "balanced",
                template=TEMPLATE_NAMES[i % len(TEMPLATE_NAMES)],
                format_name="standard" if i % 4 == 0 else "",
                format_config={"accent": "#16365c"} if i % 4 == 0 else {},
                page_limit=1 if i % 2 == 0 else 2,
                font_scale="standard",
                custom_instruction="突出量化结果" if i % 6 == 0 else "",
                note="压力测试虚构简历" if i % 11 == 0 else "",
                parse_error="",
                coverage_notes=[],
                fact_annotations=[],
                rationale="",
                created_at=now - timedelta(hours=i),
                deleted_at=now - timedelta(days=i % 21) if i % 21 == 3 else None,
                parent_revision_id=parent,
            )
        )
    ctx.insert("resume_record", resume_rows, chunk=100)
    return resume_rows, resume_contents


GENERATE_STATUSES_ALL = ("pending", "running", "completed", "cancelled", "failed")


def seed_generate_tasks(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> None:
    now = ctx.now
    count = ctx.counts.resume_generate_task
    ctx.insert(
        "resume_generate_task",
        [
            row(
                id=i + 1,
                status=GENERATE_STATUSES_ALL[i % len(GENERATE_STATUSES_ALL)],
                resume_id=(i % len(resume_rows)) + 1 if i % 5 == 2 else None,
                error="模型输出超时" if i % 5 == 4 else "",
                message="已完成" if i % 5 == 2 else ("正在生成" if i % 5 == 1 else ""),
                received_chars=ctx.rng.randint(0, 12000),
                job_id=(i % len(job_rows)) + 1,
                title=f"{TITLES[i % len(TITLES)]} 简历生成任务 #{i + 1}",
                options={"tone": "standard", "page_limit": 1},
                created_at=now - timedelta(hours=i * 4),
                started_at=now - timedelta(hours=i * 4) + timedelta(minutes=1)
                if i % 5 != 0
                else None,
                finished_at=now - timedelta(hours=i * 4) + timedelta(minutes=3)
                if i % 5 in (2, 3, 4)
                else None,
            )
            for i in range(count)
        ],
    )


DELIVERY_SOURCES_ALL = ("apply", "track", "export")


def seed_deliveries(
    ctx: SeedContext,
    job_rows: list[dict],
    resume_rows: list[dict],
    resume_contents: dict[int, dict],
) -> None:
    now = ctx.now
    count = ctx.counts.resume_delivery_record
    track_total = ctx.counts.application_track
    delivery_rows: list[dict] = []
    for i in range(count):
        source = DELIVERY_SOURCES_ALL[i % 3]
        resume = resume_rows[i % len(resume_rows)]
        job = job_rows[(i * 7) % len(job_rows)]
        content = resume_contents[(i % len(resume_rows)) + 1]
        is_export = source == "export"
        content_sha = hashlib.sha256(
            json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        render_ctx = {
            "template": resume["template"],
            "template_html": "",
            "style_config": {},
            "format_config": resume["format_config"],
            "page_limit": resume["page_limit"],
            "font_scale": resume["font_scale"],
        }
        delivery_rows.append(
            row(
                resume_id=resume["id"],
                job_id=job["id"],
                track_id=((i * 11) % track_total) + 1 if source != "export" else None,
                source=source,
                resume_title=resume["title"],
                job_title=job["title"],
                company=job["company"],
                content=content,
                render_context=render_ctx,
                content_sha256=content_sha,
                rendered_config_sha256=hashlib.sha256(
                    json.dumps(render_ctx, ensure_ascii=False, sort_keys=True).encode("utf-8")
                ).hexdigest(),
                export_format=("docx" if i % 2 else "html") if is_export else "",
                filename=f"{job['title']}-压力测试-{i + 1}." + ("docx" if i % 2 else "html")
                if is_export
                else "",
                pages=ctx.rng.randint(1, 2) if is_export else None,
                model="deepseek-v4-flash",
                created_at=now - timedelta(hours=int(i * 1.5)),
            )
        )
    ctx.insert("resume_delivery_record", delivery_rows, chunk=100)


def seed_resume_templates(ctx: SeedContext) -> None:
    now = ctx.now
    ctx.insert(
        "resume_template",
        [
            row(
                name=f"虚构样式模板（{i + 1}）",
                kind="style",
                description="压力测试虚构模板",
                html="<div class='resume'>{{ summary }}</div>",
                config={},
                source_name=f"template-{i + 1}.html",
                enabled=True,
                created_at=now - timedelta(days=i * 5),
                updated_at=now - timedelta(days=i * 5),
            )
            for i in range(2)
        ]
        + [
            row(
                name=f"虚构版式模板（{i + 1}）",
                kind="format",
                description="压力测试虚构版式",
                html="",
                config={"font_base": 14, "margin": 18},
                source_name="",
                enabled=True,
                created_at=now - timedelta(days=i * 5),
                updated_at=now - timedelta(days=i * 5),
            )
            for i in range(2)
        ],
    )


def seed_share_packages(
    ctx: SeedContext,
    job_rows: list[dict],
    resume_rows: list[dict],
    resume_contents: dict[int, dict],
) -> None:
    now = ctx.now
    ctx.insert(
        "share_package",
        [
            row(
                title=f"虚构分享包（{i + 1}）",
                resume_id=(i % len(resume_rows)) + 1,
                job_id=(i % len(job_rows)) + 1,
                files=[
                    {
                        "name": f"share-{i + 1}.html",
                        "path": f"runtime/stress/share-{i + 1}.html",
                        "format": "html",
                        "size": 20480,
                        "sha256": hashlib.sha256(f"share-{i + 1}".encode()).hexdigest(),
                    }
                ],
                permission=("read_only", "comment")[i % 2],
                snapshot=resume_contents[(i % len(resume_rows)) + 1],
                comments_file="",
                share_token=f"SP-STRESS-{i + 1:08d}",
                redaction_config={"redact_phone": True},
                created_at=now - timedelta(days=i),
                updated_at=now - timedelta(days=i),
                deleted_at=now - timedelta(days=i % 13) if i % 24 == 2 else None,
            )
            for i in range(12)
        ],
    )

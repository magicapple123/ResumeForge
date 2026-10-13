"""Job-domain generator: jobs, candidate jobs, match analyses and batches."""

from __future__ import annotations

from datetime import timedelta

from .context import SeedContext, date_str, row
from .vocab import (
    CITY_AREAS,
    COMPANIES,
    JD_AREAS,
    JD_DUTY_BLOCKS,
    JD_MAJORS,
    JD_REQ_BLOCKS,
    JOB_SOURCES,
    JOB_STATUSES,
    JOB_TYPES,
    SALARIES,
    SKILL_TAG_POOL,
    TITLES,
    long_text,
    recognition_source_of,
)


def job_description(long_mode: bool, index: int) -> str:
    area = JD_AREAS[index % len(JD_AREAS)]
    if long_mode:
        return long_text(JD_DUTY_BLOCKS, JD_AREAS, target_kb=10.5)
    return "\n".join(
        JD_DUTY_BLOCKS[i % len(JD_DUTY_BLOCKS)].format(area=area, n=i) for i in range(4)
    )


def job_requirements(index: int) -> str:
    area = JD_AREAS[index % len(JD_AREAS)]
    major = JD_MAJORS[index % len(JD_MAJORS)]
    years = ["1", "2", "3", "5"][index % 4]
    return "\n".join(block.format(area=area, major=major, years=years) for block in JD_REQ_BLOCKS)


def seed_jobs(ctx: SeedContext) -> list[dict]:
    """Insert the job table; return the row list (downstream domains index it)."""
    now = ctx.now
    count = ctx.counts.job
    rows: list[dict] = []
    for i in range(count):
        source = JOB_SOURCES[i % len(JOB_SOURCES)]
        job_type = JOB_TYPES[i % len(JOB_TYPES)]
        # Status distribution: ~50% open / 40% closed / 10% applied.
        if i % 10 < 5:
            status = JOB_STATUSES[0]
        elif i % 10 < 9:
            status = JOB_STATUSES[1]
        else:
            status = JOB_STATUSES[2]
        created_at = now - timedelta(hours=i * 2)
        rows.append(
            row(
                id=i + 1,
                title=TITLES[i % len(TITLES)],
                company=COMPANIES[i % len(COMPANIES)],
                location=CITY_AREAS[i % len(CITY_AREAS)],
                salary=SALARIES[i % len(SALARIES)],
                job_type=job_type,
                description=job_description(i < min(20, count), i),
                requirements=job_requirements(i),
                additional_info="五险一金、弹性上班、年度体检" if i % 3 == 0 else "",
                keywords=[SKILL_TAG_POOL[(i + k) % len(SKILL_TAG_POOL)] for k in range(3)],
                source=source,
                source_url=""
                if source in {"手动录入", "招聘网站"}
                else f"https://www.example.com/job/stress{i + 1}",
                posted_at=date_str(created_at - timedelta(days=3)),
                status=status,
                note="压力测试虚构岗位" if i % 9 == 0 else "",
                note_images=[],
                favorite=i % 7 == 0,
                recognition_source=recognition_source_of(source),
                origin_source=source,
                created_at=created_at,
                updated_at=created_at,
                deleted_at=now - timedelta(days=i % 29) if i % 16 == 5 else None,
            )
        )
    ctx.insert("job", rows, chunk=250)
    return rows


def seed_candidate_jobs(ctx: SeedContext, job_rows: list[dict]) -> None:
    now = ctx.now
    count = ctx.counts.candidate_job
    ctx.insert(
        "candidate_job",
        [
            row(
                id=i + 1,
                title=TITLES[(i * 3) % len(TITLES)],
                company=COMPANIES[(i * 7) % len(COMPANIES)],
                raw_text=(
                    f"{TITLES[(i * 3) % len(TITLES)]} / "
                    f"{COMPANIES[(i * 7) % len(COMPANIES)]} / 上海 / 13-18K"
                ),
                images=[],
                note="招聘信息截图待核对" if i % 5 == 0 else "",
                source="manual" if i % 4 else "collect",
                job_type=JOB_TYPES[i % len(JOB_TYPES)],
                location=CITY_AREAS[i % len(CITY_AREAS)].split("·")[0],
                salary=SALARIES[i % len(SALARIES)],
                source_url="",
                description="",
                requirements="",
                additional_info="",
                collect_task_id=None,
                status="imported" if i % 3 == 0 else "pending",
                imported_job_id=(i % len(job_rows)) + 1 if i % 3 == 0 else None,
                created_at=now - timedelta(hours=i * 3),
                updated_at=now - timedelta(hours=i * 3),
            )
            for i in range(count)
        ],
    )


# result must validate against schemas/job_match.py JobMatchResult (extra=forbid),
# otherwise GET /api/jobs/{id}/match-analysis 500s during serialization.
MATCH_STATUSES_ALL = (
    "matched",
    "expression_gap",
    "evidence_insufficient",
    "real_gap",
    "to_confirm",
)
ADMISSION_BY_STATUS = {
    "matched": "allow",
    "expression_gap": "allow",
    "evidence_insufficient": "needs_confirm",
    "real_gap": "block",
    "to_confirm": "needs_confirm",
}


def match_result(index: int) -> dict:
    status = MATCH_STATUSES_ALL[index % len(MATCH_STATUSES_ALL)]
    hard_gate = (
        "met"
        if status in ("matched", "expression_gap")
        else ("unmet" if status == "real_gap" else "unknown")
    )
    condition = {
        "label": "本科及以上",
        "jd_quote": "本科及以上学历，统计学相关专业优先",
        "status": status,
        "evidence": "示例大学 本科（虚构）" if status != "real_gap" else "资料中未提供",
    }
    return {
        "hard_conditions": [condition],
        "core_abilities": [
            {
                "label": "SQL 与数据分析",
                "jd_quote": "熟练使用 SQL 与 Excel",
                "status": "matched" if status != "real_gap" else "expression_gap",
                "evidence": "技能：SQL（熟练）",
            }
        ],
        "bonus_items": [],
        "hard_gate": hard_gate,
        "admission": ADMISSION_BY_STATUS[status],
        "advice": "压力测试虚构建议：补充量化结果并核对口径。",
        "notes": [],
    }


def seed_match_analysis(ctx: SeedContext, job_rows: list[dict]) -> None:
    now = ctx.now
    total = min(400, len(job_rows))
    ctx.insert(
        "job_match_analysis",
        [
            row(
                id=i + 1,
                job_id=i + 1,
                job_title=job_rows[i]["title"],
                company=job_rows[i]["company"],
                result=match_result(i),
                hard_gate=match_result(i)["hard_gate"],
                requires_confirm=i % 5 in (2, 3),
                model="deepseek-v4-flash",
                created_at=now - timedelta(hours=i * 5),
                updated_at=now - timedelta(hours=i * 5),
            )
            for i in range(total)
        ],
    )


def seed_match_batches(ctx: SeedContext, job_rows: list[dict]) -> None:
    now = ctx.now
    ctx.insert(
        "job_match_batch",
        [
            row(
                id=i + 1,
                requested_count=20,
                completed_count=18,
                failed_count=2,
                items=[
                    {
                        "job_id": (i * 20 + k) % len(job_rows) + 1,
                        "title": TITLES[k % len(TITLES)],
                        "company": COMPANIES[k % len(COMPANIES)],
                        "conclusion": MATCH_STATUSES_ALL[k % len(MATCH_STATUSES_ALL)],
                    }
                    for k in range(20)
                ],
                model="deepseek-v4-flash",
                created_at=now - timedelta(days=i * 2),
                updated_at=now - timedelta(days=i * 2),
            )
            for i in range(6)
        ],
    )

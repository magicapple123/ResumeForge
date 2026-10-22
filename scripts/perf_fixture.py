# SPDX-License-Identifier: Apache-2.0
"""fixture 构造：从被测库取搜索词，用真实 Alembic head 建库并灌虚构数据。

搬迁自 ``scripts/measure_api_perf.py`` 第 451–478 行（``derive_search_terms``）与第
480–723 行（9 个 ``_make_*``/``_jd_text``/``_commit_in_batches`` + ``build_fixture_database``）。
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from sqlalchemy import text


def derive_search_terms(engine: Any) -> dict[str, str]:
    """从被测库现取搜索词：知识库取第一条标题，岗位取第一条标题。

    保证搜索端点真的命中数据（测一个必然空结果的词没有意义）。词太短
    （<3 字符）时 FTS 会回退 LIKE，这里优先取内容里的长词兜底。
    """
    from sqlalchemy import text

    terms: dict[str, str] = {}
    with engine.connect() as conn:
        knowledge_row = conn.execute(
            text("SELECT title, content FROM knowledge_entry WHERE deleted_at IS NULL LIMIT 1")
        ).first()
        if knowledge_row:
            term = (knowledge_row[0] or "").strip()
            if len(term) < 3:
                term = (knowledge_row[1] or "").strip()[:12]
            if len(term) >= 3:
                terms["knowledge"] = term
        job_row = conn.execute(
            text("SELECT title FROM job WHERE deleted_at IS NULL LIMIT 1")
        ).first()
        if job_row:
            term = (job_row[0] or "").strip()
            if len(term) >= 3:
                terms["job"] = term
    return terms


# ---------------------------------------------------------------------------
# Fixture 构造：真实 Alembic head 建库 + ORM 灌数据。内容字段按真实使用
# 长度造（JD 数千字符、备注数百字符），全部为虚构数据。
# ---------------------------------------------------------------------------
_COMPANIES = ["星河科技", "云帆网络", "深蓝智能", "远航数据", "临港软件", "青崖信息"]
_CITIES = ["上海", "北京", "深圳", "杭州", "成都", "武汉"]
_TITLES = ["后端开发工程师", "前端开发工程师", "测试开发工程师", "数据分析师", "算法工程师"]
_JOB_TYPES = ["校招", "社招", "实习"]


def _jd_text(index: int) -> str:
    """一段约 2000 字的虚构 JD 正文，模拟真实岗位描述的体量。"""
    paragraphs = []
    for section in range(5):
        lines = [f"第{index}号岗位职责段落{section}：负责平台第{section}模块的设计与实现。"]
        for i in range(10):
            lines.append(
                f"条目{i}：参与需求评审、技术方案设计与代码评审，跟进线上问题排查与"
                f"性能优化，与产品、测试协作保障迭代质量；编写单元测试与接口文档，"
                f"沉淀团队技术资产（fixture-{index}-{section}-{i}）。"
            )
        paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs)


def _commit_in_batches(session: Any, rows: list[Any], batch: int = 500) -> None:
    """分批 flush 避免一次性占用过多内存。"""
    pending: list[Any] = []
    for row in rows:
        pending.append(row)
        if len(pending) >= batch:
            session.add_all(pending)
            session.commit()
            pending = []
    if pending:
        session.add_all(pending)
        session.commit()


def _make_jobs(count: int) -> list[Any]:
    from app.models.job import Job

    return [
        Job(
            title=f"{_TITLES[i % len(_TITLES)]}（fixture{i}）",
            company=_COMPANIES[i % len(_COMPANIES)],
            location=_CITIES[i % len(_CITIES)],
            salary=f"20-{30 + i % 10}k·{(i % 14) + 1}薪",
            job_type=_JOB_TYPES[i % len(_JOB_TYPES)],
            description=_jd_text(i),
            requirements="本科及以上学历，计算机相关专业；熟悉常用数据结构与算法；"
            "有扎实的编程功底与良好的协作沟通能力。",
            additional_info="五险一金、弹性工作、年度体检、免费三餐。",
            keywords=[{"name": "Python", "category": "编程语言"}],
            source="手动添加",
            status="开放中" if i % 5 else "已投递",
            note=f"备注：第{i}条岗位的沟通记录（约 200 字）" * 6,
            favorite=i % 17 == 0,
        )
        for i in range(count)
    ]


def _make_resumes(count: int, job_ids: list[int]) -> list[Any]:
    from app.models.resume import ResumeRecord

    content_template = {
        "basics": {"name": "测试用户", "email": "fixture@example.com", "phone": "13800000000"},
        "education": [{"school": "示例大学", "major": "计算机科学与技术", "degree": "本科"}],
        "experience": [
            {
                "company": _COMPANIES[i % len(_COMPANIES)],
                "role": "实习生",
                "highlights": [f"负责模块{i % 8}的开发与优化，交付了{i % 5}个需求。"],
            }
            for i in range(4)
        ],
        "skills": [{"name": "Python", "level": "熟练"}, {"name": "SQL", "level": "熟练"}],
    }
    return [
        ResumeRecord(
            title=f"测试简历-{i}",
            job_id=job_ids[i % len(job_ids)] if job_ids else None,
            job_title=_TITLES[i % len(_TITLES)],
            company=_COMPANIES[i % len(_COMPANIES)],
            content=content_template,
            source="ai" if i % 2 else "manual",
            model="fixture-model" if i % 2 else "",
            note=f"第{i}份简历的备注",
        )
        for i in range(count)
    ]


def _make_tracks(count: int, job_ids: list[int]) -> list[Any]:
    from app.models.tracker import (
        STATUS_APPLIED,
        STATUS_ASSESSMENT,
        STATUS_INTERVIEW,
        STATUS_OFFER,
        STATUS_REJECTED,
        STATUS_SCREENING,
        ApplicationTrack,
        normalize_key,
    )

    statuses = [
        STATUS_APPLIED,
        STATUS_SCREENING,
        STATUS_ASSESSMENT,
        STATUS_INTERVIEW,
        STATUS_OFFER,
        STATUS_REJECTED,
    ]
    rows = []
    for i in range(count):
        company = _COMPANIES[i % len(_COMPANIES)]
        title = f"{_TITLES[i % len(_TITLES)]}（进度{i}）"
        rows.append(
            ApplicationTrack(
                company=company,
                title=title,
                company_key=normalize_key(company),
                title_key=normalize_key(title),
                status=statuses[i % len(statuses)],
                stage_note="一面" if i % 3 == 0 else "",
                applied_at=f"2026-09-{(i % 28) + 1:02d}",
                status_date=f"2026-10-{(i % 8) + 1:02d}",
                next_action="等待面试反馈",
                note=f"第{i}条进度记录备注" * 5,
                evidence=f"来自第{i}封通知的摘录",
                job_id=job_ids[i % len(job_ids)] if job_ids else None,
            )
        )
    return rows


def _make_candidates(count: int) -> list[Any]:
    from app.models.material import CandidateJob

    return [
        CandidateJob(
            title=f"候选岗位-{i}",
            company=_COMPANIES[i % len(_COMPANIES)],
            raw_text=_jd_text(i)[:1500],
            note=f"候选备注{i}",
            status="pending" if i % 4 else "imported",
            location=_CITIES[i % len(_CITIES)],
            salary=f"{15 + i % 10}k-{25 + i % 10}k",
            description=_jd_text(i),
        )
        for i in range(count)
    ]


def _make_knowledge(count: int) -> list[Any]:
    from app.models.knowledge_entry import KnowledgeEntry

    return [
        KnowledgeEntry(
            title=f"知识条目-{i}",
            category=["面经", "技术笔记", "求职心得"][i % 3],
            tags=[f"标签{i % 7}", "fixture"],
            content=("这是一条用于性能测量的虚构知识库正文。" * 40) + f"（编号{i}）",
            source="手动录入",
        )
        for i in range(count)
    ]


def _make_home_stats_rows(job_ids: list[int]) -> list[Any]:
    from app.models.apply import ApplyQueueItem
    from app.models.claim import ClaimRecord

    rows: list[Any] = []
    for i in range(20):
        company = _COMPANIES[i % len(_COMPANIES)]
        rows.append(
            ClaimRecord(
                title=f"虚构事实条目{i}",
                subject=company,
                source_fact=f"在{company}负责模块设计与实现（fixture 第{i}条）。",
                verification_status="pending",
            )
        )
    rows.extend(
        ApplyQueueItem(
            job_id=job_ids[i % len(job_ids)] if job_ids else None,
            job_title=_TITLES[i % len(_TITLES)],
            company=_COMPANIES[i % len(_COMPANIES)],
            status="pending",
        )
        for i in range(10)
    )
    return rows


def build_fixture_database(db_path: Path, counts: dict[str, int]) -> dict[str, Any]:
    """用真实 Alembic head 建库并灌入虚构数据；返回 schema/引擎信息。

    专用引擎由 stress_seed.schema.create_engine_for 创建并钉住绑定路径；
    app.database 的引擎（TestClient 用的那个）指向同一个文件，导入后另作
    绑定断言。
    """
    if db_path.exists():
        raise SystemExit(f"fixture 库已存在，请先删除或换 --db 路径：{db_path}")
    db_path.parent.mkdir(parents=True, exist_ok=True)

    from sqlalchemy.orm import sessionmaker
    from stress_seed import schema as stress_schema

    stress_schema.prepare_environment(db_path)
    # 注册全部模型（只导入，不建表——建表交给 Alembic）。
    tables, _ = stress_schema.load_app_metadata()
    engine = stress_schema.create_engine_for(db_path)
    try:
        schema_head = stress_schema.init_schema(engine)
        session = sessionmaker(bind=engine)()
        try:
            started = time.perf_counter()
            _commit_in_batches(session, _make_jobs(counts["jobs"]))
            job_ids = [row[0] for row in session.execute(text("SELECT id FROM job")).all()]
            _commit_in_batches(session, _make_resumes(counts["resumes"], job_ids))
            _commit_in_batches(session, _make_tracks(counts["tracks"], job_ids))
            _commit_in_batches(session, _make_candidates(counts["candidates"]))
            _commit_in_batches(session, _make_knowledge(counts["knowledge"]))
            _commit_in_batches(session, _make_home_stats_rows(job_ids))
            elapsed = time.perf_counter() - started
        finally:
            session.close()
    except Exception:
        engine.dispose()
        raise
    print(
        f"[fixture] 岗位 {counts['jobs']} / 简历 {counts['resumes']} / 进度 {counts['tracks']} / "
        f"候选 {counts['candidates']} / 知识 {counts['knowledge']}，"
        f"灌库耗时 {elapsed:.1f}s，schema head {schema_head}"
    )
    return {
        "engine": engine,
        "schema_head": schema_head,
        "tables": sorted(tables),
        "counts": dict(counts),
    }

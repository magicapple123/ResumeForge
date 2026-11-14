# SPDX-License-Identifier: Apache-2.0
"""备选岗位：还没核对的招聘信息暂存与导入标记。

这里只做暂存；真正的岗位创建仍走 ``job_service``（同一套字段校验与技能标签解析），
避免两条写入路径行为漂移。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Query, Session

from ..models.material import (
    CANDIDATE_JOB_IMPORTED,
    CANDIDATE_JOB_PENDING,
    CANDIDATE_JOB_STATUSES,
    CandidateJob,
)
from ..schemas.material import CandidateJobCreate, CandidateJobUpdate
from .candidate_jobs_import import (
    RECOGNITION_SOURCE_COLLECT,
    RECOGNITION_SOURCE_MANUAL,
    import_candidates,
)
from .job.job_service import find_by_job_identity
from .trash import get_live, live_only, soft_delete

logger = logging.getLogger(__name__)

MAX_CANDIDATE_TOOL_CHARS = 6_000

# 列表默认返回多少条。候选是一份**待处理清单**，页面不会翻页；给一个上限是为了让
# 长期累积的历史候选不会把每次列表请求都拖成一个大响应。
MAX_CANDIDATE_LIST = 300



def _filtered_query(
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    collect_task_id: int | None = None,
    collect_task_ids: list[int] | None = None,
) -> Query[CandidateJob]:
    """list_candidate_jobs 与 list_candidate_jobs_page **共用的过滤口径**。

    两处各写一遍过滤条件，迟早会改漏一边（与 tracker._filtered_query 同一取舍）。

    ``deleted_at IS NULL`` 也写在这里：0050 起备选岗位是软删除的，漏掉这一句的后果是
    "删了还在列表里"（用户以为删除失败）——而这条路径有三个入口（列表 / 分页 / 全选
    id），四处各写一遍必然漂移，所以收在唯一一处。
    """
    query = db.query(CandidateJob).filter(live_only(CandidateJob))
    if status in CANDIDATE_JOB_STATUSES:
        query = query.filter(CandidateJob.status == status)
    if collect_task_ids:
        query = query.filter(CandidateJob.collect_task_id.in_(collect_task_ids))
    elif collect_task_id is not None:
        # 「本次采集结果」按批次过滤：采完立刻能看到"这次采到了什么"，而不必在累积的
        # 全部候选里翻找。
        query = query.filter(CandidateJob.collect_task_id == collect_task_id)
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        query = query.filter(
            CandidateJob.title.like(like)
            | CandidateJob.company.like(like)
            | CandidateJob.raw_text.like(like)
            | CandidateJob.description.like(like)
            | CandidateJob.note.like(like)
        )
    return query


def list_candidate_jobs(
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    collect_task_id: int | None = None,
    collect_task_ids: list[int] | None = None,
    limit: int = MAX_CANDIDATE_LIST,
) -> list[CandidateJob]:
    """按状态/采集批次/关键词分页列出备选岗位。"""
    return (
        _filtered_query(
            db,
            status=status,
            keyword=keyword,
            collect_task_id=collect_task_id,
            collect_task_ids=collect_task_ids,
        )
        .order_by(CandidateJob.created_at.desc(), CandidateJob.id.desc())
        .limit(max(1, limit))
        .all()
    )


def list_candidate_jobs_page(
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    collect_task_id: int | None = None,
    collect_task_ids: list[int] | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[CandidateJob], int]:
    """分页列出备选岗位（RF-08）：过滤与排序与 :func:`list_candidate_jobs` 完全一致。

    与旧列表的分工：旧端点给 MAX_CANDIDATE_LIST 兜底上限（待处理清单不翻页），本函数
    服务 ``GET /api/candidate-jobs/page``——历史候选超过 300 条之后仍然全部可达。
    """
    query = _filtered_query(
        db,
        status=status,
        keyword=keyword,
        collect_task_id=collect_task_id,
        collect_task_ids=collect_task_ids,
    )
    total = query.count()
    rows = (
        query.order_by(CandidateJob.created_at.desc(), CandidateJob.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def candidate_or_none(db: Session, candidate_id: int) -> CandidateJob | None:
    """按 id 取一条**未删除**的候选；已在回收站里的当作不存在（返回 None）。

    不用 ``db.get``：它会绕过查询过滤，等于给"单条读取 / 修改 / 标记已导入"开一个后门
    ——列表里看不到、但知道 id 就能继续编辑一条已删的候选。``trash.get_live`` 是这套
    语义的共用实现（与岗位、简历、投递记录同一份）。
    """
    return get_live(db, CandidateJob, candidate_id)


def create_candidate_job(db: Session, payload: CandidateJobCreate) -> CandidateJob:
    """暂存一条备选岗位（待导入）。"""
    candidate = CandidateJob(**payload.model_dump(), status=CANDIDATE_JOB_PENDING)
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    logger.info("已新增备选岗位 id=%s", candidate.id)
    return candidate


def update_candidate_job(
    db: Session, candidate: CandidateJob, payload: CandidateJobUpdate
) -> CandidateJob:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(candidate, field, value)
    db.commit()
    db.refresh(candidate)
    return candidate


def mark_candidate_imported(db: Session, candidate: CandidateJob, job_id: int) -> CandidateJob:
    """把备选岗位标记为已导入并记下正式岗位 id。"""
    candidate.status = CANDIDATE_JOB_IMPORTED
    candidate.imported_job_id = job_id
    db.commit()
    db.refresh(candidate)
    logger.info("备选岗位已导入 id=%s job_id=%s", int(candidate.id), int(job_id))
    return candidate


def delete_candidate_job(db: Session, candidate_id: int) -> bool:
    """软删一条备选岗位（移入回收站，可恢复）。

    与用户真正在乎的其它内容一样走 ``trash.soft_delete``：这条记录只是从列表里消失，
    回收站里能找回，彻底删除是另一个显式动作（``DELETE /api/trash/...``）。

    已在回收站里的候选按"不存在"处理（返回 False → 接口 404「不存在或已被删除」），
    与 ``DELETE /api/jobs/{id}`` 同一口径：重复删除不需要给出"又删了一次"这种伪成功。
    """
    candidate = get_live(db, CandidateJob, candidate_id)
    if candidate is None:
        return False
    soft_delete(db, "candidate_job", candidate)
    db.commit()
    return True


def stage_candidate_job(
    db: Session,
    *,
    title: str,
    company: str = "",
    location: str = "",
    salary: str = "",
    source_url: str = "",
    description: str = "",
    requirements: str = "",
    additional_info: str = "",
    source: str = "",
    task_id: int | None = None,
    job_type: str = "",
) -> CandidateJob:
    """把一条采集结果放进暂存区（等用户在投递台里挑选后再导入岗位广场）。

    **不 commit**：采集是一次批量写入，由调用方统一提交——逐条提交会让"采到一半被停止"
    留下一堆半成品，也让进度回填与数据落盘不同步。
    """
    candidate = CandidateJob(
        title=title,
        company=company,
        location=location,
        salary=salary,
        source_url=source_url,
        description=description,
        requirements=requirements,
        additional_info=additional_info,
        source=source,
        collect_task_id=task_id,
        job_type=job_type,
        status=CANDIDATE_JOB_PENDING,
    )
    db.add(candidate)
    db.flush()
    return candidate


def find_staged_candidate(
    db: Session, *, title: str = "", company: str = "", source_url: str = ""
) -> CandidateJob | None:
    """暂存区里是否已有同一个岗位（**与岗位广场那套判据共用同一份实现**）。

    不按 ``status`` 过滤：已经导入过的候选，它的正式岗位必然在 ``job`` 表里，
    调用方查岗位表那一遍就会命中，这里再筛一次状态只会让"重复"被漏判。

    **但按 ``deleted_at`` 过滤**（``skip_deleted=True``，0050 起备选岗位可进回收站）：
    与岗位广场那条"回收站里的也算已存在"**刻意相反**。用户在暂存区删掉一条候选，意思是
    "这条我不要了"，若它继续算已存在，采集就会一直跳过这条岗位——用户既看不到它（列表里
    没有），也采不回来，只能靠想起来去回收站恢复。删掉就该能重新采。
    """
    return find_by_job_identity(
        db,
        CandidateJob,
        title=title,
        company=company,
        source_url=source_url,
        skip_deleted=True,
    )


def candidate_brief(candidate: CandidateJob) -> dict:
    """备选岗位的列表摘要视图。"""
    return {
        "id": candidate.id,
        "岗位": candidate.title,
        "公司": candidate.company,
        "城市": candidate.location,
        "薪资": candidate.salary,
        "状态": "已导入" if candidate.status == CANDIDATE_JOB_IMPORTED else "待处理",
        "导入的岗位 id": candidate.imported_job_id,
        "来源": candidate.source,
        "岗位链接": candidate.source_url,
        "备注": candidate.note,
        "截图数量": len(candidate.images or []),
        "更新时间": candidate.updated_at.isoformat() if candidate.updated_at else None,
    }


def candidate_detail_text(
    candidate: CandidateJob, max_chars: int = MAX_CANDIDATE_TOOL_CHARS
) -> str:
    """备选岗位的详情文本（供助手读取）：采集来的 JD 两段与粘贴来的原文都要带上。"""
    parts = [
        f"岗位：{candidate.title or '（未填写）'}",
        f"公司：{candidate.company or '（未填写）'}",
        f"状态：{'已导入' if candidate.status == CANDIDATE_JOB_IMPORTED else '待处理'}",
    ]
    if candidate.location:
        parts.append(f"城市：{candidate.location}")
    if candidate.salary:
        parts.append(f"薪资：{candidate.salary}")
    if candidate.note:
        parts.append(f"备注：{candidate.note}")
    # 采集回来的候选把 JD 存在 description / requirements 两段里，粘贴来的候选存在 raw_text。
    # 两者都要读——只读 raw_text 会让助手对采集来的岗位"什么都看不到"。
    if candidate.description:
        parts.append(f"岗位描述：\n{candidate.description}")
    if candidate.requirements:
        parts.append(f"任职要求：\n{candidate.requirements}")
    if candidate.raw_text:
        parts.append(f"招聘原文：\n{candidate.raw_text}")
    if candidate.images:
        parts.append(f"附有 {len(candidate.images)} 张招聘截图（图片内容未提取）")
    text = "\n\n".join(parts)
    if len(text) > max_chars:
        text = f"{text[:max_chars].rstrip()}…"
    return text


__all__ = [
    "MAX_CANDIDATE_LIST",
    "MAX_CANDIDATE_TOOL_CHARS",
    "RECOGNITION_SOURCE_COLLECT",
    "RECOGNITION_SOURCE_MANUAL",
    "candidate_brief",
    "candidate_detail_text",
    "candidate_or_none",
    "create_candidate_job",
    "delete_candidate_job",
    "find_staged_candidate",
    "import_candidates",
    "list_candidate_jobs",
    "list_candidate_jobs_page",
    "mark_candidate_imported",
    "stage_candidate_job",
    "update_candidate_job",
]


def list_candidate_job_ids(
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    collect_task_id: int | None = None,
    collect_task_ids: list[int] | None = None,
) -> list[int]:
    """当前筛选下**全部**候选的 id（不分页）：抽屉「全选全部」用。

    与分页列表共用 ``_filtered_query``——"看到的筛选结果"和"一键全选拿到的 id"
    是对同一批候选的两种视图。
    """
    return [
        candidate_id
        for (candidate_id,) in _filtered_query(
            db,
            status=status,
            keyword=keyword,
            collect_task_id=collect_task_id,
            collect_task_ids=collect_task_ids,
        )
        .order_by(CandidateJob.created_at.desc(), CandidateJob.id.desc())
        .with_entities(CandidateJob.id)
        .all()
    ]

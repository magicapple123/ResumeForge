# SPDX-License-Identifier: Apache-2.0
"""备选岗位：还没核对的招聘信息暂存与导入标记。

这里只做暂存；真正的岗位创建仍走 ``job_service``（同一套字段校验与技能标签解析），
避免两条写入路径行为漂移。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Query, Session

from ..models.job import JOB_STATUS_OPEN
from ..models.material import (
    CANDIDATE_JOB_IMPORTED,
    CANDIDATE_JOB_PENDING,
    CANDIDATE_JOB_STATUSES,
    CandidateJob,
)
from ..schemas.job import RECOGNITION_SOURCE_OFFICIAL, JobCreate
from ..schemas.material import CandidateJobCreate, CandidateJobUpdate
from .job.job_service import create_job_record, find_by_job_identity, find_job_by_identity
from .job_parser.metadata import job_type_from_title
from .trash import get_live, is_deleted, live_only, soft_delete

logger = logging.getLogger(__name__)

MAX_CANDIDATE_TOOL_CHARS = 6_000

# 列表默认返回多少条。候选是一份**待处理清单**，页面不会翻页；给一个上限是为了让
# 长期累积的历史候选不会把每次列表请求都拖成一个大响应。
MAX_CANDIDATE_LIST = 300

# 导入正式岗位时写进 ``Job.recognition_source`` 的来源：采集来的与手动粘贴的分开标注，
# 用户日后回溯"这条是怎么进来的"才有意义。判据是**有没有采集批次**，而不是猜标题。
RECOGNITION_SOURCE_COLLECT = "岗位采集"
RECOGNITION_SOURCE_MANUAL = "备选岗位导入"


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


def import_candidates(db: Session, candidate_ids: list[int]) -> dict:
    """把选中的候选导入岗位广场：服务端建岗位并回填关联，**逐条如实反馈结果**。

    为什么由服务端建岗位而不是让前端逐条调保存接口：那样"导入 10 条"会变成 10 次网络往返，
    而且中途失败会留下"导入了一半"的状态；这里一次事务做完，任一条的失败都只影响它自己。

    重复判定复用 ``find_job_by_identity``（与采集去重同一份实现）。命中分两种：库里有的直接
    **指向已有岗位**；**在回收站里的**返回独立结果 ``trashed``——既不新建第二条（那是重复的
    来源），也不自动恢复（用户删它是有理由的），而是让界面告诉他去回收站处理。

    原话：
    而不是再造一条——用户勾错了不该在岗位广场里留下第二个副本。
    """
    imported = duplicate = missing = invalid = trashed = 0
    results: list[dict] = []
    # 去重且保序：同一个 id 传两次不该被导入两次。
    for candidate_id in dict.fromkeys(candidate_ids):
        # 已软删的候选按"不存在"处理：它在待办列表里本来就看不到，能导进来只会让用户
        # 莫名其妙地看到一条自己删过的岗位进了岗位广场。
        candidate = get_live(db, CandidateJob, candidate_id)
        if candidate is None:
            missing += 1
            results.append({"candidate_id": candidate_id, "title": "", "outcome": "missing"})
            continue

        existing = find_job_by_identity(
            db,
            title=candidate.title,
            company=candidate.company,
            source_url=candidate.source_url,
        )
        if existing is not None and is_deleted(existing):
            # 岗位广场的**回收站**里已经有一条同名岗位。
            #
            # 刻意**不**新建第二条（那正是重复的来源），也刻意**不**自动恢复它（用户删它是有
            # 理由的）。如实返回一个独立的结果，让界面告诉他去回收站处理。
            trashed += 1
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "trashed",
                    "job_id": existing.id,
                }
            )
            continue
        if existing is not None:
            duplicate += 1
            # 不用 ``mark_candidate_imported``：它自带 commit，逐条提交会让"导入到一半失败"
            # 留下一半已改、一半未改的库。这里只标字段，最后一次提交。
            candidate.status = CANDIDATE_JOB_IMPORTED
            candidate.imported_job_id = existing.id
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "duplicate",
                    "job_id": existing.id,
                }
            )
            continue

        if not candidate.title.strip():
            # 没有岗位名的候选没法成为一个正式岗位（``JobCreate`` 要求标题非空）。
            # 如实说"这条导不了"，而不是给一个空的标题硬塞进去。
            invalid += 1
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "invalid",
                }
            )
            continue

        job = create_job_record(
            db,
            JobCreate(
                title=candidate.title,
                company=candidate.company,
                location=candidate.location,
                salary=candidate.salary,
                # 岗位类型：标题推断最优先（采集卡片不带类型字段，「实习生」字样是
                # 最强证据，不能让默认值把实习岗标成校招）；推断不出再信采集任务
                # 的透传标注，最后回落「校招」。
                job_type=(job_type_from_title(candidate.title) or candidate.job_type or "校招"),
                source_url=candidate.source_url,
                # 采集回来的 JD 已经按小标题切成两段，直接各归各位；
                # 手动粘贴的候选没有这两段，退回用原文填描述（与以前的导入行为一致）。
                description=candidate.description or candidate.raw_text,
                requirements=candidate.requirements,
                additional_info=candidate.additional_info,
                note=candidate.note,
                status=JOB_STATUS_OPEN,
                recognition_source=(
                    RECOGNITION_SOURCE_COLLECT
                    if candidate.collect_task_id or candidate.source == RECOGNITION_SOURCE_OFFICIAL
                    else RECOGNITION_SOURCE_MANUAL
                ),
            ),
            # 把候选上的来源透传给岗位：采集导入的候选 source 是站点名（如「BOSS直聘」），
            # 与旧采集器直写 `job.source` 的口径一致；不传的话会落到模型默认值「手动添加」，
            # 让"手动添加 vs 自动采集"这件事基于错误数据。
            source=candidate.source,
        )
        candidate.status = CANDIDATE_JOB_IMPORTED
        candidate.imported_job_id = job.id
        imported += 1
        results.append(
            {
                "candidate_id": candidate.id,
                "title": candidate.title,
                "outcome": "imported",
                "job_id": job.id,
            }
        )

    db.commit()
    logger.info(
        "候选导入完成：新建 %s，重复 %s，在回收站里 %s，无效 %s，缺失 %s",
        imported,
        duplicate,
        trashed,
        invalid,
        missing,
    )
    return {
        "imported": imported,
        "duplicate": duplicate,
        "trashed": trashed,
        "invalid": invalid,
        "missing": missing,
        "results": results,
    }


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

# SPDX-License-Identifier: Apache-2.0
"""简历 CRUD 端点（域⑤）：手写保存、列表、读取、正文修改、重命名、备注、收藏与软删除。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_to_resume_out` 改从
``_shared`` 导入。
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.resume import ResumeRecord, saved_only
from ...schemas.common import Page
from ...schemas.resume import (
    ManualResumeRequest,
    ResumeBatchDeleteResult,
    ResumeBatchRequest,
    ResumeBrief,
    ResumeContent,
    ResumeContentSave,
    ResumeFavoriteUpdate,
    ResumeNoteUpdate,
    ResumeOut,
    ResumeTitleUpdate,
)
from ...services import trash
from ...services.resume.document_save import (
    RevisionConflict,
    revision_conflict_response,
    save_content,
)
from ...services.resume.manual_creation import (
    ProfileSnapshotStale,
    create_manual_resume_record,
    profile_snapshot_stale_response,
)
from ...services.resume.profile_usage import profile_usage_for_resume
from ._shared import _get_live_resume, _mark_saved, _to_resume_out, _validated_content

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/manual", response_model=ResumeOut, status_code=201)
def create_manual_resume(payload: ManualResumeRequest, db: Session = Depends(get_db)):
    """保存用户自行编写的简历，并可选关联岗位。

    创建流程与事务编排在 services/resume/manual_creation.py（F4 等价提取）；本端点只保留
    HTTP 编排：过期投影 token → 409 profile_snapshot_stale，其余沿用旧的提交/响应形状。
    """
    try:
        record = create_manual_resume_record(db, payload)
    except ProfileSnapshotStale:
        return profile_snapshot_stale_response()
    # 提交点保持在原处：快照行与简历行同事务落库（服务层不自行 commit）。
    db.commit()
    db.refresh(record)
    logger.info("用户手写简历已保存 record_id=%s job=%s", record.id, record.job_title)
    return _to_resume_out(record)


@router.post("/batch-delete", response_model=ResumeBatchDeleteResult)
def batch_delete_resumes(payload: ResumeBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除，P2-4）：单次上限 500，与岗位批量操作同一口径。

    语义对齐单条 ``DELETE /{resume_id}``：软删除进回收站可恢复；任何一条 id 不存在
    或已在回收站里即整体 404（与 ``/jobs/batch-delete`` 的 _get_jobs_or_404 一致），
    不做"删一半"。
    """
    records: list[ResumeRecord] = []
    for resume_id in payload.resume_ids:
        record = trash.get_live(db, ResumeRecord, resume_id)
        if record is None:
            raise HTTPException(
                status_code=404,
                detail=f"以下简历不存在或已被删除：{resume_id}",
            )
        records.append(record)
    for record in records:
        trash.soft_delete(db, "resume", record)
    db.commit()
    return ResumeBatchDeleteResult(deleted=len(records))


def _filtered_query(
    db: Session,
    *,
    keyword: str = "",
    job_id: int | None = None,
    favorite: bool | None = None,
    has_job: bool | None = None,
):
    """list_resumes 与 list_resume_ids **共用的过滤口径**。

    四个筛选参数（keyword/job_id/favorite/has_job）与旧 list_resumes 内联逻辑逐行
    同源：两处各写一遍迟早会改漏一边（``jobs`` 域的 ``_filtered_query`` 同一模式）。
    keyword 仍走标题/岗位/公司/正文 LIKE——content 是 JSON 文本（cast 后整段扫描），
    不适合 FTS 分词，与全局搜索的简历分支口径一致，保持不动。

    **一律排除草稿**（0051）：制作台草稿是"用户点进去看过、还没保存"的落脚点，
    出现在简历中心里等于凭空多出一份空白简历。
    """
    query = db.query(ResumeRecord).filter(trash.live_only(ResumeRecord), saved_only())
    if job_id is not None:
        query = query.filter(ResumeRecord.job_id == job_id)
    if has_job is not None:
        query = query.filter(
            ResumeRecord.job_id.is_not(None) if has_job else ResumeRecord.job_id.is_(None)
        )
    if favorite is not None:
        query = query.filter(ResumeRecord.favorite == favorite)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                ResumeRecord.title.like(like),
                ResumeRecord.job_title.like(like),
                ResumeRecord.company.like(like),
                cast(ResumeRecord.content, String).like(like),
            )
        )
    return query


# 列表排序的取值 → ORDER BY。默认「最近修改」：用户更常找"我刚改过的那份"，
# 而不是"最久以前生成的那份"。``coalesce`` 兜住 0047 之前的旧行（updated_at 为空时
# 用创建时间），迁移失败或历史库残留也不会把它们排到最后。
#
# T2：每个键都配一个反向键（列头三态排序需要"再点一次反向"）。两条硬约束：
# 1. 反向键的主排序与二级排序**方向全反**，但 collation 不变（拼音仍是拼音）；
# 2. 每个键都以 ``id`` 收尾，且方向与主排序一致——同一时刻创建的记录跨页时
#    才不会重复/漏行（分页稳定性）。company_*/job_title_* 原本没有末位 tie-breaker，
#    这次一并补上（纯增强，主排序口径未变）。
RESUME_SORT_ORDERS = {
    "updated_desc": (
        func.coalesce(ResumeRecord.updated_at, ResumeRecord.created_at).desc(),
        ResumeRecord.id.desc(),
    ),
    "updated_asc": (
        func.coalesce(ResumeRecord.updated_at, ResumeRecord.created_at).asc(),
        ResumeRecord.id.asc(),
    ),
    "created_desc": (ResumeRecord.created_at.desc(), ResumeRecord.id.desc()),
    "created_asc": (ResumeRecord.created_at.asc(), ResumeRecord.id.asc()),
    # 按标题排序时先按公司/岗位归类更有意义。中文按**拼音**、英文按字母、数字按大小
    # （`rf_pinyin`，见 services/text_sort.py）：SQLite 默认的 BINARY collation 会把
    # 所有 ASCII 标题排在中文之前，于是「UI 设计师」永远第一（2026-10 用户反馈）。
    "title_asc": (ResumeRecord.title.collate("rf_pinyin").asc(), ResumeRecord.id.asc()),
    "title_desc": (ResumeRecord.title.collate("rf_pinyin").desc(), ResumeRecord.id.desc()),
    "company_asc": (
        ResumeRecord.company.collate("rf_pinyin").asc(),
        ResumeRecord.title.collate("rf_pinyin").asc(),
        ResumeRecord.id.asc(),
    ),
    "company_desc": (
        ResumeRecord.company.collate("rf_pinyin").desc(),
        ResumeRecord.title.collate("rf_pinyin").desc(),
        ResumeRecord.id.desc(),
    ),
    "job_title_asc": (
        ResumeRecord.job_title.collate("rf_pinyin").asc(),
        ResumeRecord.title.collate("rf_pinyin").asc(),
        ResumeRecord.id.asc(),
    ),
    "job_title_desc": (
        ResumeRecord.job_title.collate("rf_pinyin").desc(),
        ResumeRecord.title.collate("rf_pinyin").desc(),
        ResumeRecord.id.desc(),
    ),
}


@router.get("", response_model=Page[ResumeBrief])
def list_resumes(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    job_id: int | None = Query(default=None, ge=1),
    favorite: bool | None = Query(default=None),
    has_job: bool | None = Query(default=None),
    sort: Literal[
        "updated_desc",
        "updated_asc",
        "created_desc",
        "created_asc",
        "title_asc",
        "title_desc",
        "company_asc",
        "company_desc",
        "job_title_asc",
        "job_title_desc",
    ] = Query(
        default="updated_desc",
        description="排序：最近修改 / 最近生成 / 标题 / 公司 / 岗位（各含升降序）",
    ),
):
    """列出简历。``has_job=false`` 只返回通用简历（未关联任何岗位）。"""
    query = _filtered_query(db, keyword=keyword, job_id=job_id, favorite=favorite, has_job=has_job)
    total = query.count()
    records = (
        query.order_by(*RESUME_SORT_ORDERS[sort])
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[ResumeBrief.model_validate(r) for r in records], total=total)


@router.get("/ids", response_model=list[int])
def list_resume_ids(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    job_id: int | None = Query(default=None, ge=1),
    favorite: bool | None = Query(default=None),
    has_job: bool | None = Query(default=None),
):
    """当前筛选下**全部**简历的 id（不分页）：批量选择「全选全部简历」用。

    与 ``GET /api/jobs/ids`` 同一模式：筛选参数与列表端点完全同源（共用
    :func:`_filtered_query`），id 列表本身很轻，把筛选逻辑交给前端分页拉取反而
    要多轮请求；批量操作 500 的上限由前端在拿到列表后裁决——这里如实返回全量。
    **声明在 ``/{resume_id}`` 之前**：字面量段必须排在参数段前面。
    """
    query = _filtered_query(db, keyword=keyword, job_id=job_id, favorite=favorite, has_job=has_job)
    return [
        resume_id
        for (resume_id,) in query.order_by(ResumeRecord.created_at.desc())
        .with_entities(ResumeRecord.id)
        .all()
    ]


@router.get("/{resume_id}", response_model=ResumeOut)
def get_resume(resume_id: int, db: Session = Depends(get_db)):
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    detail = _to_resume_out(record)
    # R-33 追溯元数据：只在详情端点补（列表不需要；独立 GET /profile-usage 还带过时判定）。
    detail.profile_usage = profile_usage_for_resume(db, record.id)
    return detail


@router.put("/{resume_id}", response_model=ResumeOut)
def update_resume(resume_id: int, payload: ResumeContent, db: Session = Depends(get_db)):
    """保存用户对生成简历的手工修改（**旧形状，一个字节都没变**）。

    内部等价于 ``expected_revision=None`` 的无条件写：老客户端不知道版本号，强行要求
    它会直接 422。但它写完**仍然推进一版**，于是新客户端的下一次条件写必然 409——
    用户因此看见"别处改过"，而不是被静默覆盖（审计 W02 / §4.3）。
    """
    record = _get_live_resume(db, resume_id)
    outcome = save_content(
        db,
        record_id=record.id,
        content=_validated_content(payload),
        expected_revision=None,
    )
    if outcome is None:  # 读到之后被删（竞态）：与一开始就没有这一行同一口径。
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return _to_resume_out(outcome.record)


@router.put("/{resume_id}/content", response_model=ResumeOut)
def save_resume_content(resume_id: int, payload: ResumeContentSave, db: Session = Depends(get_db)):
    """**条件写**正文（W02）：只有版本匹配才落库，否则 409 且一个字节都不动。

    ``expected_revision`` 缺省（``None``）时退化成旧行为——无条件写并推进一版，方便
    脚本与调试；制作台一定会带上它，用户因此不会在"两个窗口同时改"时被静默覆盖。
    内容与库里完全一致时**不推进**版本：重复点保存不该把另一个窗口打成冲突。
    """
    record = _get_live_resume(db, resume_id)
    try:
        outcome = save_content(
            db,
            record_id=record.id,
            content=_validated_content(payload.content),
            expected_revision=payload.expected_revision,
        )
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    if outcome is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return _to_resume_out(outcome.record)


@router.patch("/{resume_id}", response_model=ResumeOut)
def rename_resume(
    resume_id: int,
    payload: ResumeTitleUpdate,
    db: Session = Depends(get_db),
):
    """只更新简历名称；正文与生成告警都不受影响。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.title = payload.title
    # 改名同样是"用户认了这一份"：他给这份简历取了名字，就该在简历中心看到它（0051）。
    _mark_saved(record)
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.patch("/{resume_id}/note", response_model=ResumeOut)
def update_resume_note(
    resume_id: int,
    payload: ResumeNoteUpdate,
    db: Session = Depends(get_db),
):
    """只更新简历备注（列表默认可见、详情可编辑）。"""
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.note = payload.note
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.patch("/{resume_id}/favorite", response_model=ResumeOut)
def update_resume_favorite(
    resume_id: int,
    payload: ResumeFavoriteUpdate,
    db: Session = Depends(get_db),
):
    """切换简历收藏状态，不修改简历正文。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.favorite = payload.favorite
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.delete("/{resume_id}", status_code=204)
def delete_resume(resume_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删除）。

    简历记录里有生成正文、版式覆盖与警告信息，是用户花了模型调用换来的；误删的代价远大于
    多留一行。彻底删除在「回收站」里单独提供（不可恢复，需二次确认）。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    trash.soft_delete(db, "resume", record)
    db.commit()
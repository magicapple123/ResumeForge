# SPDX-License-Identifier: Apache-2.0
"""简历 CRUD 端点（域⑤）：手写保存、列表、读取、正文修改、重命名、备注、收藏与软删除。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_to_resume_out` 改从
``_shared`` 导入。
"""

import hashlib
import json
import logging
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.job import Job
from ...models.resume import ResumeRecord, saved_only
from ...schemas.common import Page
from ...schemas.resume import (
    DeliveryDetail,
    DeliverySummary,
    ManualResumeRequest,
    ResumeBatchDeleteResult,
    ResumeBatchRequest,
    ResumeBrief,
    ResumeContent,
    ResumeFavoriteUpdate,
    ResumeNoteUpdate,
    ResumeOut,
    ResumeTitleUpdate,
)
from ...services import trash
from ...services.resume.resume_delivery import (
    get_delivery,
    list_deliveries,
    replay_delivery_export,
)
from ...services.resume.resume_record import build_manual_title
from ...services.resume.resume_sections import default_section_order_config
from ...services.resume.resume_template_format import validated_format_config
from ._shared import _mark_saved, _to_resume_out

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/manual", response_model=ResumeOut, status_code=201)
def create_manual_resume(payload: ManualResumeRequest, db: Session = Depends(get_db)):
    """保存用户自行编写的简历，并可选关联岗位。"""
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="关联岗位不存在或已被删除")

    content = payload.content.model_dump()
    # P0-5：板块顺序在**创建时物化**，不再靠前端 UI 的默认值临时生效。
    #
    # 为什么不留给前端：卡片（「调整板块顺序」）与四个渲染器读的都是
    # ``format_config.section_order``；前端 UI 的默认值只是"显示成什么"，渲染器看不见它，
    # 于是老简历会出现"卡片显示资料顺序、PDF 按内置默认排"的两套结果。落库之后只有一个来源。
    #
    # 两处顺序：先铺``默认``（资料顺序；与内置默认相同时 ``default_section_order_config``
    # 返回 ``None``，即**不写键**），再叠请求体里显式给的那份——显式值永远赢。
    format_config = {
        **(default_section_order_config(db) or {}),
        **validated_format_config(payload.format_config),
    }
    record = ResumeRecord(
        title=build_manual_title(payload.content, job, payload.title),
        job_id=job.id if job else None,
        job_title=job.title if job else payload.content.job_intent,
        company=job.company if job else "",
        content=content,
        warnings=[],
        source="manual",
        model="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        parse_error="",
        format_config=format_config,
        draft=payload.draft,
    )
    db.add(record)
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
    return _to_resume_out(record)


@router.put("/{resume_id}", response_model=ResumeOut)
def update_resume(resume_id: int, payload: ResumeContent, db: Session = Depends(get_db)):
    """保存用户对生成简历的手工修改。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")

    record.content = payload.model_dump()
    # AI 生成阶段的告警不再适用于用户已手工确认过的内容。
    record.warnings = []
    record.parse_error = ""
    # 保存成功 = 这份简历"存在了"：制作台草稿到这一步才进简历中心（0051）。
    _mark_saved(record)
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


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


@router.get("/{resume_id}/deliveries", response_model=list[DeliverySummary])
def list_resume_deliveries(resume_id: int, db: Session = Depends(get_db)):
    """一份简历的交付记录摘要（RF-17）：这一版投给了谁、什么时候、指纹是什么。

    只返回摘要（不含 ``content`` 全文，见 ``DeliverySummary``）；简历不存在/已删
    时 404，与详情接口同一口径。证据不可删，列表不过滤任何行。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return [DeliverySummary.model_validate(item) for item in list_deliveries(db, resume_id)]


def _delivery_detail(item) -> DeliveryDetail:
    """ORM 快照 → 详情响应：replayable 与 destination_recorded 是派生结论，不落库。"""
    detail = DeliveryDetail.model_validate(item)
    detail.replayable = bool(item.export_format) and bool(item.request_params)
    detail.destination_recorded = bool(item.company) or bool(item.job_title)
    return detail


@router.get("/deliveries/{delivery_id}", response_model=DeliveryDetail)
def get_delivery_detail(delivery_id: int, db: Session = Depends(get_db)):
    """一条交付记录的详情（PR-09）：**不依赖原简历存活**的独立访问入口。

    旧入口 ``/resumes/{id}/deliveries`` 要求原简历记录存活；而快照外键 SET NULL 后
    数据库证据还在——删了简历却查不到证据是业务上的不可达。本端点按快照 id 直接
    取，原简历/岗位/进度是否被删都不影响读取。旧快照缺新列时如实返回
    ``request_params=None`` / ``destination_recorded=False``，前端标注「不可还原」。
    """
    item = get_delivery(db, delivery_id)
    if item is None:
        raise HTTPException(status_code=404, detail="交付记录不存在")
    return _delivery_detail(item)


@router.get("/deliveries/{delivery_id}/download")
def download_delivery(delivery_id: int, db: Session = Depends(get_db)):
    """从交付快照下载（PR-09）：原简历删除后产物仍可取，证据可达才有意义。

    - ``export`` 快照：凭存档内容 + render_context + 实际生效的请求参数**重放导出**
      （同内容同参数的确定性渲染；脱敏存档不再二次脱敏）。旧快照没有请求参数时
      409「不可还原」——不假装能重放出同一份文件。
    - ``apply``/``track`` 快照：没有导出产物，返回冻结的内容 JSON（当时那份简历正文）。

    **哈希口径（RR-04）**：``X-Content-Sha256`` 永远是**本次响应真实字节**的 sha256
    （用户拿到文件后自己算一遍就能对上）。历史指纹另开响应头：

    - ``X-Artifact-Sha256``：当初导出时产物的 sha256（``artifact_sha256`` 列）；
    - ``X-Source-Content-Sha256``：apply/track 存档里冻结**内容**的规范化 sha256；
    - ``X-Delivery-Replay: true``：这份字节是**重新生成**的，不保证与当初下载的
      源文件逐字节相同——HTML 每次渲染都换 CSP nonce，PDF 还可能带时间戳。要判断
      "是否与原件一致"，把 ``X-Content-Sha256`` 与 ``X-Artifact-Sha256`` 比一下即可。
    """
    item = get_delivery(db, delivery_id)
    if item is None:
        raise HTTPException(status_code=404, detail="交付记录不存在")
    if item.export_format:
        try:
            artifact = replay_delivery_export(item)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - 重放失败要给可解释的响应而不是 500 堆栈
            raise HTTPException(status_code=409, detail=f"从存档重放导出失败：{exc}") from exc
        headers = {
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote(artifact.filename, safe='')}"
            ),
            # 实际本次字节的哈希：以前这里放的是**存档里**的旧产物哈希，HTML 重放
            # 每次 nonce 不同，用户永远核对不上。
            "X-Content-Sha256": hashlib.sha256(artifact.content).hexdigest(),
            "X-Delivery-Replay": "true",
        }
        original = item.artifact_sha256 or item.content_sha256
        if original:
            headers["X-Artifact-Sha256"] = original
        return Response(artifact.content, media_type=artifact.media_type, headers=headers)
    content = json.dumps(
        {
            "说明": "投递快照的内容存档（apply/track 路径没有导出产物，这是冻结的简历正文）",
            "resume_title": item.resume_title,
            "company": item.company,
            "job_title": item.job_title,
            "content": item.content,
        },
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8")
    filename = f"{item.resume_title or 'delivery'}-{item.id}.json"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
        # 返回的是**封装后的 JSON 字节**，哈希就按这些字节算。
        "X-Content-Sha256": hashlib.sha256(content).hexdigest(),
    }
    source_hash = item.source_content_sha256 or item.content_sha256
    if source_hash:
        headers["X-Source-Content-Sha256"] = source_hash
    return Response(content, media_type="application/json; charset=utf-8", headers=headers)


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

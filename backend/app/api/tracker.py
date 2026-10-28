# SPDX-License-Identifier: Apache-2.0
"""求职进度接口。

识别导入分两步，和岗位的多份导入是同一条原则：``/parse`` **只算不写**，把"这条会新增
还是会更新、为什么"返回给用户看；确认之后 ``/apply`` 再执行同一份计划。这样"预览说会
更新、点了确认却没更新"这类不一致从结构上就不会发生。

路由顺序有讲究：``/parse`` / ``/apply`` / ``/export`` 必须注册在 ``/{track_id}`` 之前，
否则会被当成路径参数去解析成整数，返回一个和"路由不存在"很像的 422。
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import SessionLocal, get_db
from ..models.tracker import STATUSES, ApplicationTrack
from ..schemas.common import Page
from ..schemas.resume import DeliverySummary
from ..schemas.tracker import (
    TRACK_EVIDENCE_PREVIEW_CHARS,
    TRACK_NOTE_PREVIEW_CHARS,
    TrackApplyOut,
    TrackApplyRequest,
    TrackCreate,
    TrackListOut,
    TrackOut,
    TrackParseOut,
    TrackParseRequest,
    TrackStatsOut,
    TrackUpdate,
)
from ..services.attachments import (
    assert_attachment_budget,
    image_data_urls,
    normalize_extraction_images,
    total_attachment_bytes,
)
from ..services.document_text import extract_documents_text
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config
from ..services.text_extraction import llm_is_configured
from ..services.tracker import (
    apply_merges,
    count_tracks,
    create_track,
    delete_track,
    iter_csv_chunks,
    iter_tracks,
    list_tracks,
    list_tracks_page,
    preview_merges,
    summarize,
    to_json,
    track_or_none,
    track_out,
    update_track,
)
from ..services.tracker import (
    list_track_deliveries as list_track_delivery_records,
)
from ..services.tracker_extract import extract_tracker_records, local_tracker_records
from ._disconnect import client_gone, run_until_disconnect

router = APIRouter(prefix="/api/tracker", tags=["tracker"])
logger = logging.getLogger(__name__)


def _track_brief(record: ApplicationTrack) -> TrackOut:
    """列表行只带 note / evidence 的**预览**：超长截断加省略号。

    求职看板的主读路径一次拖几十条，note 上限 4000 字（evidence 500），全文随列表
    下发等于白拖几百 KB。卡片上显示预览足够；编辑表单打开时前端会调
    ``GET /{track_id}`` 拿全文回填（TrackFormModal），PUT 的整体替换也是以全文为准，
    不会把截断文本写回库。导出与助手工具走服务层 ``list_tracks``，不经这里，全文不受影响。
    """
    item = track_out(record)
    if len(item.note) > TRACK_NOTE_PREVIEW_CHARS:
        item.note = item.note[:TRACK_NOTE_PREVIEW_CHARS] + "…"
    if len(item.evidence) > TRACK_EVIDENCE_PREVIEW_CHARS:
        item.evidence = item.evidence[:TRACK_EVIDENCE_PREVIEW_CHARS] + "…"
    return item


@router.get("", response_model=TrackListOut)
def read_tracks(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """列出求职进度；可按状态与关键词过滤，统计随列表一起返回。"""
    if status and status not in STATUSES:
        raise HTTPException(status_code=422, detail="未知的进度状态")
    records = list_tracks(db, status=status, keyword=keyword)
    # 统计走 SQL 聚合（全量口径）：列表被 MAX_LIST_LIMIT 截断时漏斗数字仍准确。
    return TrackListOut(
        items=[_track_brief(item) for item in records],
        **summarize(db, status=status, keyword=keyword),
    )


@router.get("/page", response_model=Page[TrackOut])
def read_tracks_page(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    job_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """分页列出求职进度（RF-08）：过滤与排序与旧列表端点完全一致（阶段序优先）。

    旧端点 ``GET /api/tracker`` 给 MAX_LIST_LIMIT（500）兜底并随列表下发漏斗统计；
    本端点让历史记录超过 500 条之后**仍然全部可达**。行 DTO 与旧列表同用
    :func:`_track_brief`：note / evidence 只带预览，全文走详情端点。**声明在
    ``/{track_id}`` 之前**：字面量段必须排在参数段前面（同 ``/export`` 的理由）。

    ``job_id``（RF-11）：岗位详情「该岗位的投递进度」深链带的过滤；不传时行为不变。
    """
    if status and status not in STATUSES:
        raise HTTPException(status_code=422, detail="未知的进度状态")
    records, total = list_tracks_page(
        db, status=status, keyword=keyword, page=page, page_size=page_size, job_id=job_id
    )
    return Page(items=[_track_brief(item) for item in records], total=total)


@router.get("/stats", response_model=TrackStatsOut)
def read_track_stats(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    job_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """只取漏斗统计（P1-2）：``summarize`` 本就是 SQL 聚合，独立成端点后画漏斗
    不必再拖 500 行列表大响应。过滤口径与列表共用；状态取值校验同列表。
    ``job_id``（PR-13）：岗位深链时统计与列表同口径，不再出现"列表是一家公司、
    漏斗是全部岗位"的分裂。
    **声明在 ``/{track_id}`` 之前**（同 ``/export`` 的理由）。
    """
    if status and status not in STATUSES:
        raise HTTPException(status_code=422, detail="未知的进度状态")
    return TrackStatsOut(**summarize(db, status=status, keyword=keyword, job_id=job_id))


@router.post("", response_model=TrackOut, status_code=201)
def create_track_entry(payload: TrackCreate, db: Session = Depends(get_db)):
    return track_out(create_track(db, payload))


@router.get("/export")
def export_tracks(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    job_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """导出当前筛选条件下的进度记录。

    CSV 走 ``StreamingResponse``（2026-10-12 万级数据优化）：行由
    ``iter_tracks`` 惰性按批取、``iter_csv_chunks`` 逐行产出，端点不再
    fetchall + 全内存拼一个几十 MB 的字符串；产物与旧的 ``to_csv`` 字节级一致
    （BOM、表头、行序、``\\r\\n`` 行尾都不变）。JSON 保持一次性拼装：它的
    ``总数`` 字段需要全量计数、indent=2 的嵌套结构逐条重排缩进容易出字节差，
    流式化收益低风险高，如实不切。

    ``job_id``（PR-13）：岗位深链时导出与列表/统计同口径——只导出该岗位的
    进度记录，不再把全部岗位混进同一个文件。

    FastAPI ≥ 0.106 保证 generator 依赖（``get_db``）在响应发送完成后才清理，
    流式 generator 消费期间请求 session 仍然可用。
    """
    if status and status not in STATUSES:
        raise HTTPException(status_code=422, detail="未知的进度状态")
    # 文件名里的条数需要先知道总数：count 与流式读是两次查询，但排序/过滤口径
    # 完全一致（同一份 _filtered_query + _stage_ordered），语义不会漂移。
    total = count_tracks(db, status=status, keyword=keyword, job_id=job_id)
    if format == "json":
        records = list_tracks(db, status=status, keyword=keyword, job_id=job_id, limit=None)
        assert len(records) == total  # 同口径两次查询必须一致；漂移即 bug
        content, media_type, suffix = to_json(records), "application/json; charset=utf-8", "json"
    else:
        # text/csv 不带 charset 时 Excel 会按本地编码猜，中文列名直接变乱码；
        # 内容里的 BOM 再兜一层（见 services/tracker.iter_csv_chunks）。
        media_type, suffix = "text/csv; charset=utf-8", "csv"
        content = iter_csv_chunks(iter_tracks(db, status=status, keyword=keyword, job_id=job_id))
    stamp = str(total)
    filename = f"求职进度-{stamp}条.{suffix}"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
    if isinstance(content, str):
        return Response(content, media_type=media_type, headers=headers)
    return StreamingResponse(content, media_type=media_type, headers=headers)


@router.post("/parse", response_model=TrackParseOut)
async def parse_tracks(payload: TrackParseRequest, request: Request, db: Session = Depends(get_db)):
    """从一段通知材料里识别进度条目；**只返回预览，不写库**。"""
    try:
        images = normalize_extraction_images(payload.images)
        # PDF/DOCX 解析是同步 CPU/IO 重活（pypdf 最多 30 页），下沉线程池。
        documents = await run_in_threadpool(extract_documents_text, payload.documents)
        assert_attachment_budget(
            count=len(payload.images) + len(payload.documents),
            total_bytes=total_attachment_bytes(images) + documents.size_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # PDF 扫描页渲染出的图片并进同一图片通路：与用户截图一样走视觉识别。
    urls = image_data_urls(images) + list(documents.images)
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    if not source_text.strip() and not urls:
        raise HTTPException(status_code=422, detail="缺少通知内容或截图、文档")

    notes: list[str] = list(documents.warnings)
    config = get_llm_config(db)
    if not llm_is_configured(config):
        records, extra = local_tracker_records(source_text)
        return TrackParseOut(
            items=preview_merges(db, records), parse_engine="local", notes=[*notes, *extra]
        )

    provider = create_provider(config)
    # 模型调用可能持续几十秒：先释放请求会话，避免 await 期间一直占着连接池。
    db.close()
    try:
        parsed = await run_until_disconnect(
            request, extract_tracker_records(provider, source_text, urls), what="求职进度识别"
        )
        if parsed is None:  # 客户端断开：不落任何预览，也没必要回退本地规则
            raise client_gone("求职进度识别")
        records, extra = parsed
        engine = "ai"
    except HTTPException:  # 499 原样上抛，别被下面的兜底改写成"识别失败"
        raise
    except LLMError as exc:
        logger.warning("求职进度识别失败，已回退本地规则：%s", exc)
        records, extra = local_tracker_records(source_text)
        engine = "local"
        notes.append(f"AI 识别失败（{exc}），已改用本地关键词匹配。")
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断识别
        logger.exception("求职进度识别发生内部错误，已回退本地规则")
        records, extra = local_tracker_records(source_text)
        engine = "local"
        notes.append("AI 识别发生内部错误，已改用本地关键词匹配。")

    if not records:
        notes.append(
            "这段材料里没有识别出同时包含公司和岗位的进度记录。"
            "如果确实是一封进度通知，可以手动添加，或把邮件正文完整一些再试。"
        )
    # 合并预览要读现有记录，所以必须用**新的**会话——上面那个已经关掉了。
    with SessionLocal() as preview_db:
        items = preview_merges(preview_db, records)
    return TrackParseOut(items=items, parse_engine=engine, notes=[*notes, *extra])


@router.post("/apply", response_model=TrackApplyOut)
def apply_tracks(payload: TrackApplyRequest, db: Session = Depends(get_db)):
    """把用户确认过的进度条目写入。与 ``/parse`` 共用同一份合并计划。"""
    if not payload.items:
        raise HTTPException(status_code=422, detail="没有要保存的记录")
    try:
        return apply_merges(db, payload.items, source=payload.source)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{track_id}", response_model=TrackOut)
def read_track(track_id: int, db: Session = Depends(get_db)):
    record = track_or_none(db, track_id)
    if record is None:
        raise HTTPException(status_code=404, detail="进度记录不存在或已被删除")
    return track_out(record)


@router.get("/{track_id}/deliveries", response_model=list[DeliverySummary])
def list_track_deliveries(track_id: int, db: Session = Depends(get_db)):
    """一条进度记录的交付快照（PR-09）：从岗位/进度进入对应 delivery 的入口。

    快照的外键 SET NULL、冗余目的地列自持：原简历被删后这里的摘要仍然可读
    （摘要不含正文，正文走 ``/api/resumes/deliveries/{id}`` 详情/下载）。
    进度不存在/已删 → 404，与详情接口同一口径。
    """
    if track_or_none(db, track_id) is None:
        raise HTTPException(status_code=404, detail="进度记录不存在或已被删除")
    return [
        DeliverySummary.model_validate(item) for item in list_track_delivery_records(db, track_id)
    ]


@router.put("/{track_id}", response_model=TrackOut)
def save_track(track_id: int, payload: TrackUpdate, db: Session = Depends(get_db)):
    record = track_or_none(db, track_id)
    if record is None:
        raise HTTPException(status_code=404, detail="进度记录不存在或已被删除")
    return track_out(update_track(db, record, payload))


@router.delete("/{track_id}", status_code=204)
def remove_track(track_id: int, db: Session = Depends(get_db)):
    if not delete_track(db, track_id):
        raise HTTPException(status_code=404, detail="进度记录不存在或已被删除")
    return None

# SPDX-License-Identifier: Apache-2.0
"""岗位接口：列表、新增、文本解析、AI 解读、编辑与删除。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..models.job import Job
from ..runtime.blocking import run_sync
from ..schemas.extraction import MAX_RECOGNIZED_TEXT_CHARS
from ..schemas.job import (
    JobMultiTextParseResult,
    JobTextParseRequest,
    JobTextParseResult,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.jobs import job_actions
from ..services.actions.pilots import pilot_actions
from ..services.attachments import (
    assert_attachment_budget,
    image_data_urls,
    normalize_extraction_images,
    total_attachment_bytes,
)
from ..services.document_text import extract_documents_text
from ..services.job.job_multi_parser import extract_multiple_jobs, local_multi_drafts
from ..services.job.job_queries import filtered_query as _filtered_query
from ..services.job.job_sorting import JobSort, JobSortOrder, job_order_by
from ..services.job_text_parser import parse_job_text
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.ocr import load_ocr_context
from ..services.recognition_route import (
    JOB_CONTENT_FIELDS,
    RecognitionSetup,
    blocked_image_warning,
    decide_route,
    dropped_images_warning,
    filled_field_count,
    ocr_rescue,
    ocr_to_text,
    recognition_setup,
    trim_recognized_text,
)
from ..services.settings_service import get_llm_config
from ..services.text_extraction import (
    ai_failed_warning,
    attach_warnings,
    empty_material_warning,
    extract_job_text,
    finalize_recognition_result,
    llm_is_configured,
    mark_local_fallback,
    no_model_warning,
)
from .jobs_bulk import register_jobs_bulk_routes

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


def _image_content_contributed(result, *, images_sent: bool, ocr_text: str) -> bool:
    """这些图片**是否真的为本次识别贡献了内容**（T9-a/B）。

    判据只看结果与过程，不看"用户传了几张图"：

    - 既没发图、OCR 也没读出字 → 没贡献；
    - OCR 读出了字（进了 source_text、字段由它锚定）→ 算贡献；
    - 发了图且模型抄录回内容 / 回填了内容字段 → 算贡献。

    决定的是那句「请对照截图核对」要不要出现：一个字段都没识别出来时，让用户去对照
    截图核对一堆空白是纯噪音。
    """
    if not images_sent and not ocr_text.strip():
        return False
    if ocr_text.strip():
        return True
    return bool(getattr(result, "recognized_text", "")) or filled_field_count(
        result, JOB_CONTENT_FIELDS
    ) > 0


add_action_route(router, job_actions()["list_jobs"])


@router.get("/ids", response_model=list[int])
def list_job_ids(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    job_type: str = Query(default=""),
    status: str = Query(default=""),
    favorite: bool | None = Query(default=None),
    source_kind: str = Query(default=""),
    incomplete_only: bool = Query(default=False),
    sort: JobSort = Query(default="created_desc"),
    order: JobSortOrder | None = Query(default=None),
):
    """当前筛选下**全部**岗位的 id（不分页）：批量选择「全选全部岗位」用。

    id 列表本身很轻（几千条也只是几 KB），把筛选逻辑交给前端分页拉取反而要多轮请求；
    批量操作 500 的上限由前端在拿到列表后裁决——这里如实返回全量。

    排序参数与 ``/jobs`` 完全同源（同一份 ``job_order_by``）：跨页全选拿到的 id 顺序
    必须与用户看到的列表一致，否则"全选后批量导出/改状态"的处理顺序会莫名其妙。
    """
    return [
        job_id
        for (job_id,) in _filtered_query(
            db, keyword, job_type, status, favorite, source_kind, incomplete_only
        )
        .order_by(*job_order_by(sort, order))
        .with_entities(Job.id)
        .all()
    ]


add_action_route(router, job_actions()["create_job"])


def _prepare_parse_llm(db: Session) -> RecognitionSetup:
    """读模型配置、能力声明、OCR 上下文，然后归还请求连接（整段同步工作单元）。

    识别可能持续几十秒：会话留在事件循环线程上（哪怕只是 ``close``）会让同进程的其它
    请求排在这条 SQLite 连接后面。**三份上下文都必须在 ``close`` 之前取**——OCR 的 Key
    与引擎档位也是查库拿的，放到 close 之后会静默变成"OCR 不可用"。未配置模型时
    ``provider`` 为 ``None``，调用方走本地兜底。
    """
    config = get_llm_config(db)
    provider = create_provider(config) if llm_is_configured(config) else None
    setup = recognition_setup(config, provider, load_ocr_context(db))
    db.close()
    return setup


@router.post("/parse-text", response_model=JobTextParseResult)
async def parse_job_text_draft(payload: JobTextParseRequest, db: Session = Depends(get_db)):
    """把用户粘贴的招聘信息（或截图、文档）解析为草稿；确认后仍由新增岗位接口入库。"""
    try:
        images = normalize_extraction_images(payload.images)
        # PDF/DOCX 解析是同步 CPU/IO 重活（pypdf 最多 30 页），下沉线程池。
        documents = await run_in_threadpool(extract_documents_text, payload.documents)
        assert_attachment_budget(
            count=len(payload.images) + len(payload.documents),
            total_bytes=total_attachment_bytes(images) + documents.size_bytes,
        )
    except ValueError as exc:
        # 在路由层抛：只有 HTTPException 的 detail 会被前端原样展示。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # PDF 扫描页渲染出的图片并进同一图片通路：与用户截图一样走视觉识别。
    image_urls = image_data_urls(images) + list(documents.images)
    has_images = bool(image_urls)
    has_documents = bool(payload.documents)

    # 文档文字与粘贴文本合并成同一份 source_text：本地规则与模型看到的材料一致，
    # 字段锚定也仍然对着原文，比图片那条"让模型自己抄录再核对"的路子强。
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    if not source_text.strip() and not image_urls:
        # 与多份入口同一口径（T9-a）：文档也可能一个字都提不出来（空白扫描页、只有版式的
        # 文档），这种请求根本没有可识别的材料，不该白跑一次模型。
        raise HTTPException(status_code=422, detail="缺少招聘信息或截图、文档")
    local_draft = parse_job_text(source_text)
    setup = await run_sync(_prepare_parse_llm, db)
    provider = setup.provider
    if provider is None:
        return finalize_recognition_result(
            mark_local_fallback(local_draft, no_model_warning(has_images, has_documents)),
            has_images=has_images,
            document_warnings=documents.warnings,
            # 没有模型就没有"图片贡献了内容"这回事：别让用户去核对一张没被读过的截图。
            images_contributed=False,
        )
    # I-34：先看能力表再决定发什么。文本模型收到 image_url 只会 400，等失败再猜原因
    # 是在替用户读报错；这里直接按"有图 / 能看图 / 能用 OCR"四条出口走。
    route = decide_route(
        has_images=has_images,
        vision=setup.vision,
        ocr_usable=setup.ocr_available,
        ocr_forced=setup.ocr_forced,
    )
    extra_warnings: list[str] = []
    ocr_text = ""
    if route == "blocked":
        # 一个请求都不发：本地规则 + 精确提示（含模型名与两条出路）。
        return finalize_recognition_result(
            mark_local_fallback(
                local_draft,
                blocked_image_warning(setup.model, ocr_engine=setup.ocr_engine),
            ),
            has_images=has_images,
            document_warnings=documents.warnings,
            images_contributed=False,
        )
    if route == "ocr":
        prep = await ocr_to_text(
            source_text=source_text,
            image_urls=image_urls,
            ctx=setup.ocr,
            parse_local=parse_job_text,
        )
        extra_warnings.extend(prep.warnings)
        if prep.dropped_images:
            extra_warnings.append(dropped_images_warning(prep.dropped_images, setup.model))
        source_text, local_draft, ocr_text = prep.source_text, prep.local_draft, prep.ocr_text
        # OCR 文本与原图**不同时发**：双倍计费，且锚定会同时对着两套文字。
        image_urls = []
        if not source_text.strip():
            # 空材料短路（T9-a）：OCR 一个字都没读出来，又没有原图可发。这一单没有任何
            # 可识别的内容，**一个请求都不发**——否则模型只会回一句"没有招聘信息"，
            # 再被当成"AI 识别失败"归因，用户看到的就是自相矛盾的一串提示。
            return attach_warnings(
                finalize_recognition_result(
                    mark_local_fallback(local_draft, empty_material_warning()),
                    has_images=has_images,
                    document_warnings=documents.warnings,
                    images_contributed=False,
                ),
                extra_warnings,
            )
    images_sent = bool(image_urls)
    try:
        result = await extract_job_text(provider, source_text, local_draft, image_urls)
    except LLMError as exc:
        logger.warning("岗位文本 AI 识别失败，已回退本地解析：%s", exc)
        result = mark_local_fallback(
            local_draft,
            ai_failed_warning(has_images, str(exc), has_documents, images_sent=images_sent),
        )
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("岗位文本 AI 识别发生内部错误，已回退本地解析")
        result = mark_local_fallback(
            local_draft,
            ai_failed_warning(
                has_images, has_documents=has_documents, images_sent=images_sent
            ),
        )
    if route == "vision" and setup.ocr_available and not filled_field_count(
        result, JOB_CONTENT_FIELDS
    ):
        # 视觉跑完一个字段都没回填 = 前端不会有任何变化：补一次 OCR，取内容更多的那份。
        try:
            rescue = await ocr_rescue(
                source_text=source_text,
                image_urls=image_urls,
                ctx=setup.ocr,
                parse_local=parse_job_text,
                run_extraction=lambda text, draft, urls: extract_job_text(
                    provider, text, draft, urls
                ),
            )
        except Exception:  # noqa: BLE001 - 兜底失败不该盖掉已有结果
            logger.warning("岗位视觉结果为空，OCR 兜底失败", exc_info=True)
            rescue = None
        if rescue is not None and filled_field_count(rescue.result, JOB_CONTENT_FIELDS) > 0:
            result, ocr_text = rescue.result, rescue.ocr_text
            extra_warnings.extend(rescue.warnings)
    if ocr_text:
        result = trim_recognized_text(result, ocr_text, MAX_RECOGNIZED_TEXT_CHARS)
    return attach_warnings(
        finalize_recognition_result(
            result,
            has_images=has_images,
            document_warnings=documents.warnings,
            images_contributed=_image_content_contributed(
                result, images_sent=images_sent, ocr_text=ocr_text
            ),
        ),
        extra_warnings,
    )


@router.post("/parse-multiple", response_model=JobMultiTextParseResult)
async def parse_job_text_multiple(payload: JobTextParseRequest, db: Session = Depends(get_db)):
    """一次粘贴多份招聘信息：拆成多份草稿，用户逐条或全部保存。

    与单份 ``/parse-text`` 共用输入校验与兜底策略：没有可用模型、或模型切不出来时，
    退回本地按显式分隔切分，绝不返回一份"吞掉了其它几份"的草稿。AI 识别偶发抖动
    （如没抄录图片文字、没输出 jobs 数组）会先原样重试一次再回退。本地兜底对纯图片
    无字可切时也保证 ``items`` **至少一条**（空内容草稿 + 原因说明）——响应契约是
    items 非空，前端据此解构第一份草稿的 warnings 与字段。
    """
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
    image_urls = image_data_urls(images) + list(documents.images)
    has_images = bool(image_urls)
    has_documents = bool(payload.documents)
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    if not source_text.strip() and not image_urls:
        raise HTTPException(status_code=422, detail="缺少招聘信息或截图、文档")

    def _local_items(reason: str) -> list[JobTextParseResult]:
        drafts = local_multi_drafts(source_text)
        if not drafts:
            # 纯图片输入时本地规则无字可切（本地没有 OCR），但本接口的响应契约是
            # items 至少一条：前端按 items[0] 解构 warnings 与字段，空列表会让它
            # 炸出 "Cannot destructure property 'warnings'" 的英文 TypeError。
            # 返回一份空内容草稿，前端走"没有识别到内容"的正常提示并保留原因说明。
            drafts = [parse_job_text("")]
        return [mark_local_fallback(draft, reason) for draft in drafts]

    setup = await run_sync(_prepare_parse_llm, db)
    provider = setup.provider
    if provider is None:
        items = _local_items(no_model_warning(has_images, has_documents))
        return JobMultiTextParseResult(
            items=[
                finalize_recognition_result(
                    item,
                    has_images=has_images,
                    document_warnings=documents.warnings,
                    images_contributed=False,
                )
                for item in items
            ],
            parse_engine="local",
        )
    # 与单份解析共用同一套路由：无 vision 时先把图片换成文字，原图不再下发。
    route = decide_route(
        has_images=has_images,
        vision=setup.vision,
        ocr_usable=setup.ocr_available,
        ocr_forced=setup.ocr_forced,
    )
    extra_warnings: list[str] = []
    if route == "blocked":
        items = _local_items(blocked_image_warning(setup.model, ocr_engine=setup.ocr_engine))
        return JobMultiTextParseResult(
            items=[
                finalize_recognition_result(
                    item,
                    has_images=has_images,
                    document_warnings=documents.warnings,
                    images_contributed=False,
                )
                for item in items
            ],
            parse_engine="local",
        )
    ocr_text = ""
    if route == "ocr":
        prep = await ocr_to_text(
            source_text=source_text,
            image_urls=image_urls,
            ctx=setup.ocr,
            parse_local=parse_job_text,
        )
        extra_warnings.extend(prep.warnings)
        if prep.dropped_images:
            extra_warnings.append(dropped_images_warning(prep.dropped_images, setup.model))
        source_text, image_urls = prep.source_text, []
        ocr_text = prep.ocr_text
        if not source_text.strip():
            # 空材料短路（T9-a）：与单份同一判据，**一个请求都不发**；但 items 仍至少
            # 一条空草稿，响应契约与前端解构方式都不变。
            return JobMultiTextParseResult(
                items=[
                    attach_warnings(
                        finalize_recognition_result(
                            item,
                            has_images=has_images,
                            document_warnings=documents.warnings,
                            images_contributed=False,
                        ),
                        extra_warnings,
                    )
                    for item in _local_items(empty_material_warning())
                ],
                parse_engine="local",
            )

    images_sent = bool(image_urls)
    try:
        results = await extract_multiple_jobs(provider, source_text, image_urls)
        engine = "ai"
        images_contributed = bool(ocr_text) or images_sent
    except LLMError as exc:
        logger.warning("多份岗位 AI 识别失败，已回退本地切分：%s", exc)
        results = _local_items(
            ai_failed_warning(has_images, str(exc), has_documents, images_sent=images_sent)
        )
        engine = "local"
        images_contributed = bool(ocr_text)
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("多份岗位 AI 识别发生内部错误，已回退本地切分")
        results = _local_items(
            ai_failed_warning(has_images, "", has_documents, images_sent=images_sent)
        )
        engine = "local"
        images_contributed = bool(ocr_text)

    items = [
        attach_warnings(
            finalize_recognition_result(
                item,
                has_images=has_images,
                document_warnings=documents.warnings,
                images_contributed=images_contributed,
            ),
            extra_warnings,
        )
        for item in results
    ]
    return JobMultiTextParseResult(items=items, parse_engine=engine)


# 批量状态/回收站与 CSV 导入导出的实现都在 ``jobs_bulk.py``：本文件的行数预算已满，
# T9 一改动就顶穿 500 行硬闸门。注册位置保持原样，路由顺序与拆分前逐条一致。
# 用 ``register_jobs_bulk_routes`` 而不是直接拿 ``bulk_router``：导入方向守卫只把
# 「router / register_*_routes」认作子路由装配（``api/apply_extra.py`` 同款先例）。
register_jobs_bulk_routes(router)


# T28 首批：GET /api/jobs/{job_id} 由契约层生成（ActionSpec 是参数/权限唯一真源）。
# 注册位置仍由本文件里的调用点显式决定（原来的装饰器位置，保持注册顺序）。
add_action_route(router, pilot_actions()["get_job"])


add_action_route(router, job_actions()["update_job"])


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删除）。

    岗位是采集/粘贴攒起来的，一次误点不该让它彻底消失；而且岗位被删后**关联的投递记录会保留
    快照并按既有约定置空 job_id**，所以软删除与真删在这条行为上没有区别。
    彻底删除在「回收站」里单独提供（不可恢复，需二次确认）。
    """
    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    trash.soft_delete(db, "job", job)
    db.commit()

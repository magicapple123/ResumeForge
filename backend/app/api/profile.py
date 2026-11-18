# SPDX-License-Identifier: Apache-2.0
"""个人资料接口：读取、整体更新与文本识别草稿。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.extraction import MAX_RECOGNIZED_TEXT_CHARS
from ..schemas.photo import ProfilePhotoCreate, ProfilePhotoOut, ProfilePhotoUpdate
from ..schemas.profile import (
    ProfileOut,
    ProfilePatch,
    ProfileTextParseRequest,
    ProfileTextParseResult,
    ProfileUpdate,
)
from ..services.actions import add_action_route
from ..services.actions.catalog import registered_action
from ..services.actions.domains.profile import profile_actions
from ..services.attachments import (
    assert_attachment_budget,
    image_data_urls,
    normalize_extraction_images,
    total_attachment_bytes,
)
from ..services.document_text import extract_documents_text
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.ocr import load_ocr_context
from ..services.profile.profile_photos import (
    add_photo,
    delete_photo,
    list_photos,
    rename_photo,
    set_primary_photo,
)
from ..services.profile.profile_save import (
    save_photo_copy,
    save_profile_with_photo,
)
from ..services.profile.profile_service import (
    patch_profile,
)
from ..services.profile_catalog_draft import build_profile_draft_sections
from ..services.profile_text_parser import parse_profile_text
from ..services.recognition_route import (
    PROFILE_CONTENT_FIELDS,
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
    extract_profile_text,
    finalize_recognition_result,
    llm_is_configured,
    mark_local_fallback,
    no_model_warning,
)
from ._disconnect import client_gone, run_until_disconnect

router = APIRouter(prefix="/api/profile", tags=["profile"])
logger = logging.getLogger(__name__)


class ProfileDraftFieldOut(BaseModel):
    """新目录草稿里的一个默认小字段（F4 §6：前端按目录校对，不自己映射）。"""

    field_id: str
    label: str
    value: str = ""


class ProfileDraftEntryOut(BaseModel):
    """多条目分区里的一条解析结果（条目数 > 1 时才出现）。"""

    fields: list[ProfileDraftFieldOut] = Field(default_factory=list)


class ProfileDraftSectionOut(BaseModel):
    """一个内置大字段的草稿；fields 是第一条，entries 承载其余条目。"""

    key: str
    name: str
    fields: list[ProfileDraftFieldOut] = Field(default_factory=list)
    entries: list[ProfileDraftEntryOut] | None = None


class ProfileTextParseDraftOut(ProfileTextParseResult):
    """旧响应形状 + 新目录草稿 sections（**只追加**，旧字段完整保留向前兼容）。"""

    sections: list[ProfileDraftSectionOut] = Field(default_factory=list)


def _with_catalog_draft(result: ProfileTextParseResult) -> ProfileTextParseDraftOut:
    """给识别结果补上新目录草稿；旧字段一个都不动（前端逐批迁移）。"""
    return ProfileTextParseDraftOut.model_validate(
        {**result.model_dump(), "sections": build_profile_draft_sections(result)}
    )


def _save_photo_copy(db: Session, data_url: str, source_ref: str, fallback_name: str) -> None:
    """兼容封装：实现在 ``services.profile.profile_save.save_photo_copy``。

    照片副本从 api 层下沉到服务层，是因为助手动作 ``update_profile`` 也要同一行为；
    这里保留同名薄封装，``app.api.profile._save_photo_copy`` 这个补丁落点不变。
    """
    save_photo_copy(db, data_url, source_ref, fallback_name)


# T28 Batch B：GET /api/profile 由契约层生成（ActionSpec 是参数/权限的唯一真源）。
# 注册位置仍在原装饰器处，保持路由顺序不变；响应模型仍是 ProfileOut（编辑视图全量）。
add_action_route(router, profile_actions()["get_profile"])


add_action_route(router, registered_action("update_profile"), route_path="")


def save_profile(payload: ProfileUpdate, db: Session = Depends(get_db)):
    """旧协议 PUT：映射后整体替换新模型条目，不再重建旧六表（F2 契约 §5.1）。

    薄壳：写库与照片副本都在 ``services.profile.profile_save.save_profile_with_photo``
    （助手动作 ``update_profile`` 的路由侧实现调同一个函数）。
    """
    return save_profile_with_photo(db, payload)


@router.patch("", response_model=ProfileOut)
def patch_profile_fields(payload: ProfilePatch, db: Session = Depends(get_db)):
    """**局部合并**：只改请求里出现过的字段，没出现的原样保留。

    与 ``PUT /api/profile`` 的分工（两个都留着，语义不同、互不替代）：

    - ``PUT`` 是**整体替换**：没传的字段落回默认值（空串 / 空数组）。它服务"这一页就是
      全部资料"的老界面，行为一字未改，向后兼容。
    - ``PATCH`` 是**合并**：只写传了的键。子资源数组按"整个数组替换"处理，
      所以显式传 ``"educations": []`` 是清空，不传才是"不动"。

    为什么要两套：只有 PUT 的时候，任何"只改一个字段"的调用方都被迫把整份资料读出来再
    整份写回去——中间任何一次并发编辑都会互相覆盖（"我在改手机号，另一处把简历教育经历
    存空了"）。PATCH 让"只改这一项"变成一个原子请求。
    """
    # PATCH 只写 model_fields_set 里出现过的键；同样映射到新条目而非旧子表。
    profile = patch_profile(db, payload)
    # 只有真的传了 photo 且非空才落磁盘副本（没传时 payload.photo 是默认空串，不会命中）。
    if payload.photo:
        _save_photo_copy(db, payload.photo, f"profile:{profile.id}", f"profile-{profile.id}")
    return profile


@router.get("/photos", response_model=list[ProfilePhotoOut])
def read_photos(db: Session = Depends(get_db)):
    """列出已保存的个人照片；当前使用的那张带 ``is_primary``。"""
    return list_photos(db)


@router.post("/photos", response_model=ProfilePhotoOut, status_code=201)
def create_photo(payload: ProfilePhotoCreate, db: Session = Depends(get_db)):
    try:
        photo = add_photo(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _save_photo_copy(db, payload.image, f"photo:{photo.id}", photo.name or f"photo-{photo.id}")
    return photo


@router.patch("/photos/{photo_id}", response_model=ProfilePhotoOut)
def update_photo(photo_id: int, payload: ProfilePhotoUpdate, db: Session = Depends(get_db)):
    """重命名照片，或把它设为当前使用的照片。

    没有"取消主照片"的语义：照片面板总要有且只有一张在用的照片，切换只能靠
    ``is_primary=true`` 指到另一张。
    """
    if payload.name is None and payload.is_primary is not True:
        raise HTTPException(status_code=422, detail="缺少要修改的照片字段")
    photo = None
    if payload.name is not None:
        photo = rename_photo(db, photo_id, payload.name)
        if photo is None:
            raise HTTPException(status_code=404, detail="照片不存在或已被删除")
    if payload.is_primary:
        photo = set_primary_photo(db, photo_id)
        if photo is None:
            raise HTTPException(status_code=404, detail="照片不存在或已被删除")
    return photo


@router.delete("/photos/{photo_id}", status_code=204)
def remove_photo(photo_id: int, db: Session = Depends(get_db)):
    if not delete_photo(db, photo_id):
        raise HTTPException(status_code=404, detail="照片不存在或已被删除")


def _prepare_parse_llm(db: Session) -> RecognitionSetup:
    """读模型配置、能力声明、OCR 上下文，然后归还请求连接（整段同步工作单元）。

    识别一次要几十秒，事件循环线程上一旦还留着会话，同进程的其它请求就会排在这条
    SQLite 连接后面。**三份上下文都必须在 ``close`` 之前取**——OCR 的 Key 与引擎档位
    也是查库拿的，放到 close 之后会静默变成"OCR 不可用"。未配置模型时 ``provider``
    为 ``None``，由调用方走本地兜底。
    """
    config = get_llm_config(db)
    provider = create_provider(config) if llm_is_configured(config) else None
    setup = recognition_setup(config, provider, load_ocr_context(db))
    db.close()
    return setup


@router.post(
    "/parse-text",
    response_model=ProfileTextParseDraftOut,
    response_model_exclude_none=True,
)
async def parse_profile_text_draft(
    payload: ProfileTextParseRequest, request: Request, db: Session = Depends(get_db)
):
    """把用户粘贴的个人资料（或截图、文档）拆成可编辑草稿，不写入数据库。"""
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
    local_draft = parse_profile_text(source_text)
    setup = await run_sync(_prepare_parse_llm, db)
    provider = setup.provider
    if provider is None:
        return _with_catalog_draft(
            finalize_recognition_result(
                mark_local_fallback(local_draft, no_model_warning(has_images, has_documents)),
                has_images=has_images,
                document_warnings=documents.warnings,
            )
        )
    # I-34：与岗位识别同一套路由（无 vision → OCR → 文本模型；都用不了 → 一个请求都不发）。
    route = decide_route(
        has_images=has_images,
        vision=setup.vision,
        ocr_usable=setup.ocr_available,
        ocr_forced=setup.ocr_forced,
    )
    extra_warnings: list[str] = []
    ocr_text = ""
    if route == "blocked":
        return _with_catalog_draft(
            finalize_recognition_result(
                mark_local_fallback(
                    local_draft,
                    blocked_image_warning(setup.model, ocr_engine=setup.ocr_engine),
                ),
                has_images=has_images,
                document_warnings=documents.warnings,
            )
        )
    if route == "ocr":
        prep = await ocr_to_text(
            source_text=source_text,
            image_urls=image_urls,
            ctx=setup.ocr,
            parse_local=parse_profile_text,
        )
        extra_warnings.extend(prep.warnings)
        if prep.dropped_images:
            extra_warnings.append(dropped_images_warning(prep.dropped_images))
        source_text, local_draft, ocr_text = prep.source_text, prep.local_draft, prep.ocr_text
        # 资料这条也遵守"OCR 文本与原图不同时发"。
        image_urls = []
    try:
        # 一次识别要几十秒：客户端断开就停下（结果没人要，本地兜底也不必算）。
        result = await run_until_disconnect(
            request,
            extract_profile_text(provider, source_text, local_draft, image_urls),
            what="个人资料识别",
        )
    except LLMError as exc:
        logger.warning("个人资料 AI 识别失败，已回退本地解析：%s", exc)
        result = mark_local_fallback(
            local_draft, ai_failed_warning(has_images, str(exc), has_documents)
        )
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("个人资料 AI 识别发生内部错误，已回退本地解析")
        result = mark_local_fallback(
            local_draft, ai_failed_warning(has_images, has_documents=has_documents)
        )
    if result is None:
        raise client_gone("个人资料识别")
    if route == "vision" and setup.ocr_available and not filled_field_count(
        result, PROFILE_CONTENT_FIELDS
    ):
        try:
            rescue = await ocr_rescue(
                source_text=source_text,
                image_urls=image_urls,
                ctx=setup.ocr,
                parse_local=parse_profile_text,
                run_extraction=lambda text, draft, urls: extract_profile_text(
                    provider, text, draft, urls
                ),
            )
        except Exception:  # noqa: BLE001 - 兜底失败不该盖掉已有结果
            logger.warning("资料视觉结果为空，OCR 兜底失败", exc_info=True)
            rescue = None
        if rescue is not None and filled_field_count(rescue.result, PROFILE_CONTENT_FIELDS) > 0:
            result, ocr_text = rescue.result, rescue.ocr_text
            extra_warnings.extend(rescue.warnings)
    if ocr_text:
        result = trim_recognized_text(result, ocr_text, MAX_RECOGNIZED_TEXT_CHARS)
    return _with_catalog_draft(
        attach_warnings(
            finalize_recognition_result(
                result, has_images=has_images, document_warnings=documents.warnings
            ),
            extra_warnings,
        )
    )

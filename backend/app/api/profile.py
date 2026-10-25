# SPDX-License-Identifier: Apache-2.0
"""个人资料接口：读取、整体更新与文本识别草稿。"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..schemas.photo import ProfilePhotoCreate, ProfilePhotoOut, ProfilePhotoUpdate
from ..schemas.profile import (
    ProfileOut,
    ProfilePatch,
    ProfileTextParseRequest,
    ProfileTextParseResult,
    ProfileUpdate,
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
from ..services.profile.profile_photos import (
    add_photo,
    delete_photo,
    list_photos,
    rename_photo,
    set_primary_photo,
)
from ..services.profile.profile_service import (
    patch_profile,
    project_legacy_profile,
    update_profile,
)
from ..services.profile_catalog_draft import build_profile_draft_sections
from ..services.profile_text_parser import parse_profile_text
from ..services.settings_service import get_llm_config
from ..services.text_extraction import (
    ai_failed_warning,
    extract_profile_text,
    finalize_recognition_result,
    llm_is_configured,
    mark_local_fallback,
    no_model_warning,
)
from ..services.user_files import save_from_data_url

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
    """best-effort：把照片 data URL 落一份磁盘副本（失败只记日志）。"""
    try:
        save_from_data_url(
            db,
            data_url,
            source_type="photo",
            source_ref=source_ref,
            fallback_name=fallback_name,
        )
    except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住照片保存
        logger.warning("个人照片磁盘副本保存失败 ref=%s", source_ref, exc_info=True)


@router.get("", response_model=ProfileOut)
def get_profile(db: Session = Depends(get_db)):
    """旧协议读：从新模型条目全量投影出旧 ProfileOut（形状不变，不读旧六表）。"""
    return project_legacy_profile(db)


@router.put("", response_model=ProfileOut)
def save_profile(payload: ProfileUpdate, db: Session = Depends(get_db)):
    """旧协议 PUT：映射后整体替换新模型条目，不再重建旧六表（F2 契约 §5.1）。"""
    profile = update_profile(db, payload)
    if payload.photo:
        _save_photo_copy(db, payload.photo, f"profile:{profile.id}", f"profile-{profile.id}")
    return profile


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


@router.post(
    "/parse-text",
    response_model=ProfileTextParseDraftOut,
    response_model_exclude_none=True,
)
async def parse_profile_text_draft(payload: ProfileTextParseRequest, db: Session = Depends(get_db)):
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
    config = get_llm_config(db)
    if not llm_is_configured(config):
        return _with_catalog_draft(
            finalize_recognition_result(
                mark_local_fallback(local_draft, no_model_warning(has_images, has_documents)),
                has_images=has_images,
                document_warnings=documents.warnings,
            )
        )
    provider = create_provider(config)
    db.close()
    try:
        result = await extract_profile_text(provider, source_text, local_draft, image_urls)
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
    return _with_catalog_draft(
        finalize_recognition_result(
            result, has_images=has_images, document_warnings=documents.warnings
        )
    )

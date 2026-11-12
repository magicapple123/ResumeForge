# SPDX-License-Identifier: Apache-2.0
"""资料箱接口：零散资料的增删改查。

T28 Batch B 起，列表/单条读取/新建/修改四条由 action 契约层生成（一份 ActionSpec 同时是
工具与路由的唯一真源）；分类、分页、批量删除与删除仍留在本文件。生成的路由都注册在原
装饰器所在位置，注册顺序（/categories、/page、/batch-delete 先于 /{material_id}）不变。
"""

import base64
import logging
from typing import NamedTuple

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.material import MATERIAL_CATEGORIES, Material
from ..schemas.common import Page
from ..schemas.material import (
    MaterialAttachmentOut,
    MaterialBatchDeleteResult,
    MaterialBatchRequest,
    MaterialSummary,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.materials import material_actions
from ..services.attachments import (
    DOCX_MIME,
    image_mime_for_extension,
    normalize_image_attachment,
    safe_attachment_name,
)
from ..services.document_text import MATERIAL_LEGACY_DOC, MAX_MATERIAL_FILE_BYTES, material_suffix
from ..services.material_attachment_text import extract_attachment_text
from ..services.materials import (
    delete_material,
    list_materials_page,
    material_categories,
)
from ..services.user_files import save_from_bytes

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/materials", tags=["materials"])



# 单份附件上限：与 document_text.MAX_MATERIAL_FILE_BYTES（面试材料）同一个数。
# multipart 已经收进内存/临时文件，在解析前就拦住比解析完再说好。
MAX_MATERIAL_ATTACHMENT_BYTES = MAX_MATERIAL_FILE_BYTES

# 附件上传的完整路径。请求体中间件按这个键单独放宽上限（config.max_attachment_upload_mb，
# 默认 12MB）：端点自身校验 10MB，但全局默认只有 8MB，不放宽的话 8–10MB 的文件会先被
# 中间件以「请求体过大，最大允许 8 MB」拦下，用户看到的提示与真实原因不符。
ATTACHMENT_UPLOAD_PATH = f"{router.prefix}/attachments"
_ATTACHMENT_TOO_LARGE = "文件超过 10 MB，无法上传"
_ATTACHMENT_EMPTY = "文件是空的"
_ATTACHMENT_SAVE_FAILED = "原件保存失败，请重试"
_ATTACHMENT_UNSUPPORTED = (
    "只支持图片（png/jpg/jpeg/webp）与文档（pdf/docx/txt/md/markdown/json/csv）"
)
# 上传时尚不知道 material id（附件先传、资料后保存），所以 source_ref 只是一个
# 便于在「我的文件」里辨认的标记；关联关系由 material.files[].file_id 承担。
_ATTACHMENT_SOURCE_REF = "material:attachment"
_ATTACHMENT_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_ATTACHMENT_MIME_BY_SUFFIX = {
    ".pdf": "application/pdf",
    ".docx": DOCX_MIME,
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
}


class _ParsedAttachment(NamedTuple):
    """上传解析结果（纯函数产物，不含数据库副作用）。"""

    name: str
    mime_type: str
    size_bytes: int
    text: str
    data_url: str
    warnings: list[str]


def _parse_attachment(name: str, declared_mime: str, raw: bytes) -> _ParsedAttachment:
    """按扩展名分派：图片走受限缩略图，文档走本机文本提取（纯 CPU/IO，在线程池里跑）。

    失败一律抛面向用户的 ValueError（由端点转成 422）。.doc 单独给"另存为 .docx"
    的提示；扫描件 PDF 不做视觉识别，返回空文本 + 警告（仍可另存为原件）。
    """
    safe_name = safe_attachment_name(name)
    suffix = material_suffix(safe_name)
    if suffix == ".doc":
        raise ValueError(MATERIAL_LEGACY_DOC)
    if suffix in _ATTACHMENT_IMAGE_SUFFIXES:
        canonical_mime = image_mime_for_extension(safe_name)
        if canonical_mime is None:  # pragma: no cover - 防御：集合与映射必须一致
            raise ValueError(_ATTACHMENT_UNSUPPORTED)
        # normalize_image_attachment 吃 data URL：用扩展名对应的规范 MIME 拼，
        # 不信任浏览器偶尔给出的 application/octet-stream。
        encoded = base64.b64encode(raw).decode("ascii")
        normalized = normalize_image_attachment(
            safe_name, canonical_mime, f"data:{canonical_mime};base64,{encoded}"
        )
        return _ParsedAttachment(
            name=str(normalized["name"]),
            mime_type=str(normalized["mime_type"]),
            size_bytes=int(normalized["size_bytes"]),
            text="",
            data_url=str(normalized["data_url"]),
            warnings=[str(item) for item in (normalized.get("notes") or [])],
        )
    mime_type = _ATTACHMENT_MIME_BY_SUFFIX.get(suffix)
    if mime_type is None:
        # 先判类型再解析：不认识的扩展名不该进 pypdf/docx 解析器。
        raise ValueError(_ATTACHMENT_UNSUPPORTED)
    extracted = extract_attachment_text(safe_name, raw)
    return _ParsedAttachment(
        name=safe_name,
        mime_type=mime_type,
        size_bytes=len(raw),
        text=extracted.text,
        data_url="",
        warnings=list(extracted.warnings),
    )


@router.post("/attachments", response_model=MaterialAttachmentOut)
async def upload_material_attachment(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """上传一个资料附件：存原件 + 按类型提取内容，返回可直接放进 material.files 的元信息。

    与 JSON 保存链路的分工：这里只负责"一个文件"（存原件、拿 file_id、提取文字或
    缩略图），资料本身仍走 POST/PUT /api/materials；这样创建与编辑表单可以用同一个
    接口逐个上传、批量多选，而不用把 base64 塞进 JSON 请求体。
    """
    raw = await file.read()
    name = file.filename or ""
    if not raw:
        raise HTTPException(status_code=422, detail=_ATTACHMENT_EMPTY)
    if len(raw) > MAX_MATERIAL_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail=_ATTACHMENT_TOO_LARGE)
    try:
        # PDF/docx 解析是同步 CPU/IO 重活（pypdf / zipfile），下沉线程池别占住事件循环。
        parsed = await run_in_threadpool(
            _parse_attachment, name, file.content_type or "", raw
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        file_id = save_from_bytes(
            db,
            raw,
            original_name=parsed.name,
            mime=parsed.mime_type,
            source_type="material",
            source_ref=_ATTACHMENT_SOURCE_REF,
        )
    except Exception as exc:  # noqa: BLE001 - 磁盘/数据库失败要给用户一句可读原因
        logger.warning("资料附件原件保存失败 name=%s", parsed.name, exc_info=True)
        raise HTTPException(status_code=500, detail=_ATTACHMENT_SAVE_FAILED) from exc
    if file_id is None:  # pragma: no cover - 空字节已在上面拦掉
        raise HTTPException(status_code=422, detail=_ATTACHMENT_EMPTY)
    return MaterialAttachmentOut(
        file_id=file_id,
        name=parsed.name,
        mime_type=parsed.mime_type,
        size_bytes=parsed.size_bytes,
        text=parsed.text,
        data_url=parsed.data_url,
        warnings=parsed.warnings,
    )


# T28 Batch B：GET /api/materials 由契约层生成（原 read_materials 装饰器位置）。
add_action_route(router, material_actions()["list_materials"])


@router.get("/categories", response_model=list[str])
def read_categories(db: Session = Depends(get_db)):
    """候选分类：内置分类在前，用户已用过的自定义分类在后。"""
    used = material_categories(db)
    return list(dict.fromkeys([*MATERIAL_CATEGORIES, *used]))


@router.get("/page", response_model=Page[MaterialSummary])
def read_materials_page(
    keyword: str = Query(default=""),
    category: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=18, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出资料（RF-08 续）：过滤与排序与旧端点同源。

    资料箱此前是无上限的全量下发（数百条时每行还带附件元信息数组），前端全量
    渲染卡片网格。本端点按页取（网格一页 18 张），`MaterialSummary` 仍不带
    data_url 与附件文字（RF-25 口径不变），详情走 `/{id}`。**声明在
    `/{material_id}` 之前**（字面量段排在参数段前面，同 `/categories`）。
    """
    rows, total = list_materials_page(
        db, keyword=keyword, category=category, page=page, page_size=page_size
    )
    return Page(items=rows, total=total)


# T28 Batch B：POST /api/materials 由契约层生成（原 create_material_entry 位置）。
add_action_route(router, material_actions()["create_material"])


@router.post("/batch-delete", response_model=MaterialBatchDeleteResult)
def batch_delete_materials(payload: MaterialBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 `DELETE /{material_id}`：任何一条 id 不存在或已在回收站里即
    整体 404 并附缺失 id 清单，不做"删一半"。单条删除只软删行、不动磁盘副本，
    这里沿用同一行为。**声明在 `/{material_id}` 之前**（同 `/categories`）。
    """
    materials: list[Material] = []
    missing: list[int] = []
    for material_id in payload.material_ids:
        material = trash.get_live(db, Material, material_id)
        if material is None:
            missing.append(material_id)
        else:
            materials.append(material)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下资料不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for material in materials:
        trash.soft_delete(db, "material", material)
    db.commit()
    return MaterialBatchDeleteResult(deleted=len(materials))


# T28 Batch B：GET /api/materials/{material_id} 由契约层生成（原 read_material 位置）。
add_action_route(router, material_actions()["get_material"])


# T28 Batch B：PUT /api/materials/{material_id} 由契约层生成（原 save_material 位置）。
add_action_route(router, material_actions()["update_material"])


@router.delete("/{material_id}", status_code=204)
def remove_material(material_id: int, db: Session = Depends(get_db)):
    if not delete_material(db, material_id):
        raise HTTPException(status_code=404, detail="资料不存在或已被删除")

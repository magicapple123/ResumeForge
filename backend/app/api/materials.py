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
from ..runtime.blocking import run_sync
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
from ..services.document_text import (
    MATERIAL_LEGACY_DOC,
    MAX_LOOSE_MATERIAL_BYTES,
    material_suffix,
)
from ..services.material_attachment_text import extract_attachment_text
from ..services.materials import (
    delete_material,
    list_materials_page,
    material_categories,
)
from ..services.ocr.policy import OcrContext, load_ocr_context
from ..services.user_files import save_from_bytes

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/materials", tags=["materials"])



# 单份附件上限。**这里比面试材料的 10 MB 放宽**（T02）：资料箱是"存证书、成绩单扫描件"
# 的地方，而扫描件的体积主要来自位图——一页 300dpi 彩色扫描就有 300–800 KB，10 MB 只装得
# 下十几页，与 OCR 侧 100 MiB 的能力差一个数量级（Q04）。取 50 MB：够一份 60–80 页的扫描件，
# 又不至于让 `await file.read()` 在桌面进程里一次吃掉上百 MB 内存。
#
# 上限值本身住在 `services/document_text.py`：解析层是同一条链路的最后一道闸门，
# 常量只放一处，端点与解析层才不会各按各的（曾经出现过"端点放行 50 MB、解析层仍按
# 10 MB 拒绝"，用户看到"文件超过 10 MB"却已经传完了 12 MB）。
MAX_MATERIAL_ATTACHMENT_BYTES = MAX_LOOSE_MATERIAL_BYTES

# 附件上传的完整路径。请求体中间件按这个键单独放宽上限（config.max_attachment_upload_mb，
# 默认 56MB）：端点自身校验 50MB，但全局默认只有 8MB，不放宽的话大文件会先被中间件以
# 「请求体过大，最大允许 8 MB」拦下，用户看到的提示与真实原因不符。
ATTACHMENT_UPLOAD_PATH = f"{router.prefix}/attachments"
_ATTACHMENT_TOO_LARGE = (
    f"文件超过 {MAX_MATERIAL_ATTACHMENT_BYTES // (1024 * 1024)} MB，无法上传"
)
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


def _parse_attachment(
    name: str, declared_mime: str, raw: bytes, ocr: OcrContext | None = None
) -> _ParsedAttachment:
    """按扩展名分派：图片走受限缩略图，文档走本机文本提取（纯 CPU/IO，在线程池里跑）。

    失败一律抛面向用户的 ValueError（由端点转成 422）。.doc 单独给"另存为 .docx"
    的提示；扫描件 PDF **不再只是"不支持识别"**（T02）：``ocr`` 允许时按页换成文字，
    只有未启用 OCR 时才保持"返回空文本 + 警告、原件仍可另存"的老口径。

    ``ocr`` 直接标注为 ``OcrContext``：本模块本来就 import 了
    ``services.ocr.policy.load_ocr_context``，类型也从同一处取，不额外制造循环导入
    （历史上前者写成 ``object`` 是为了躲一个已不存在的依赖方向，代价是这一层的类型
    检查全部失效）。
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
        notes = [str(item) for item in (normalized.get("notes") or [])]
        # 证书 / 成绩单经常是手机拍的图片：有 OCR 就顺手换回文字，缩略图照旧保留
        # （用户仍能点开看原件）。OCR 失败不夺走原件——image 的 ValueError 由端点转 422。
        text, ocr_notes = _image_ocr_text(raw, safe_name, canonical_mime, ocr)
        return _ParsedAttachment(
            name=str(normalized["name"]),
            mime_type=str(normalized["mime_type"]),
            size_bytes=int(normalized["size_bytes"]),
            text=text,
            data_url=str(normalized["data_url"]),
            warnings=[*notes, *ocr_notes],
        )
    mime_type = _ATTACHMENT_MIME_BY_SUFFIX.get(suffix)
    if mime_type is None:
        # 先判类型再解析：不认识的扩展名不该进 pypdf/docx 解析器。
        raise ValueError(_ATTACHMENT_UNSUPPORTED)
    extracted = extract_attachment_text(safe_name, raw, ocr=ocr)
    return _ParsedAttachment(
        name=safe_name,
        mime_type=mime_type,
        size_bytes=len(raw),
        text=extracted.text,
        data_url="",
        warnings=list(extracted.warnings),
    )


def _image_ocr_text(
    raw: bytes, name: str, mime: str, ocr: OcrContext | None
) -> tuple[str, list[str]]:
    """图片附件的 OCR 文字与警告；未启用 OCR 时原样返回空文本（保持改造前行为）。"""
    from ..services.ocr.client import OcrError
    from ..services.ocr.scan import recognize_single_image, user_message_for

    try:
        outcome = recognize_single_image(raw, name, mime, ocr)
    except OcrError as exc:
        # engine=ocr：用户明确只要 OCR，失败必须如实报错，不能静默退回"没有文字"。
        raise ValueError(user_message_for(exc)) from exc
    return outcome.text, list(outcome.warnings)


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
        # 解析 PDF/docx 是同步 CPU/IO 重活（pypdf / zipfile），下沉线程池别占住事件循环。
        # 识别引擎档位要读库：先在它自己的 worker 里读出来——别在事件循环线程上顺手
        # 求值一次 `load_ocr_context(db)`（那等于把刚搬走的同步读又补回来了）。
        ocr_context = await run_sync(load_ocr_context, db)
        parsed = await run_in_threadpool(
            _parse_attachment, name, file.content_type or "", raw, ocr_context
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        # 落盘 + 登记用户文件是一次同步写事务（磁盘写 + 主键回读），交给 worker：
        # 事件循环在附件多选批量上传时还要接下一个请求。
        file_id = await run_sync(
            save_from_bytes,
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

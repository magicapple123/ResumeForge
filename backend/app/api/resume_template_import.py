"""参考简历识别 API：只分析安全配置，返回前端确认草稿。"""

from __future__ import annotations

import base64
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..schemas.resume_template import ResumeTemplateDetail, TemplateRecognitionDraft
from ..services.attachments import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_TOTAL_BYTES,
    detect_file_format,
    document_mime_of_content,
    image_mime_of_content,
    safe_attachment_name,
)
from ..services.document_text import extract_document_text
from ..services.image_conversion import convert_to_supported_image
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config
from ..services.resume.resume_template_import import (
    TemplateImportError,
    TemplateImportSource,
    derive_format_template,
    derive_style_template,
    missing_format_keys,
)
from ..services.resume.resume_template_store import TemplateError, create_user_template
from ..services.resume.resume_templates import RESUME_TEMPLATES, TEMPLATES_DIR

logger = logging.getLogger(__name__)
router = APIRouter(tags=["resume-templates"])


def _legacy_dependency(name: str, fallback):
    legacy = sys.modules.get("app.api.resume_templates")
    return getattr(legacy, name, fallback) if legacy is not None else fallback


def _configured_llm(db: Session):
    """兼容入口被 monkeypatch 时沿用它，否则读真实设置。"""
    return _legacy_dependency("get_llm_config", get_llm_config)(db)


def _provider(config):
    return _legacy_dependency("create_provider", create_provider)(config)


@router.post("/import-from-file", response_model=ResumeTemplateDetail, status_code=201)
async def import_template_from_file(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    db: Session = Depends(get_db),
):
    """旧版单文件格式模板导入 API，保留原有请求与响应行为。"""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="文件是空的，请重新选择")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"文件不能超过 {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB，请压缩后再试",
        )
    filename = file.filename or ""
    image_mime = image_mime_of_content(data)
    document_mime = document_mime_of_content(data)
    if image_mime is None and document_mime is None:
        detected, _ = detect_file_format(data)
        raise HTTPException(
            status_code=422,
            detail=(
                f"这个文件看起来是「{detected}」，不是可用的模板素材。"
                "请上传简历的图片（PNG / JPG / WEBP）或文档（PDF / DOCX）。"
            ),
        )
    if image_mime is not None:
        source = TemplateImportSource(
            filename=filename,
            image_data_urls=[f"data:{image_mime};base64,{base64.b64encode(data).decode('ascii')}"],
        )
    else:
        data_url = f"data:{document_mime};base64,{base64.b64encode(data).decode('ascii')}"
        extractor = _legacy_dependency("extract_document_text", extract_document_text)
        try:
            extracted = extractor(filename, document_mime, data_url)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"{exc}。也可以把简历截图成图片上传，或手动新建格式模板。",
            ) from exc
        source = TemplateImportSource(filename=filename, text=extracted.text)

    config = _configured_llm(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")
    provider = _provider(config)
    db.close()
    try:
        derived = await derive_format_template(provider, source)
    except TemplateImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"分析模板失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 给旧客户端返回稳定错误
        logger.exception("模板导入分析发生内部错误")
        raise HTTPException(status_code=502, detail="分析模板失败，请稍后重试") from exc

    final_name = (name or "").strip() or str(derived["name"])
    try:
        template = create_user_template(
            db,
            name=final_name,
            kind="format",
            description=str(derived["description"]),
            config=derived["config"],
            source_name=filename,
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    missing = missing_format_keys(derived["config"])
    if missing:
        logger.info("模板导入未识别到的参数：%s", ",".join(missing))
    return ResumeTemplateDetail.model_validate(template)



async def _read_sources(files: list[UploadFile]) -> tuple[TemplateImportSource, list[str], list[str]]:
    if not files:
        raise HTTPException(status_code=422, detail="至少上传一份参考模板")
    if len(files) > 8:
        raise HTTPException(status_code=422, detail="一次最多上传 8 份参考模板")

    total_bytes = 0
    names: list[str] = []
    texts: list[str] = []
    images: list[str] = []
    warnings: list[str] = []
    for file in files:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=422, detail="参考模板文件不能为空")
        total_bytes += len(data)
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=422, detail="单个参考模板文件不能超过 2 MB")
        if total_bytes > MAX_ATTACHMENTS_TOTAL_BYTES:
            raise HTTPException(status_code=422, detail="参考模板文件合计不能超过 5 MB")
        try:
            filename = safe_attachment_name(file.filename or "参考模板")[:255]
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        names.append(filename)
        image_mime = image_mime_of_content(data)
        document_mime = document_mime_of_content(data)
        if image_mime is not None:
            if image_mime in {"image/bmp", "image/tiff"}:
                try:
                    data, image_mime = await run_in_threadpool(
                        convert_to_supported_image, data, MAX_ATTACHMENT_BYTES
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
            images.append(f"data:{image_mime};base64,{base64.b64encode(data).decode('ascii')}")
            continue
        if document_mime is None:
            detected, _ = detect_file_format(data)
            raise HTTPException(
                status_code=422,
                detail=f"「{filename}」看起来是「{detected}」，不是可用的模板素材",
            )
        data_url = f"data:{document_mime};base64,{base64.b64encode(data).decode('ascii')}"
        try:
            extracted = await run_in_threadpool(
                extract_document_text, filename, document_mime, data_url
            )
        except ValueError as exc:
            if "没有从这份文件里提取到文字" in str(exc):
                warnings.append(f"{filename} 没有可提取文字；需要截图才能识别视觉细节")
                continue
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        texts.append(extracted.text)
        warnings.extend(extracted.warnings)

    if not images and not texts:
        raise HTTPException(
            status_code=422,
            detail="没有可供分析的页面图像或文档文字；扫描 PDF 请先截图后上传。",
        )

    return (
        TemplateImportSource(
            filename="用户上传的参考模板",
            text="\n\n".join(texts),
            image_data_urls=images,
        ),
        names,
        list(dict.fromkeys(warnings)),
    )


@router.post("/analyze-from-files", response_model=TemplateRecognitionDraft)
async def analyze_template_from_files(
    files: list[UploadFile] = File(...),
    name: str = Form(default=""),
    db: Session = Depends(get_db),
):
    """识别参考模板并返回可编辑草稿；确认保存由普通模板接口完成。"""
    source, source_names, extraction_warnings = await _read_sources(files)
    config = _configured_llm(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")
    provider = _provider(config)
    db.close()
    try:
        derived = await derive_style_template(provider, source)
    except TemplateImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"分析模板失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 对外返回稳定错误
        logger.exception("参考模板视觉分析发生内部错误")
        raise HTTPException(status_code=502, detail="分析模板失败，请稍后重试") from exc

    spec = RESUME_TEMPLATES["classic"]
    html_path = TEMPLATES_DIR / spec["file"]
    if not html_path.is_file():
        raise HTTPException(status_code=500, detail="内置模板资源缺失，请重新安装应用")
    local_name = Path(source_names[0]).stem[:40] if source_names else "导入的模板"
    final_name = (name or "").strip() or (
        local_name if derived["name"] == "用户上传的参考模板" else derived["name"]
    )
    warnings = list(dict.fromkeys([*extraction_warnings, *derived["warnings"]]))
    return TemplateRecognitionDraft(
        name=final_name[:40],
        description=derived["description"],
        html=html_path.read_text(encoding="utf-8"),
        config=derived["config"],
        confidence=derived["confidence"],
        evidence=derived["evidence"],
        warnings=warnings,
        source_names=source_names,
    )

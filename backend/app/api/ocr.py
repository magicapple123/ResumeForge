# SPDX-License-Identifier: Apache-2.0
"""扫描件识别接口：引擎设置（三档）与后台识别任务。

两个端点族的职责截然不同：

- ``/api/ocr/settings``：读/写"识别引擎"（自动 / 只用 OCR / 只用视觉模型）。Key 不在
  这里写——它复用联网搜索的 DeepSeek Key，避免同一把钥匙要填两处；
- ``/api/ocr/tasks``：上传一份扫描件，**立即**返回任务号，前端轮询进度。OCR 的服务端
  上限是 180 秒，同步等结果必然被前端 90 秒的请求预算先掐断（Q20）。

**没有取消端点，这是刻意的**：官方文档写明断开连接不会中止已收到的识别，照常计费，
并发名额也不释放。前端只能"停止等待"，按钮文案必须如实说明服务端仍在继续。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.ocr import (
    OcrConfig,
    OcrEngineOption,
    OcrSettingsOut,
    OcrTaskCreated,
    OcrTaskStatus,
)
from ..services.attachments import image_mime_for_extension, safe_attachment_name
from ..services.document_text import material_suffix
from ..services.ocr.client import OcrError
from ..services.ocr.policy import (
    ENGINE_LABELS,
    OCR_ENGINES,
    get_ocr_config,
    load_ocr_context,
    ocr_key_configured,
    save_ocr_config,
)
from ..services.ocr.scan import user_message_for
from ..services.ocr.tasks import get_task, start_image_task, start_pdf_task

router = APIRouter(prefix="/api/ocr", tags=["ocr"])
logger = logging.getLogger(__name__)

# 中间件按路径精确匹配放宽请求体上限，所以这里必须与前端调用路径逐字一致。
TASK_PATH = "/api/ocr/tasks"

# OCR 服务端的文件上限是 100 MiB；这里提前拦，避免把 100MB 读进内存再被拒。
MAX_OCR_FILE_BYTES = 100 * 1024 * 1024

_NO_KEY_DETAIL = "还没有配置 DeepSeek API Key，无法使用 OCR 识别"
_UNSUPPORTED_DETAIL = "这种文件不支持 OCR，可换成 PDF 或图片（png / jpg / webp）"
_TOO_LARGE_DETAIL = "文件超过 OCR 的 100 MB 上限"


def _settings_out(db: Session) -> OcrSettingsOut:
    config = get_ocr_config()
    return OcrSettingsOut(
        engine=config.engine,
        key_configured=ocr_key_configured(db),
        engine_options=[
            OcrEngineOption(value=value, label=ENGINE_LABELS[value]) for value in OCR_ENGINES
        ],
    )


@router.get("/settings", response_model=OcrSettingsOut)
def read_ocr_settings(db: Session = Depends(get_db)):
    """识别引擎档位、Key 是否已配置、三档的可读说明（一次给全，前端不用自己写文案）。"""
    return _settings_out(db)


@router.put("/settings", response_model=OcrSettingsOut)
def write_ocr_settings(payload: OcrConfig, db: Session = Depends(get_db)):
    save_ocr_config(payload)
    return _settings_out(db)


@router.post("/tasks", response_model=OcrTaskCreated)
async def create_ocr_task(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """创建后台识别任务：立刻返回任务号与总页数，识别在工作线程里继续。"""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="文件是空的")
    if len(raw) > MAX_OCR_FILE_BYTES:
        raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)

    ctx = await run_sync(load_ocr_context, db)
    if not ctx.configured:
        raise HTTPException(status_code=422, detail=_NO_KEY_DETAIL)

    name = file.filename or "document.pdf"
    try:
        safe_name = safe_attachment_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    suffix = material_suffix(safe_name)
    mime = image_mime_for_extension(safe_name)

    try:
        if suffix == ".pdf":
            task = start_pdf_task(raw, safe_name, ctx)
        elif mime:
            task = start_image_task(raw, safe_name, mime, ctx)
        else:
            raise HTTPException(status_code=422, detail=_UNSUPPORTED_DETAIL)
    except OcrError as exc:
        raise HTTPException(status_code=422, detail=user_message_for(exc)) from exc

    logger.info("OCR 任务已创建 task=%s pages=%s", task.id, task.total_pages)
    return OcrTaskCreated(task_id=task.id, total_pages=task.total_pages)


@router.get("/tasks/{task_id}", response_model=OcrTaskStatus)
def read_ocr_task(task_id: str):
    """轮询进度。``server_cancel_supported`` 恒为 false：服务端不会因前端离开而停下。"""
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="识别任务不存在或已过期")
    return OcrTaskStatus(**task.public())


__all__ = ["MAX_OCR_FILE_BYTES", "TASK_PATH", "router"]

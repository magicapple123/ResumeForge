# SPDX-License-Identifier: Apache-2.0
"""简历中心的「批量导出」：按设置里的统一批量参数，把多份简历打成一个 zip。

**为什么是 zip 而不是 N 个下载**：浏览器会拦截连续多次自动下载，而"批量"本来就该是
一个交付物。zip 里每份简历的文件名沿用单份导出的命名（标题 + 岗位），重名时追加序号。

**为什么参数只从设置读**：这是"统一批量参数"的另一半——用户在设置里确认过一次版式与
格式，批量导出就不再逐份询问。请求体只带 id 列表，避免"两个地方各存一套参数"。

单份失败（正文仍有 `【待补】` 标记、模板渲染失败等）不拖垮整批：跳过并在响应头里说明
跳过几份、第一份为什么被跳过；全部失败才返回 409。
"""

from __future__ import annotations

import logging
import os
import re
import zipfile
from datetime import datetime
from io import BytesIO
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as HTTPRequest
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.resume import ResumeRecord
from ...services import trash
from ...services.batch_operation import read_batch_operation_config
from ...services.export_pipeline import ExportRequest
from .export_routes import _export_record, _require_local_export_request

logger = logging.getLogger(__name__)

router = APIRouter()

# 一次最多导出 50 份：服务端要逐份同步渲染 PDF，50 份已经是"几分钟"的量级；
# 再大应该分批来，而不是让一个请求挂着直到前端超时。
MAX_BATCH_EXPORT = 50

_DISPOSITION_STAR = re.compile(r"filename\*=UTF-8''([^;]+)", re.IGNORECASE)
_DISPOSITION_PLAIN = re.compile(r'filename="?([^";]+)"?', re.IGNORECASE)


class BatchExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_ids: list[int] = Field(min_length=1, max_length=MAX_BATCH_EXPORT)


def _filename_from_headers(headers: dict[str, str], fallback: str) -> str:
    # Starlette 的 Headers 是大小写不敏感的；转成 dict 后键会变成小写，这里统一按小写取。
    disposition = next(
        (value for key, value in headers.items() if key.lower() == "content-disposition"), ""
    )
    starred = _DISPOSITION_STAR.search(disposition)
    if starred is not None:
        return unquote(starred.group(1)) or fallback
    plain = _DISPOSITION_PLAIN.search(disposition)
    return (plain.group(1) if plain else "") or fallback


def _unique_name(name: str, used: set[str]) -> str:
    if name not in used:
        return name
    stem, suffix = os.path.splitext(name)
    index = 2
    while f"{stem}-{index}{suffix}" in used:
        index += 1
    return f"{stem}-{index}{suffix}"


@router.post("/batch-export")
def batch_export_resumes(
    request: HTTPRequest,
    payload: BatchExportRequest,
    db: Session = Depends(get_db),
):
    """把选中的简历按统一批量参数导出为一个 zip。"""
    _require_local_export_request(request)
    export_config = read_batch_operation_config(db).export
    if not export_config.configured:
        # 后端 detail 只写原因，「请先到设置页操作」的指引由前端 errorGuidance 给。
        raise HTTPException(
            status_code=409,
            detail="「批量导出简历」的批量参数尚未配置",
        )
    resume_ids = list(dict.fromkeys(payload.resume_ids))
    rows = (
        db.query(ResumeRecord)
        .filter(trash.live_only(ResumeRecord), ResumeRecord.id.in_(resume_ids))
        .all()
    )
    found = {row.id: row for row in rows}
    missing = [resume_id for resume_id in resume_ids if resume_id not in found]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下简历不存在或已在回收站：{'、'.join(map(str, missing))}",
        )

    archive_bytes = BytesIO()
    used: set[str] = set()
    exported = 0
    skipped: list[str] = []
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        for resume_id in resume_ids:
            record = found[resume_id]
            try:
                response = _export_record(
                    db,
                    record,
                    ExportRequest(
                        format=export_config.export_format,
                        font_scale=export_config.font_scale,
                        page_limit=export_config.page_limit,
                        language=export_config.language,
                    ),
                    allow_incomplete=False,
                    # 批量导出是"一次交付"，不逐份往设置里的保存目录落副本（那会变成 N 份重名文件）。
                    save_copy=False,
                    # 统一参数里的版式优先：批量导出的意义就是"按同一套版式出"。
                    template_override=export_config.template,
                    format_name_override=export_config.format_name,
                )
            except HTTPException as exc:
                skipped.append(f"《{record.title}》：{exc.detail}")
                continue
            except Exception:  # noqa: BLE001 - 单份失败不拖垮整批，原因记日志
                logger.exception("批量导出单份简历失败 resume_id=%s", resume_id)
                skipped.append(f"《{record.title}》：导出失败")
                continue
            filename = _unique_name(
                _filename_from_headers(dict(response.headers), f"resume-{resume_id}"),
                used,
            )
            used.add(filename)
            archive.writestr(filename, response.body)
            exported += 1

    if exported == 0:
        raise HTTPException(
            status_code=409,
            detail="没有可导出的简历：" + "；".join(skipped[:3]),
        )
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    download_name = f"简历批量导出-{stamp}.zip"
    detail = "；".join(skipped[:5])
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name, safe='')}",
        "X-Batch-Exported": str(exported),
        "X-Batch-Skipped": str(len(skipped)),
        # 头里只能是 latin-1：中文原因做 URL 编码，前端解码后展示。
        "X-Batch-Skipped-Detail": quote(detail, safe=""),
    }
    return Response(archive_bytes.getvalue(), media_type="application/zip", headers=headers)


__all__ = ["MAX_BATCH_EXPORT", "router"]

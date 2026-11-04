# SPDX-License-Identifier: Apache-2.0
"""简历中心的「批量导出」：把多份简历打成一个 zip。

**为什么是 zip 而不是 N 个下载**：浏览器会拦截连续多次自动下载，而"批量"本来就该是
一个交付物。zip 里每份简历的文件名沿用单份导出的命名（标题 + 岗位），重名时追加序号。

**参数有两个来源，本次优先**：请求体可以带 `config`（触发点弹窗里"本次参数"，只作用于
这一批）；不带时读「设置 → 批量操作」里保存的默认值——老前端只传 id 列表，行为逐字不变。
既没传本次参数、全局也没配置时才 409。

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
from ...schemas.batch_operation import BatchExportConfig
from ...services import trash
from ...services.batch_operation import read_batch_operation_config, validate_batch_template
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
    # 「本次参数」：只在这一次请求里生效，不写回设置。缺省时退回全局默认值（老前端）。
    # 字段与校验规则直接复用设置页那份 `BatchExportConfig`，不另写一套。
    config: BatchExportConfig | None = None


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


def _resolve_export_config(db: Session, payload: BatchExportRequest) -> BatchExportConfig:
    """本次参数优先，缺省退回全局默认值；两者都没有才算未配置。

    传进来的这一份必须过与设置页同一套校验：字号/页数/语言/格式由 `BatchExportConfig`
    的字段类型与范围约束（pydantic 直接 422），模板名白名单在这里补一道——它是数据校验，
    只信前端等于把设置页那条防线绕开。
    """
    if payload.config is not None:
        try:
            validate_batch_template(db, payload.config.template)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return payload.config
    stored = read_batch_operation_config(db).export
    if not stored.configured:
        # 后端 detail 只写原因，「请先设置」的指引由前端给。
        raise HTTPException(
            status_code=409,
            detail="「批量导出简历」的批量参数尚未配置",
        )
    return stored


@router.post("/batch-export")
def batch_export_resumes(
    request: HTTPRequest,
    payload: BatchExportRequest,
    db: Session = Depends(get_db),
):
    """把选中的简历按本次参数（缺省用全局默认）导出为一个 zip。"""
    _require_local_export_request(request)
    export_config = _resolve_export_config(db, payload)
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

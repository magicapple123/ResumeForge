"""网申填充记录（放宽模式）的工具实现。

``WebFormFillRecord`` 含用户填进别人网页的**真实值**（证件号、手机号等），默认
不出现在助手的工具列表里（见 ``Tool.requires_relaxed``）；用户在设置里显式打开
「助手放宽模式」后，这两个只读工具才会下发给模型。这里不做二次脱敏——门控在
下发处，能调用到就代表用户已知情同意。

删除与"发起填充"不在工具范围：删除走回收站，填充必须在网申页面上进行。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ....models.web_form_record import WebFormFillRecord
from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult

_SOURCE_LABELS = {"batch": "批量填充", "live": "实时填充"}


def _fill_or_error(db: Session, fill_id: int) -> WebFormFillRecord:
    record = db.get(WebFormFillRecord, fill_id)
    if record is None or record.deleted_at is not None:
        raise ValueError(f"填充记录 {fill_id} 不存在")
    return record


def _fill_brief(record: WebFormFillRecord) -> dict:
    return {
        "id": record.id,
        "页面": record.page_title or record.url,
        "url": record.url,
        "结果": f"成功 {record.filled} / 未核对 {record.unverified} / 失败 {record.failed}",
        "方式": _SOURCE_LABELS.get(record.source, record.source),
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _tool_list_web_form_fills(db: Session, arguments: dict) -> ToolResult:
    """列出网申填充记录（摘要：页面/结果/方式/时间，不含填写值）。"""
    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    query = db.query(WebFormFillRecord).filter(WebFormFillRecord.deleted_at.is_(None))
    keyword = str(arguments.get("keyword") or "").strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(WebFormFillRecord.page_title.like(like) | WebFormFillRecord.url.like(like))
    total = query.count()
    rows = query.order_by(WebFormFillRecord.id.desc()).limit(limit).all()
    payload = {
        "总数": total,
        "返回": len(rows),
        "填充记录": [_fill_brief(row) for row in rows],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了 {len(rows)} 条网申填充记录",
        link="/webform",
    )


def _tool_get_web_form_fill(db: Session, arguments: dict) -> ToolResult:
    """读取一次填充的完整明细（含每个框真实填写的值）。"""
    record = _fill_or_error(db, int(arguments["fill_id"]))
    payload = {
        **_fill_brief(record),
        "逐条明细": record.items or [],
        "页面快照": record.page_snapshot or [],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了填充记录「{record.page_title or record.url}」",
        link="/webform",
    )

"""网申填充记录的持久化：落一条、按时间回看、删除（软删）。

与 ``services/webform/session.py`` 的分工：那份是**进程内的表单快照**（用户正在核对的那一份，
900 秒过期），本模块是**填完之后留下的记录**（落库、可回看、可删）。两者生命周期完全不同，
所以不合并——快照要短命（否则读到的是过期页面），记录要长命（否则回看无据）。

- **列表查询一律用 ``trash.live_only``**：回收站里的记录不再出现在「填充记录」里。
- **删除走 ``trash.soft_delete``**：彻底删除在回收站里单独提供，本模块不碰。
- 记录里的 ``items`` / ``page_snapshot`` 含用户填进页面的真实值，**只存本机**，
  不进分享包、不进简历导出（见 ``models/web_form_record.py`` 的隐私说明）。
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from ...models.web_form_record import SOURCE_BATCH, WebFormFillRecord
from .. import trash

logger = logging.getLogger(__name__)

# 一次最多列多少条。记录是"最近填了什么"的地方，不是归档区：默认取最近 20 条
# （对齐投递记录 `list_records` 的默认 page_size），上限放宽到 200 供"翻历史"用。
DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 200


def _as_int(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _clean_item(raw: dict[str, Any]) -> dict[str, Any]:
    """只留约定内的键，且一律转成可 JSON 化的基本类型。

    **不直接存 ``PreviewItem``/``ApplyOutcome`` 的 ``__dict__``**：那些 dataclass 里有
    ``options``（控件下拉项）这类与"我填了什么"无关的东西，存进去会让记录随页面变化而膨胀。
    这里按白名单收窄，记录的形状因此稳定，前端也不必跟着后端 dataclass 改。
    """
    return {
        "index": _as_int(raw.get("index")),
        "field": str(raw.get("field") or ""),
        "field_label": str(raw.get("field_label") or ""),
        "control_label": str(raw.get("control_label") or ""),
        "value": str(raw.get("value") or ""),
        "status": str(raw.get("status") or ""),
        "detail": str(raw.get("detail") or ""),
        "source": str(raw.get("source") or ""),
    }


def _clean_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    """页面可读快照的一行：位置 + 当时的标签 + 当时的实际值 + 是否填上了。"""
    return {
        "index": _as_int(raw.get("index")),
        "label": str(raw.get("label") or ""),
        "value": str(raw.get("value") or ""),
        "filled": bool(raw.get("filled")),
    }


def create_record(
    db: Session,
    *,
    url: str = "",
    page_title: str = "",
    items: list[dict[str, Any]] | None = None,
    page_snapshot: list[dict[str, Any]] | None = None,
    source: str = SOURCE_BATCH,
    filled: int | None = None,
    unverified: int | None = None,
    failed: int | None = None,
) -> WebFormFillRecord:
    """落一条填充记录。

    计数三个参数可以不给——不给就从 ``items`` 的 ``status`` 现算，**避免调用方各算一份
    而算得不一样**（``filled``/``unverified``/``failed`` 与 ``items`` 必须是同一件事的两种表示）。
    """
    clean_items = [_clean_item(item) for item in (items or []) if isinstance(item, dict)]
    if filled is None:
        filled = sum(1 for item in clean_items if item["status"] == "filled")
    if unverified is None:
        unverified = sum(1 for item in clean_items if item["status"] == "unverified")
    if failed is None:
        failed = sum(1 for item in clean_items if item["status"] == "failed")

    record = WebFormFillRecord(
        url=url[:1024],
        page_title=page_title[:256],
        items=clean_items,
        filled=filled,
        unverified=unverified,
        failed=failed,
        page_snapshot=[
            _clean_snapshot(row) for row in (page_snapshot or []) if isinstance(row, dict)
        ],
        source=(source or SOURCE_BATCH)[:16],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_records(db: Session, *, limit: int = DEFAULT_LIST_LIMIT) -> list[WebFormFillRecord]:
    """只取未软删除的填充记录，最近的在最前。"""
    return (
        db.query(WebFormFillRecord)
        .filter(trash.live_only(WebFormFillRecord))
        .order_by(WebFormFillRecord.created_at.desc(), WebFormFillRecord.id.desc())
        .limit(max(1, min(limit, MAX_LIST_LIMIT)))
        .all()
    )


def record_or_none(db: Session, record_id: int) -> WebFormFillRecord | None:
    return trash.get_live(db, WebFormFillRecord, record_id)


def delete_record(db: Session, record_id: int) -> bool:
    """软删除一条填充记录；不存在或已删返回 False（不抛，由路由决定怎么报）。"""
    record = trash.get_live(db, WebFormFillRecord, record_id)
    if record is None:
        return False
    trash.soft_delete(db, "web_form_record", record)
    db.commit()
    return True


__all__ = [
    "DEFAULT_LIST_LIMIT",
    "MAX_LIST_LIMIT",
    "create_record",
    "delete_record",
    "list_records",
    "record_or_none",
]

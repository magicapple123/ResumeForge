"""面试深挖（drill）域的工具实现。"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, MAX_PROFILE_RESULT_CHARS
from .._types import ToolResult


def _tool_list_drill_sessions(db: Session, arguments: dict) -> ToolResult:
    from ....models.drill import DrillSession

    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    status = str(arguments.get("status") or "").strip()
    query = db.query(DrillSession)
    if status:
        query = query.filter(DrillSession.status == status)
    records = query.order_by(DrillSession.created_at.desc()).limit(limit).all()
    payload = {
        "返回": len(records),
        "记录": [
            {
                "id": item.id,
                "标题": item.title,
                "岗位": item.job_title,
                "状态": "进行中" if item.status == "active" else "已结束",
                "已问": item.current_index,
                "最多": item.max_questions,
                "创建时间": item.created_at.isoformat() if item.created_at else None,
            }
            for item in records
        ],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了 {len(records)} 场面试深挖",
        link="/claims/drill",
    )


def _tool_get_drill_report(db: Session, arguments: dict) -> ToolResult:
    from ....models.drill import DrillSession
    from ...drill import session_summary

    try:
        session_id = int(arguments.get("session_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供深挖记录 id（可以先用 list_drill_sessions 查）") from None
    record = db.get(DrillSession, session_id)
    if record is None:
        raise ValueError(f"深挖记录 {session_id} 不存在")

    review = record.review or {}
    payload = {
        "标题": record.title,
        "岗位": record.job_title,
        "状态": "进行中" if record.status == "active" else "已结束",
        "计数": session_summary(record),
        "复盘": {
            "覆盖": review.get("covered", ""),
            "讲得清的": review.get("verified_summary", ""),
            "还站不住的": review.get("gaps_summary", ""),
            "行动清单": review.get("actions", []),
            "复练队列": review.get("rehearsal", []),
        },
        "逐题判定": [
            {
                "主张": item.claim_title,
                "问题": item.question,
                "判定": item.status,
                "已经讲到的": item.evidence_found,
                "仍然缺的": item.missing,
                "发现的矛盾": item.contradictions,
            }
            for item in record.contracts
        ],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False)[:MAX_PROFILE_RESULT_CHARS],
        summary=f"读取了深挖记录「{record.title}」",
        link="/claims/drill",
    )

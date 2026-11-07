# SPDX-License-Identifier: Apache-2.0
"""写操作提案状态查询端点（T01）。

为什么单独一个模块：助手主路由 assistant.py 已贴 500 行预算，提案相关端点
assistant_proposals.py 也只放"批准/拒绝/单条状态"。这里只提供"某会话最近的写操作
状态列表"——前端与排查脚本据此一次拿到本会话的提案时间线，不必逐条猜 id。

返回的是**白名单字段**（不经模型、不含 token、不含完整参数）：与系统提示里的状态块
同源（同一张表），保证"界面看到的"与"模型读到的"是同一份事实。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.assistant_tools import proposal_store

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/write-proposals")
def list_write_proposals(
    conversation_id: int = Query(ge=1, description="会话 id"),
    limit: int = Query(default=10, ge=1, le=50, description="最多返回几条（默认 10）"),
    db: Session = Depends(get_db),
) -> dict:
    """本会话最近的写操作提案状态（按创建时间倒序）。"""
    views = proposal_store.list_conversation(conversation_id, limit=limit, db=db)
    return {
        "items": [
            {
                "proposal_id": view.proposal_id,
                "tool_name": view.tool_name,
                "dataset_id": view.dataset_id,
                "preview": view.preview,
                "created_at": view.created_at.isoformat(),
                "expires_at": view.expires_at.isoformat(),
                "status": view.status,
                "result_summary": view.result_summary,
            }
            for view in views
        ],
        "count": len(views),
    }

# SPDX-License-Identifier: Apache-2.0
"""助手拓宽的接口（18B 简报 / 18C 视角）——独立成文件，不挤进已贴线的 api/assistant.py。

为什么要单独一个 router：api/assistant.py 已接近 500 行硬闸门（本轮不能改它），而这两组
端点的路径（/digest、/personas、/conversations/{id}/persona）与既有会话/技能路由
互不重叠。注册方式沿用同目录的先例（assistant_compaction_api / assistant_conversation_skills）：
由 application_routers.py 的 ROUTERS 元组把本模块追加进去（**主 agent 一行合并**）。

端点清单（前端只用这些）：

===============================  ==========================================
GET  /digest                     今日简报（过期/跨过设置时刻才补算）
POST /digest/refresh             卡片「重新生成」：无条件重算
GET  /personas                   三个视角 preset 的 id 清单（显示名在前端语言包）
GET  /conversations/{id}/persona 这段对话当前启用的视角
PUT  /conversations/{id}/persona 切换视角（空串 = 关闭；工具集不变）
===============================  ==========================================
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.assistant import ConversationSurface
from ..services import assistant_digest
from ..services.assistant import assistant_personas
from .assistant_conversations import conversation_or_404

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


# ===== 18B 今日简报 =====


@router.get("/digest")
def read_digest(db: Session = Depends(get_db)) -> dict:
    """今日简报：距上次生成 <24h 且没跨过设置时刻时返回上次那份（不重复生成）。"""
    return assistant_digest.get_digest(db)


@router.post("/digest/refresh")
def refresh_digest(db: Session = Depends(get_db)) -> dict:
    """卡片上的「重新生成」：无条件现算并覆盖存储。"""
    return assistant_digest.refresh_digest(db)


# ===== 18C 视角 preset =====


class PersonaUpdate(BaseModel):
    """切换视角：空串表示关闭（不启用任何视角技能）。"""

    model_config = ConfigDict(extra="forbid")

    persona_id: str = Field(default="", max_length=32)


@router.get("/personas")
def list_personas() -> dict:
    """视角清单：只回协议值 id（显示名 / 说明在前端语言包，避免两处文案漂移）。"""
    items = assistant_personas.persona_catalog()
    return {"items": items, "count": len(items)}


@router.get("/conversations/{conversation_id}/persona")
def read_conversation_persona(
    conversation_id: int,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
) -> dict:
    conversation_or_404(db, conversation_id, surface)
    return {
        "persona_id": assistant_personas.current_persona_id(db, conversation_id),
    }


@router.put("/conversations/{conversation_id}/persona")
def set_conversation_persona(
    conversation_id: int,
    payload: PersonaUpdate,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
) -> dict:
    """切换视角：把内置视角技能挂到本对话（系统提示下一轮生效），工具集不变。

    空串 = 关闭视角（保留用户自己导入的其它技能）。未知 id → 422 中文原文。
    """
    conversation_or_404(db, conversation_id, surface)
    try:
        assistant_personas.apply_persona(db, conversation_id, payload.persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"persona_id": assistant_personas.current_persona_id(db, conversation_id)}


__all__ = ["router"]

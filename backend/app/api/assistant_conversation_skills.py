# SPDX-License-Identifier: Apache-2.0
"""对话技能接口（T14）：读取 / 整体替换一段对话启用的技能。

为什么独立成文件而不是塞进 assistant.py：那个文件正好贴着 500 行预算（硬闸门），
两条路由加进去会顶穿；而它又必须挂在同一个 `/api/assistant` router 上（路由注册表
application_routers.py 由别的线维护，不动它）。所以这里提供 register 函数，由
assistant.py 在创建 router 后调用一次——path / 前缀 / 依赖与那里的其余会话路由完全一致。

一份数据只在一个接口里拿全：技能清单、已启用 id、注入预算都从 GET 返回，前端菜单
不必再拉第二次；PUT 返回同一个形状，勾选后前端可以直接用响应覆盖本地状态。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.assistant import (
    ConversationSkillBudgetOut,
    ConversationSkillOut,
    ConversationSkillsOut,
    ConversationSkillsUpdate,
    ConversationSurface,
)
from ..services.assistant.assistant_skills import (
    PendingSkillError,
    conversation_skill_budget,
    list_conversation_skills,
    set_conversation_skills,
)
from .assistant_conversations import conversation_or_404


def _payload(db: Session, conversation_id: int) -> dict[str, Any]:
    """把"这个对话启用了什么"组装成前端一次拿全的形状。"""
    skills = list_conversation_skills(db, conversation_id)
    return {
        "skill_ids": [int(skill.id) for skill in skills],
        "skills": [
            ConversationSkillOut(
                id=int(skill.id), name=skill.name, description=skill.description or ""
            )
            for skill in skills
        ],
        "budget": ConversationSkillBudgetOut(**conversation_skill_budget(db, conversation_id)),
    }


def register_conversation_skill_routes(router: APIRouter) -> None:
    """把对话技能两条路由挂到已存在的 /api/assistant router 上（幂等：只挂一次）。"""

    @router.get("/conversations/{conversation_id}/skills", response_model=ConversationSkillsOut)
    def read_conversation_skills(
        conversation_id: int,
        surface: ConversationSurface = Query(default="page"),
        db: Session = Depends(get_db),
    ):
        conversation_or_404(db, conversation_id, surface)
        return _payload(db, conversation_id)

    @router.put("/conversations/{conversation_id}/skills", response_model=ConversationSkillsOut)
    def replace_conversation_skills(
        conversation_id: int,
        payload: ConversationSkillsUpdate,
        surface: ConversationSurface = Query(default="page"),
        db: Session = Depends(get_db),
    ):
        conversation_or_404(db, conversation_id, surface)
        try:
            set_conversation_skills(db, conversation_id, payload.skill_ids)
        except PendingSkillError as exc:
            # #31D/#31F：待验证技能不可启用——用 409 与"参数不合法"区分开，
            # 前端据此提示「先在技能页确认」而不是让它看起来像填错了。
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            # 8 个上限与"技能不存在"都在服务层校验：这里统一转成 422 + 中文原文。
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _payload(db, conversation_id)


__all__ = ["register_conversation_skill_routes"]

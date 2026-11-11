# SPDX-License-Identifier: Apache-2.0
"""上下文压缩接口（问题清单 #10）：手动压缩 / 还原，以及三个压缩设置的读写。

为什么独立成文件：``api/assistant.py`` 已贴着 500 行硬预算（加两条路由会顶穿），
而这两条路由必须挂在同一个 ``/api/assistant`` router 上（路由注册表由别的线维护）。
所以这里提供 ``register_*`` 函数，由 ``assistant.py`` / ``api/settings.py`` 各自在建好
router 之后调用一次——路径、前缀、依赖与那里的其余路由完全一致。

三条语义（界面必须照着说）：

- ``POST …/compact?dry_run=true`` **不写库、不调模型**，只给预估；
- ``POST …/compact`` 真跑，会消耗一次全量输入的模型调用；
- ``DELETE …/compact`` 只清空 ``compaction`` 列——**原文从来没被删除过**。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.assistant import ConversationSurface
from ..schemas.assistant_compaction import (
    AssistantCompactionSetting,
    ConversationCompactOut,
    ConversationCompactRequest,
)
from ..services.assistant.assistant_compaction_store import (
    CompactionSettings,
    CompactionUnavailable,
    clear_compaction,
    get_compaction_settings,
    run_manual_compaction,
    save_compaction_settings,
)
from .assistant_conversations import conversation_or_404


def register_compaction_routes(router: APIRouter) -> None:
    """把「压缩 / 还原」两条路由挂到已存在的 /api/assistant router 上（幂等：只挂一次）。"""

    @router.post(
        "/conversations/{conversation_id}/compact",
        response_model=ConversationCompactOut,
    )
    async def compact_conversation(
        conversation_id: int,
        # 任务书写的是 `POST …/compact`（可真跑也可 dry_run），所以请求体允许省略：
        # 不带体 = 真跑，带 `{"dry_run": true}` = 只出预估。
        payload: ConversationCompactRequest = Body(default=ConversationCompactRequest()),
        surface: ConversationSurface = Query(default="page"),
        db: Session = Depends(get_db),
    ) -> ConversationCompactOut:
        conversation_or_404(db, conversation_id, surface)
        try:
            result = await run_manual_compaction(conversation_id, db, dry_run=payload.dry_run)
        except CompactionUnavailable as exc:
            # 503 而不是 500：这是"模型这会儿不可用"，用户稍后重试有意义，
            # 原文与既有摘要都没被动过（失败不写库）。
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return ConversationCompactOut.model_validate(result)

    @router.delete("/conversations/{conversation_id}/compact", status_code=204)
    def restore_conversation(
        conversation_id: int,
        surface: ConversationSurface = Query(default="page"),
        db: Session = Depends(get_db),
    ) -> None:
        """「还原」：清空压缩状态，下次请求就按原文发送。"""
        conversation_or_404(db, conversation_id, surface)
        clear_compaction(db, conversation_id)


def register_compaction_setting_routes(router: APIRouter) -> None:
    """把三个压缩设置挂到已存在的 /api/settings router 上（幂等：只挂一次）。"""

    @router.get("/assistant-compaction", response_model=AssistantCompactionSetting)
    def read_compaction_setting(db: Session = Depends(get_db)) -> AssistantCompactionSetting:
        settings = get_compaction_settings(db)
        return AssistantCompactionSetting(
            model=settings.model,
            mask_percent=settings.mask_percent,
            summary_percent=settings.summary_percent,
        )

    @router.put("/assistant-compaction", response_model=AssistantCompactionSetting)
    def write_compaction_setting(
        payload: AssistantCompactionSetting, db: Session = Depends(get_db)
    ) -> AssistantCompactionSetting:
        """保存压缩设置：下一次请求即生效（运行中的流不被新阈值改写）。"""
        try:
            saved = save_compaction_settings(
                db,
                CompactionSettings(
                    model=payload.model,
                    mask_percent=payload.mask_percent,
                    summary_percent=payload.summary_percent,
                ),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return AssistantCompactionSetting(
            model=saved.model,
            mask_percent=saved.mask_percent,
            summary_percent=saved.summary_percent,
        )


__all__ = ["register_compaction_routes", "register_compaction_setting_routes"]

# SPDX-License-Identifier: Apache-2.0
"""#31A 助手记忆抽取的后台任务执行体（ai_task kind=assistant_memory_extract）。

与 ``ai_task_handlers_ai_entries.py`` 同一种"自跑"形态：读对话 → 调模型 → 落库。
区别是它**不向用户报错**（抽取失败只是这次没学到东西，下一段空闲再来），
且默认关闭（设置页开关 assistant_memory_auto_extract）——所以任务先被判为可跳过的
"无内容"时按成功收尾，而不是把失败甩到任务卡上。
"""

from __future__ import annotations

import logging
from typing import Any

from ..models.ai_task import AI_TASK_KIND_ASSISTANT_MEMORY
from ..services.assistant import memory
from ..services.assistant.memory_extract import run_extraction
from ..services.llm import create_provider
from ..services.llm.client_pool import aclose_clients_for_current_loop
from ..services.settings_service import get_llm_config
from .ai_task_registry import (
    AiTaskHandlerError,
    handler_payload_field,
    register_ai_task_handler,
)

logger = logging.getLogger(__name__)


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def handle_memory_extract(ctx: Any) -> None:
    """从一次会话里抽取语义记忆（ADD/UPDATE/SUPERSEDE/NOOP），失败不打扰用户。"""
    conversation_id = _positive_int(handler_payload_field(ctx.payload, "conversation_id"))
    if conversation_id is None:
        raise AiTaskHandlerError("缺少对话标识")
    # #31 开关复查：任务是空闲时入队的，用户可能在执行前就把开关关掉了。
    # 入队侧（should_schedule）已检查一次，这里是**执行体**的第二道闸——否则
    # "关了开关，任务仍把记忆抽完"会让开关在用户看来完全失效。
    if not memory.auto_extract_enabled(ctx.session):
        logger.info("助手记忆抽取已关闭，跳过本次任务 conversation=%s", conversation_id)
        ctx.set_progress(100, "自动整理已关闭，本次跳过")
        ctx.set_result({"conversation_id": conversation_id, "skipped": "disabled"})
        return
    ctx.set_progress(10, "正在整理这次对话里的长期信息")
    config = get_llm_config(ctx.session)
    try:
        provider = create_provider(config)
    except Exception as exc:  # noqa: BLE001 - 未配置/配置损坏一律按可预期失败收尾
        raise AiTaskHandlerError(f"模型不可用（{type(exc).__name__}）") from exc
    if provider is None:
        raise AiTaskHandlerError("尚未配置大模型 API")
    box: dict[str, Any] = {}

    async def run() -> None:
        try:
            box.update(
                await run_extraction(
                    ctx.session, conversation_id=conversation_id, provider=provider
                )
            )
        finally:
            # 本任务线程的事件循环即将关闭：先关掉属于它的 HTTP 客户端。
            await aclose_clients_for_current_loop()

    ctx.drive(run())
    ctx.check_canceled()
    if not box.get("parsed"):
        # "这段对话没有可记的事实"不是错误：按成功收尾并记 0 条。
        logger.info(
            "助手记忆抽取：没有可落库的内容 conversation=%s reason=%s",
            conversation_id,
            box.get("reason", ""),
        )
    ctx.set_progress(100, "助手记忆已更新")
    ctx.set_result({"conversation_id": conversation_id, **box})


register_ai_task_handler(AI_TASK_KIND_ASSISTANT_MEMORY, handle_memory_extract)

__all__ = ["handle_memory_extract"]

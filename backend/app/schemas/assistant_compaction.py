# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的请求 / 响应模型（问题清单 #10）。

单独成文件的两个原因：``schemas/assistant.py`` 与 ``schemas/setting.py`` 都已贴近
500 行硬闸门；而这四个模型恰好是"压缩"这一件事的完整契约，放在一起读得完。

一份契约服务三处：流式事件旁边的用量面板（``ContextCompactionStateOut`` 挂在
``ContextUsageOut.compaction`` 上）、手动压缩接口（请求 + 结果）、以及三个设置项。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class ContextCompactionStateOut(BaseModel):
    """这个会话的上下文压缩状态。

    与用量一起下发：用户在看「占了多少」时，同一屏就该看到「压过什么、能不能还原」，
    否则会以为压缩删了聊天记录（原文从来没被删除，只是不再发给模型）。
    """

    # 摘要覆盖到哪条消息；之后新增的消息不受影响（下次从这里往后接着压）。
    covered_until_message_id: int | None = None
    # 已摘要的轮数（会话累计，跨多次压缩相加）。
    turns: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    # 生成这份摘要所用模型；空 = 跟随当前对话模型。
    model: str = ""
    created_at: str = ""
    # 上次遮蔽掉的工具结果条数（L1 的量化结果，面板显示为「已遮蔽 N 条」）。
    masked_tool_results: int = 0


class ConversationCompactRequest(BaseModel):
    """``POST /api/assistant/conversations/{id}/compact`` 的请求体。

    ``dry_run=true`` 只出预估（不写库、不调模型）：压缩要花一次全量输入的调用，
    所以先让用户看到「从 28% 到 9%、覆盖 17 轮」再决定。
    """

    dry_run: bool = False


class ConversationCompactOut(BaseModel):
    """压缩结果（dry-run 与真跑同一个形状，靠 ``dry_run`` 区分）。"""

    dry_run: bool = False
    # 压缩前后的窗口占比；窗口未设置时是 null（没有分母就不猜）。
    percent_before: float | None = None
    percent_after: float | None = None
    # 本次覆盖的轮数；0 = 没有可压缩的区间（最近 6 轮之内不需要摘要）。
    turns_covered: int = 0
    tool_results_masked: int = 0
    model: str = ""
    created_at: str = ""
    covered_until_message_id: int | None = None
    summary: dict[str, Any] | None = None
    # 压缩后的状态（前端据此刷新面板；null = 仍然没有压缩状态）。
    compaction: ContextCompactionStateOut | None = None
    # 没做成时说明原因（nothing_to_summarize 等），成功时是空串。
    reason: str = ""


class AssistantCompactionSetting(BaseModel):
    """上下文压缩的三个设置项。

    ``model`` 空 = 跟随当前对话模型（推荐：摘要质量与主模型同档最省心）。两个阈值是
    窗口占比：``mask_percent`` 触发工具结果遮蔽，``summary_percent`` 触发结构化摘要。
    区间 1–99，且 ``mask_percent <= summary_percent``——反过来摘要永远轮不到执行。
    """

    model: str = Field(default="", max_length=128)
    mask_percent: int = Field(default=60, ge=1, le=99)
    summary_percent: int = Field(default=75, ge=1, le=99)

    @model_validator(mode="after")
    def _ordered(self) -> AssistantCompactionSetting:
        if self.mask_percent > self.summary_percent:
            raise ValueError("遮蔽阈值不能高于摘要阈值")
        return self


__all__ = [
    "AssistantCompactionSetting",
    "ContextCompactionStateOut",
    "ConversationCompactOut",
    "ConversationCompactRequest",
]

"""助手流的整链预算与用量遥测（RF-14 §2.1.b / §2.2 / §2.5）。

从 ``assistant_stream`` 下沉的横切关注点：预算检查点、跨轮用量累计、token 估算
遥测与用量总口径的组装。``assistant_stream`` 只保留编排逻辑；这些"记录与判定"
集中在这里，便于单独测试（毫秒级预算注入 monkeypatch 本模块的 ``get_settings``）。
"""

from __future__ import annotations

from typing import Any

from ..config import get_settings
from ..runtime.operation_budget import OperationBudget
from ..services.llm.token_estimate import estimate_tokens
from ..services.llm.usage import LLMUsage, summarize_usages


class AssistantStreamBudget:
    """一次助手回复的整链预算 + 用量遥测协调器。

    **预算**（§2.1.b）：包住 :class:`OperationBudget`，流内三个检查点（每轮工具
    循环开始 / 每个工具调用发起前 / 每个 delta 事件之后）调用 :meth:`check`——到期
    抛 ``OperationCancelled``，由流收尾转为 error 事件（结束原因如实记
    budget_exhausted）。cancel_event 无人 set——助手流没有用户显式取消通道（浏览器
    断开走 asyncio.CancelledError，另有处理），预算只防"挂死/无限拖"，**不做用户
    取消语义**，也不给它接假信号。

    **用量遥测**（§2.2）：provider 只保留最后一次调用的 ``last_usage``，跨轮累计在
    这里做；测试假 Provider 可能不写甚至没有该属性——用 ``getattr`` 容忍缺失（展示
    「未知」，禁止伪造 0）。
    """

    def __init__(self) -> None:
        self._budget = OperationBudget.start(get_settings().assistant_stream_budget_seconds)
        self.usage_records: list[LLMUsage] = []
        # token 估算遥测（§2.5）：默认关，只在估算开启时才有值。
        self.estimated_prompt_tokens: int | None = None

    @property
    def operation_budget(self) -> OperationBudget:
        """底层 :class:`OperationBudget`：供 provider 的活预算硬墙钟接线（审计 PR-07）。

        助手流此前只在检查点协作检查；把整链预算注入 provider 后，每次传输尝试
        以剩余预算做 asyncio.timeout 上限——首字前静默、只发心跳的流同样被硬切。
        """
        return self._budget

    def check(self) -> None:
        """预算检查点：到期抛 ``OperationCancelled``。"""
        self._budget.raise_if_stopped()

    def record_round(self, provider: Any) -> None:
        """记下一轮模型调用的用量；provider 没有 ``last_usage`` 时跳过，不臆造。"""
        round_usage = getattr(provider, "last_usage", None)
        if round_usage is not None:
            self.usage_records.append(round_usage)

    def estimate_prompt_tokens(self, messages: list[dict[str, Any]]) -> None:
        """§2.5：估算开启时对组装完的 messages 估算总 token（遥测专用）。

        只写 ``estimated_*`` 命名的遥测字段——不改请求体、不参与截断；前端不得把
        估算值与真实 tokens 混在一处展示。
        """
        if get_settings().llm_token_estimate_enabled:
            self.estimated_prompt_tokens = sum(
                estimate_tokens(str(message.get("content") or "")) for message in messages
            )

    def usage_summary(
        self, *, provider: Any = None, finish_reason: str | None = None
    ) -> dict[str, Any] | None:
        """用量总口径（§2.2-5）：进 done 事件与 ChatMessage.context（JSON 列，零迁移）。

        token 缺失时值是 null（前端展示「未知」），禁止伪造 0。``finish_reason`` 给出
        时（预算中止路径）覆盖结束原因；此时若没有任何可汇总的记录，也要构造一条只
        有结束原因的记录——中断原因必须如实落库，不冒充网络错误。``estimated_prompt_tokens``
        只在估算开启时存在，与真实 tokens 明确分开命名。
        """
        payload = summarize_usages(self.usage_records, finish_reason=finish_reason) or {}
        if not payload and finish_reason is not None:
            payload = LLMUsage(
                model=getattr(getattr(provider, "config", None), "model", "") or "",
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                elapsed_ms=0,
                finish_reason=finish_reason,
            ).to_dict()
        if self.estimated_prompt_tokens is not None:
            payload["estimated_prompt_tokens"] = self.estimated_prompt_tokens
        return payload or None


__all__ = ["AssistantStreamBudget"]

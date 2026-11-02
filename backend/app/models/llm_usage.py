# SPDX-License-Identifier: Apache-2.0
"""R04 模型用量账本（迁移 0053）。

**只存数字与枚举，不存提示词、回复、密钥或任何个人资料。** 一行的来源是
`services.llm.usage.LLMUsage`（或"用量未知"的一次调用）：

- `prompt_tokens` / `completion_tokens` / `total_tokens` 可空——服务商没给就是
  `NULL`（界面显示"未知"），**禁止用 0 冒充**；汇总时只要有一行未知就整体给 None。
- `cache_hit_tokens` / `cache_miss_tokens`（0067）：把输入拆成"命中 / 未命中 prompt cache"
  两档，费用估算按两档不同单价算。同样可空，NULL 表示服务商没给。
- `finish_reason` 记录结束原因（stop/length/cancelled/... 或 unknown）。
- `retries` 是传输层重试次数。
- `cost_estimate` 只在**用户配置了单价**时估算；没配置就留 NULL，不臆造费用。
- `task` 是任务类别（生成/修订/建议/翻译/优化/助手…），`model` 是模型标识。
- `input_scope` / `masked` / `language` / `budget`（0074）：**#35 的数据边界审计四字段**。
  它们回答"这次调用喂了什么范围的数据（`resume+profile+job` / `job` / `none`…）、
  是否已脱敏、目标语言是什么、声明的 token 预算多少"。取值与日志里的
  `llm.call input_scope=…` 同源（ContextVar），所以日志、接口、表三处可以逐条对齐；
  仍然**只存枚举与数字**，不含任何正文片段。

数据集隔离同样结构上成立：账本在每份数据集自己的库里。
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class LLMUsageRecord(Base):
    """一次模型调用的用量（**不含任何正文内容**）。"""

    __tablename__ = "llm_usage_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[str] = mapped_column(String(32), default="unknown", index=True)
    model: Mapped[str] = mapped_column(String(64), default="", server_default="")
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True, index=True
    )
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 输入拆分（0067）：命中 prompt cache / 未命中。可空——0067 之前的账本没有这个信息，
    # NULL 表示"没记录过"，不是 0。
    cache_hit_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_miss_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    finish_reason: Mapped[str] = mapped_column(String(32), default="", server_default="")
    retries: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # 费用只在用户配置了单价时才有值；cost_currency 为空表示"未估算"。
    cost_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_currency: Mapped[str] = mapped_column(String(8), default="", server_default="")
    # #35 数据边界四字段（0074）。空串 = 入口没声明（老账本与未声明入口都落在这一档），
    # masked 的 NULL 与 False 必须能区分：NULL 是"没记录"，False 是"明确未脱敏"。
    input_scope: Mapped[str] = mapped_column(String(64), default="", server_default="")
    masked: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    language: Mapped[str] = mapped_column(String(16), default="", server_default="")
    # token 预算声明（不是硬截断）；NULL = 未声明。
    budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


__all__ = ["LLMUsageRecord"]

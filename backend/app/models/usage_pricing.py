# SPDX-License-Identifier: Apache-2.0
"""模型单价档案（迁移 0067）：一份单价是一条**可命名、可回溯**的记录。

为什么要独立成表而不是继续塞 `app_setting` 的一对键：单价是"某个模型服务商在某个时间
点的刊例价"，换模型、调价、做预算对比时用户需要**同时保留几份**并说清哪份是哪份。
`app_setting` 只能存"当前值"，没有名字、没有历史。

三条口径：

1. 单位是**每百万 token**（`*_per_million`）。按千计的数字小到看不出差别（0.000002 元），
   估算结果没有参考价值。
2. 输入分成**缓存命中**与**缓存未命中**两档：命中价通常只有未命中的 1/10 甚至更低，
   合并成一个"输入价"会把省钱的部分算没。
3. `is_active` 同时只该有一行为真（服务层保证）；历史记录 `is_active=False` 保留着，
   随时可以切回去。
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class UsagePricingRecord(Base):
    """一份具名单价档案；金额单位由 `currency` 说明，价格按**每百万 token** 计。"""

    __tablename__ = "usage_pricing_record"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 用户给这份单价起的名字（"DeepSeek 官方价" / "2026-03 调价后"）。空名字允许，
    # 界面按"未命名单价 #id"兜底显示。
    name: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 三档单价：任一为空表示这一档"没有价格"，估算时该档按 0 计（并在界面上说明）。
    input_cache_hit_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    input_cache_miss_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="CNY", server_default="CNY")
    # 同时只有一条生效；由服务层切换（切换时把其它行置 False）。
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = ["UsagePricingRecord"]

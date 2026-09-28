"""网申填表的填充记录：每次「填充到页面」留下一笔，供用户回看。

## 为什么要落库

网申填表此前是"填完即忘"：表单快照存在进程内（``services/webform/session.py``，TTL 900 秒），
浏览器一关、进程一重启就没了。用户填完一张长表，事后想确认"我当时到底填了什么、有几个没成"
时无处可查——而这张表通常是要紧的（证件号、手机号、亲属信息）。

所以每次填充落一条记录：填了哪些框、认成什么字段、最终写了什么值、成功还是失败、为什么。

## 与 ``question_bank_record`` 的区别

那条记录存的是**用户创作的内容**（题库），本表存的是**一次操作的日志**。日志的两个含义：

- 界面上的呈现是"按时间回看的流水"，默认取最近若干条（对齐投递记录 `limit=20`）；
- 但它**仍然进退回收站**（``deleted_at``）：里面含有用户填进别人页面的真实值，
  用户要求能删、且删错了能找回来。这与"只追加的日志"并不矛盾——回收站管的本来就是
  "这条还在不在列表里"。

## 页面快照里有什么（隐私边界）

``page_snapshot`` 是填完之后页面控件的可读快照（标签 + 值 + 是否填上），**含真实值**。
它与 ``items`` 一样只存本机数据库，**不进分享包、也不进简历导出**——这条写在
``docs/user-guide.md`` 的隐私边界里。刻意存它是因为用户事后最常问的是
"我当时那个框里到底填的是什么"，只存字段名答不了。
"""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 这次填充是批量还是实时（点哪个填哪个）。
SOURCE_BATCH = "batch"
SOURCE_LIVE = "live"


class WebFormFillRecord(Base):
    """一次「填充到页面」的记录。"""

    __tablename__ = "web_form_fill_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 当时填的是哪个页面。快照字段：页面关掉之后仍要能说清"这是在哪儿填的"。
    url: Mapped[str] = mapped_column(String(1024), default="")
    page_title: Mapped[str] = mapped_column(String(256), default="")
    # 逐条明细：[{index, field, field_label, control_label, value, status, detail, source}]
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # 计数冗余存一份：列表页只显示"成功 8 / 未核对 1 / 失败 2"，不必把 items 全解出来。
    filled: Mapped[int] = mapped_column(Integer, default=0)
    unverified: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    # 填完后页面上各控件的可读快照：[{index, label, value, filled}]。**含真实值**——
    # 见模块 docstring 的隐私说明。
    page_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # batch | live
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_BATCH)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # 软删除时间戳：NULL 表示「没删」。列表查询一律复用 ``services/trash.live_only``。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = ["SOURCE_BATCH", "SOURCE_LIVE", "WebFormFillRecord"]

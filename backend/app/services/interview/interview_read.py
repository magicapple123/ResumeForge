# SPDX-License-Identifier: Apache-2.0
"""模拟面试会话的只读查询。

列表查询从 api/interview.py 搬来：该文件已贴着 500 行预算，而"按创建时间倒序
列出会话"是模拟面试域的主读路径。为什么放服务层：路由只该做参数校验与响应转换，
取数口径（排序、上限）跟着面试域走，助手工具与后续的分页入口才能复用同一份。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.interview import InterviewSession


def list_sessions(db: Session, limit: int = 50) -> list[InterviewSession]:
    """按创建时间倒序取最近的模拟面试会话（不做分页，上限由调用方给）。"""
    return (
        db.query(InterviewSession).order_by(InterviewSession.created_at.desc()).limit(limit).all()
    )


__all__ = ["list_sessions"]

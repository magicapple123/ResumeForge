# SPDX-License-Identifier: Apache-2.0
"""服务层的会话生命周期：需要"再来一条会话"时，由这里决定怎么开、怎么关。

路由在模型调用期间会主动放掉请求会话（不能占着数据库连接池），调用回来时那条会话
已经关了，得另开一条。**这个时机属于服务层职责**：换成别的连接池策略、加只读副本、
给单次事务加重试，都只改这一处；路由继续直接摸 ``SessionLocal`` 就得逐处改。

为什么提交仍由调用方决定：几个阶段要在中途 ``flush`` 后继续读同一个对象（例如先落契约
再挂轮次），统一在这里 commit 会改变可见性。所以本上下文只负责"开一条、退出时关掉"，
语义与 ``with SessionLocal()`` 完全一致——差别只在**策略的唯一落点**。

长生命周期、需要跨线程或带注入的模块已各自实现，不走这里：
``services/ai_task_runner``（可注入 ``session_factory``）、``services/apply/task_runner``、
``services/agent_task_events``。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session

from ..database import SessionLocal


@contextmanager
def fresh_session() -> Iterator[Session]:
    """开一条独立会话，退出时关闭（未提交的改动随关闭回滚）。首选写法。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def open_session() -> Session:
    """开一条独立会话，**由调用方关闭**。

    给"必须把关闭写在 finally 里、且中途要 return"的老代码用（网申实时会话的取数回调
    就是这种形状：它们在后台线程里被反复调用，每处都是 ``try/return ... finally: close``）。
    等价于直接调 ``SessionLocal()``，差别只在会话策略的唯一落点。
    """
    return SessionLocal()


__all__ = ["fresh_session", "open_session"]

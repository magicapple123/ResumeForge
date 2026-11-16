# SPDX-License-Identifier: Apache-2.0
"""深挖开场（T2：从 `api/drill.py` 的 create_session 下沉）。

按事实台账开一场深挖分三步：挑主张 → 建会话行 → 让模型生成**第一条评分契约**。
契约必须在把问题交给用户之前落库（这是本功能的核心信任边界，见 services/drill 包注释）。

**为什么拆成 prepare / open 两段**：会话行必须先提交再调用模型——模型调用期间不占着
请求会话的连接池，而"第一题没生成出来就把空会话删掉"要用另一条会话（drop_empty_session
内部自开）。两段之间的事务收尾（commit + refresh）留在路由：那是路由的事务边界。

**打桩点**：`create_provider` 由路由以参数注入；测试打桩的是 `app.api.drill` 命名空间上的
这个名字，路由调用期读取后传入，补丁落点不变。模型配置也由路由在 worker 里读好再传进来
（`config`），本函数因此**不需要请求会话**——RF-02 之后它是"纯编排 + 一次模型调用"。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.drill import DrillSession
from ...models.job import Job
from ...schemas.drill import DrillCreate
from ..llm.base import LLMError
from ..session_scope import fresh_session
from ..text_extraction import llm_is_configured
from .contract import generate_plan, open_contract, select_claims
from .session import drop_empty_session

logger = logging.getLogger(__name__)


class DrillSessionOpenError(Exception):
    """开场前置条件不满足：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str, *, discard_session: bool = False) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        # 没有模型时开不了这场深挖：路由负责删掉刚提交的空会话再报 400。
        self.discard_session = discard_session


@dataclass
class DrillSessionDraft:
    """已 `flush`（待路由提交）的会话行 + 生成第一题要用的主张。"""

    session: DrillSession
    claims: list[Any]


def prepare_drill_session(db: Session, payload: DrillCreate) -> DrillSessionDraft:
    """挑主张、按主张建会话行（不提交；提交与刷新由路由收尾）。"""
    # 不传 claim_ids = 旧口径（全部已确认的）；显式空列表在 schema 层就被 422 拦下了。
    claims = select_claims(db, payload.claim_ids or [], payload.max_questions)
    if not claims:
        raise DrillSessionOpenError(
            400,
            (
                "没有可深挖的主张。深挖只针对台账里「已确认」的条目——"
                "先在「事实台账」里确认几条，再回来开这一场。"
            ),
        )

    job = db.get(Job, payload.job_id) if payload.job_id else None
    # 标题默认带上**第一条主张**的名字：一页十几场「主张深挖」谁也认不出是哪一场，
    # 而列表里区分它们的唯一线索就是标题。
    first_claim = claims[0].title or claims[0].subject or f"条目 {claims[0].id}"
    default_title = (
        f"{job.title} · {first_claim}" if job is not None else f"{first_claim} · 主张深挖"
    )
    session = DrillSession(
        title=payload.title.strip() or default_title[:128],
        job_id=payload.job_id,
        job_title=job.title if job is not None else "",
        company=job.company if job is not None else "",
        feedback_policy=payload.feedback_policy,
        claim_ids=[item.id for item in claims],
        max_questions=min(payload.max_questions, len(claims)),
    )
    db.add(session)
    db.flush()
    return DrillSessionDraft(session=session, claims=claims)


async def open_drill_session(
    draft: DrillSessionDraft,
    *,
    config: Any,
    create_provider: Callable[[Any], Any],
    run_plan: Callable[[Awaitable[Any]], Awaitable[Any]],
) -> int:
    """生成第一条评分契约并落库，返回会话 id（路由提交过会话行之后调用）。

    `config` / `create_provider` 由路由注入：路由在 worker 里读好模型配置、提交会话行、
    并关掉请求会话（模型调用期间不占连接池），所以本函数不再碰请求会话。`run_plan` 也由
    路由注入，负责"模型调用 + 客户端断开就取消"（``run_or_gone``）。
    返回后会话已关闭，路由按 id 重新读一次再组装响应（关系是延迟加载的）。
    """
    if not llm_is_configured(config):
        # 没有模型就开不了这场深挖——契约必须由模型按主张生成，编一份假的等于没有标准。
        raise DrillSessionOpenError(
            400,
            "尚未配置大模型：深挖的每一题都要先按你的主张生成评分标准",
            discard_session=True,
        )

    provider = create_provider(config)
    claim = draft.claims[0]
    session_id = int(draft.session.id)
    job_title, company = draft.session.job_title, draft.session.company

    # 第一题没生成出来时把这条空会话删掉（实现见 services/drill/session.py：
    # 用户会看到"一场问不出题的记录"，那比报错更让人困惑；删的时候必须另开一条会话，
    # 原请求会话在上面已经关了）。
    try:
        plan = await run_plan(generate_plan(provider, claim, job_title=job_title, company=company))
    except LLMError as exc:
        logger.warning("生成面试深挖契约失败：%s", exc)
        drop_empty_session(session_id)
        raise DrillSessionOpenError(502, f"生成第一题失败：{exc}") from exc
    except Exception:  # noqa: BLE001 - 外部模型异常不能变成 500
        logger.exception("生成面试深挖契约发生内部错误")
        drop_empty_session(session_id)
        raise DrillSessionOpenError(502, "生成第一题失败") from None

    with fresh_session() as write_db:
        stored = write_db.get(DrillSession, session_id)
        if stored is None:  # 并发删除窗口：模型返回前会话行被删（tests/test_drill_api.py 有覆盖）
            raise DrillSessionOpenError(404, "这场深挖记录不存在或已被删除")
        claim = write_db.get(type(draft.claims[0]), draft.claims[0].id)
        if claim is None:  # 与上面的 stored 同一并发删除窗口（tests/test_drill_api.py 有覆盖）
            raise DrillSessionOpenError(404, "这道题的事实台账不存在或已被删除")
        open_contract(stored, claim, plan)
        # 立刻 flush：契约的 id 要给后续轮次做外键，None 会让"这轮属于哪道题"对不上。
        write_db.flush()
        write_db.commit()
        write_db.refresh(stored)
    return int(session_id)


__all__ = [
    "DrillSessionDraft",
    "DrillSessionOpenError",
    "open_drill_session",
    "prepare_drill_session",
]

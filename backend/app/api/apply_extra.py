# SPDX-License-Identifier: Apache-2.0
"""投递台补强端点（#14）：体检、漏斗、跟进、话术库、屏蔽清单。

**为什么单独成文件**：``api/apply.py`` 的行数预算只剩个位数余量（493/500），而本批要
新增 8 个端点。这里用 :func:`register_apply_extra_routes` 挂进同一个 ``/api/apply``
路由树——``apply.py`` 因此只多了「一行 import + 一行注册」。

端点清单（**前端只用这些，不要在本模块偷偷加**）：

============================  ==========================================
``POST /queue/preflight``     投递前体检（只读）
``GET  /summary``             最近 N 天执行量 + 在面快照
``GET  /records/stale``       投递 ≥N 天仍无回音的记录
``POST /records/{id}/track``  一键写进求职进度（先查重）
``GET  /greeting-templates``  话术库
``PUT  /greeting-templates``  整表覆盖话术库
``GET  /blocklist``           屏蔽清单
``PUT  /blocklist``           整表覆盖屏蔽清单
============================  ==========================================

路由顺序：``/records/stale``（字面量段）与 ``/queue/preflight``（字面量段）都在本模块内
先于任何参数段注册；父子路由的相对顺序见 ``api/apply.py`` 的 include 顺序。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.apply import (
    ApplyBlocklistIn,
    ApplyBlocklistOut,
    ApplyPreflightIn,
    ApplyPreflightOut,
    ApplyStaleListOut,
    ApplySummaryOut,
    ApplyTrackLinkOut,
    GreetingTemplateListOut,
    GreetingTemplateSaveIn,
)
from ..services.apply import funnel, greeting_templates, preflight
from ..services.apply._base import ApplyServiceError
from ..services.settings_service import get_apply_blocklist, save_apply_blocklist
from .apply_insights import register_apply_insight_routes

extra_router = APIRouter(tags=["apply"])


def _raise(exc: ApplyServiceError) -> None:
    """与 ``api/apply.py`` 同口径：服务层异常统一翻成 ``HTTPException``。"""
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


# ===== 14A 投递前体检 =====


@extra_router.post("/queue/preflight", response_model=ApplyPreflightOut)
def queue_preflight(payload: ApplyPreflightIn | None = None, db: Session = Depends(get_db)):
    """检查队列（或点名的几条）现在投出去会不会白投。**只读**，不改任何状态。

    请求体可省略（= 整个队列），因为前端在点「开始投递」时会自动跑一次。
    """
    queue_ids = payload.queue_ids if payload is not None else None
    return preflight.preflight(db, queue_ids)


# ===== 14F 顶部漏斗条 =====


@extra_router.get("/summary", response_model=ApplySummaryOut)
def apply_summary(
    days: int = Query(default=funnel.DEFAULT_DAYS, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """最近 ``days`` 天的执行量（成功/失败/合计）与"现在几个在面"。

    与 ``/api/analytics`` 的分工：那边算**长期转化率**（面试率/Offer 率/渠道），这里只算
    **最近 N 天的执行量**。两个口径不许互相覆盖。
    """
    return funnel.summary(db, days)


# ===== 14C 跟进闭环 =====


@extra_router.get("/records/stale", response_model=ApplyStaleListOut)
def stale_records(
    days: int = Query(default=funnel.DEFAULT_DAYS, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """投出去 ≥``days`` 天、进度仍停在「已投递 / 筛选中」的记录（静默提醒用）。"""
    return funnel.stale_records(db, days)


@extra_router.post("/records/{record_id}/track", response_model=ApplyTrackLinkOut)
def link_record_track(record_id: int, db: Session = Depends(get_db)):
    """把这条投递记录写进求职进度；**已存在则返回已有的那条**（``created=false``）。

    查重键：先按 ``job_id``，再按 ``(company_key, title_key)`` 兜底——同一家公司同一个
    岗位的多次投递归一条进度，否则漏斗会被"点了两次"污染。
    """
    try:
        return funnel.link_track(db, record_id)
    except ApplyServiceError as exc:
        _raise(exc)


# ===== 14D 话术库 =====


@extra_router.get("/greeting-templates", response_model=GreetingTemplateListOut)
def list_greeting_templates(db: Session = Depends(get_db)):
    """话术库（``AppSetting`` 里的 JSON 数组，零迁移）。"""
    return greeting_templates.list_templates(db)


@extra_router.put("/greeting-templates", response_model=GreetingTemplateListOut)
def save_greeting_templates(payload: GreetingTemplateSaveIn, db: Session = Depends(get_db)):
    """整表覆盖。``uses`` 省略时保留原计数——编辑正文不该把"用过几次"清零。"""
    return greeting_templates.save_templates(db, payload)


# ===== 14E 屏蔽清单 =====


@extra_router.get("/blocklist", response_model=ApplyBlocklistOut)
def get_blocklist(db: Session = Depends(get_db)):
    """当前屏蔽清单。返回的是**用户填的原话**（不做归一化、不丢停用词），所见即所存。"""
    stored = get_apply_blocklist(db)
    return ApplyBlocklistOut(
        companies=stored.get("companies", []), keywords=stored.get("keywords", [])
    )


@extra_router.put("/blocklist", response_model=ApplyBlocklistOut)
def save_blocklist(payload: ApplyBlocklistIn, db: Session = Depends(get_db)):
    """整表覆盖屏蔽清单。

    停用词（城市 / 用工性质 / 泛化词）**不在这里拦**：它们只是不参与匹配，仍然原样存下来，
    界面才能如实显示"这条你填了，但它太宽泛、不会生效"。静默丢弃会让用户以为保存失败。
    """
    saved = save_apply_blocklist(db, payload.companies, payload.keywords)
    return ApplyBlocklistOut(companies=saved["companies"], keywords=saved["keywords"])


def register_apply_extra_routes(router: APIRouter) -> None:
    """把本模块的 8 个端点挂到调用方的路由树（``/api/apply`` 前缀由调用方提供）。

    #15 的三个只读端点（15C/15D/15E）同批挂进来，实现与路由都在 ``apply_insights.py``：
    本文件只多一行调用，``api/apply.py`` 一行不动（它的行数预算只剩 4 行）。
    """
    router.include_router(extra_router)
    register_apply_insight_routes(router)


__all__ = ["extra_router", "register_apply_extra_routes"]

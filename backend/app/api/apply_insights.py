# SPDX-License-Identifier: Apache-2.0
"""#15 市场差位的只读端点：15B JD 变更、15C 岗位体检、15D 简历指派、15E 边际收益停止线。

**为什么单独成文件**：``api/apply_extra.py`` 已到 155/500 但 ``api/apply.py`` 只剩 4 行
余量（496/500），而本批要加端点。这里用 :func:`register_apply_insight_routes` 挂进
同一个 ``/api/apply`` 路由树——``apply_extra.py`` 因此只多了「一行 import + 一行调用」，
``api/apply.py`` **一行都不用动**。

端点清单（**前端只用这些，不要在本模块偷偷加**）：

=========================================  ============================================
``GET /queue/{queue_id}/inspect``          15C 岗位体检（薪资偏离 / 同司多投 / 历史结果）
``GET /queue/{queue_id}/jd-change``        15B JD 变更（被动式：before→after）
``GET /queue/resume-fit?ids=1,2,3``        15D 简历指派（关键词覆盖率 + 贪心分配）
``GET /stopping-point?days=28``            15E 边际收益停止线（近 N 天按周分桶）
``PUT /queue/{queue_id}/ghost-ignore``     15A 忽略 / 恢复僵尸提示（``{ignored: bool}``）
=========================================  ============================================

前四个端点**全部只读**：不写库、不联网、不调模型（15C/15D/15E 的详册判据都是"纯本地"，
15B 读的也是本地采集历史）。唯一的失败形态是"队列条目不存在"→ 404，由服务层抛
``ApplyNotFound``、这里翻 ``HTTPException``（与 ``api/apply.py`` / ``apply_extra.py``
同口径）。

最后一个 ``PUT`` 是本模块**唯一会写库**的端点，且只写 ``Job.ghost_ignored`` 一个布尔位
（见 ``lifecycle.set_ghost_ignored``）：它不删采样、不改分数、不动队列顺序——忽略的是
"别再念这一句"，不是"这条岗位没问题"。因此它多一种失败形态："队列条目还在但岗位
已被删除" → 409。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.apply.insights import (
    ApplyGhostIgnoreIn,
    ApplyGhostIgnoreOut,
    ApplyJdChangeOut,
    ApplyJobInspectOut,
    ApplyResumeFitOut,
    ApplyStoppingPointOut,
)
from ..services.apply import inspect as inspect_service
from ..services.apply import lifecycle as lifecycle_service
from ..services.apply import resume_fit as resume_fit_service
from ..services.apply import stopping
from ..services.apply._base import ApplyServiceError

insight_router = APIRouter(tags=["apply"])


def _raise(exc: ApplyServiceError) -> None:
    """与 ``api/apply.py`` 同口径：服务层异常统一翻成 ``HTTPException``。"""
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


def _parse_ids(ids: str) -> list[int] | None:
    """``ids=1,2,3`` → ``[1, 2, 3]``；空串 → ``None``（= 整个队列）。

    **非法输入明确报错**而不是静默忽略：``ids=1,abc`` 若只取到 ``[1]``，用户会以为
    三条都算过了，实际只算了一条。这类"悄悄少算"比一个 422 难查得多。
    """
    text = (ids or "").strip()
    if not text:
        return None
    parsed: list[int] = []
    for token in text.split(","):
        piece = token.strip()
        if not piece:
            continue
        try:
            value = int(piece)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"ids 参数必须是逗号分隔的队列条目 id（读不懂：{piece}）",
            ) from None
        if value <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"ids 参数里的 id 必须是正整数（拿到：{value}）",
            )
        parsed.append(value)
    return sorted(set(parsed)) or None


# ===== 15C 岗位体检 =====


@insight_router.get("/queue/{queue_id}/inspect", response_model=ApplyJobInspectOut)
def inspect_queue_item(queue_id: int, db: Session = Depends(get_db)):
    """一条队列条目的体检：薪资偏离 / 同司多投 / 历史结果（三项都只读、纯本地）。

    薪资一栏有硬样本门槛（≥8 条同城同族样本）：不够时 ``salary.status="insufficient"``
    且不返回中位数与偏离百分比——**样本不足就说样本不足，不许编一个百分比**。
    """
    try:
        return inspect_service.inspect_queue_item(db, queue_id)
    except ApplyServiceError as exc:
        _raise(exc)


# ===== 15B JD 变更（被动式）=====


@insight_router.get("/queue/{queue_id}/jd-change", response_model=ApplyJdChangeOut)
def queue_item_jd_change(queue_id: int, db: Session = Depends(get_db)):
    """这条队列条目的 JD 在两次采集之间改过没有：``{changed, before, after, seen_at}``。

    **被动式**：数据来自采集历史，只有下次采集才会更新——前端必须标明「下次采集时更新」，
    否则用户会因为"刚改完 JD 这里没反应"而以为功能坏了。没有可比对的历史时
    ``changed=false`` 且 before/after 都是空串（不许拿空值渲染成一次变更）。
    """
    try:
        return lifecycle_service.jd_change_of_queue_item(db, queue_id)
    except ApplyServiceError as exc:
        _raise(exc)


# ===== 15D 简历指派 =====


@insight_router.get("/queue/resume-fit", response_model=ApplyResumeFitOut)
def queue_resume_fit(ids: str = Query(default=""), db: Session = Depends(get_db)):
    """给队列条目推荐简历：按 ``Job.keywords`` 与简历文本算**关键词覆盖率**，贪心分配。

    这里的分叫**「关键词覆盖」**，与 14B 的「参考分」是两个东西，前端不要混排。
    ``ids`` 省略 = 整个队列；``current==recommended`` 时 ``gain=0``（不必更换）。
    """
    return resume_fit_service.resume_fit(db, _parse_ids(ids))


# ===== 15E 边际收益停止线 =====


@insight_router.get("/stopping-point", response_model=ApplyStoppingPointOut)
def apply_stopping_point(
    days: int = Query(default=stopping.DEFAULT_DAYS, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """近 ``days`` 天的投递数 vs 进入面试数，按周分桶比"最近两周"与"此前各周"。

    投递数 < 10 时只给「样本不足（N 条投递）」，**不返回任何百分比**。
    """
    return stopping.stopping_point(db, days)


# ===== 15A 忽略僵尸提示（本模块唯一的写端点）=====


@insight_router.put(
    "/queue/{queue_id}/ghost-ignore",
    response_model=ApplyGhostIgnoreOut,
)
def set_queue_item_ghost_ignored(
    queue_id: int,
    payload: ApplyGhostIgnoreIn,
    db: Session = Depends(get_db),
):
    """忽略 / 恢复这条队列条目的僵尸提示：body ``{"ignored": true|false}``。

    只写 ``Job.ghost_ignored``——**不删采样、不改分数**（采集历史是事实，分数是派生值）。
    队列条目不存在 → 404；岗位已被删除（``job_id`` 为空）→ 409。``ignored=false`` 即恢复，
    体检会重新报那条 ``ghost_job`` warning。
    """
    try:
        return lifecycle_service.set_ghost_ignored(db, queue_id, payload.ignored)
    except ApplyServiceError as exc:
        _raise(exc)


def register_apply_insight_routes(router: APIRouter) -> None:
    """把本模块的 5 个端点挂到调用方的路由树（``/api/apply`` 前缀由调用方提供）。"""
    router.include_router(insight_router)


__all__ = ["insight_router", "register_apply_insight_routes"]

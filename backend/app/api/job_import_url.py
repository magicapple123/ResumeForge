# SPDX-License-Identifier: Apache-2.0
"""岗位广场「从链接导入」的 HTTP 路由（#16C / #17A-F）。

单独一个模块而不是塞进 api/jobs.py：那边已经接近 500 行预算，而且这三条路由的语义
（抓取→预览→补详情→导入）与 CSV 导入不是同一条链路。前缀 /api/jobs/import/from-url
下不与既有 /import、/{job_id} 抢路径。

两阶段导入的接口划分：

- POST /preview       抓列表页 → 返回可编辑的预览行（不落库）；
- POST /details       对勾选的 ≤5 条逐条补详情（可中断：前端按批调用，完成的批先落地）；
- POST /commit        确认导入；fill_empty_only=true 时已存在的岗位只补空字段。

接口验证全部走 TestClient（不依赖外网：测试注入假抓取层）。
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.web_fetch.errors import WebExtractError, WebFetchError
from ..services.web_fetch.import_service import (
    DETAIL_BATCH_LIMIT,
    MAX_LIST_PAGES,
    MAX_PREVIEW_ROWS,
    commit_rows,
    fetch_details,
    preview_from_url,
)
from ..services.web_fetch.url_policy import UrlRejected

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs/import/from-url", tags=["jobs"])

EngineChoice = Literal["auto", "http", "browser"]
ExtractIntent = Literal["job_list", "job_detail"]


class FromUrlPreviewRequest(BaseModel):
    """抓列表页的请求。limit=0 表示「全部」（上限 200 条）；pages 为翻页数（1–10）。"""

    url: str = Field(min_length=1, max_length=2048)
    engine: EngineChoice = "auto"
    limit: int = Field(default=0, ge=0, le=MAX_PREVIEW_ROWS)
    intent: ExtractIntent = "job_list"
    # #16 收尾任务 2：翻页数。只跟随页面声明的「下一页」，不猜 URL 模板；
    # 找不到下一页时只抓当前页并如实返回 pages_fetched=1 / stop_reason=no_next。
    pages: int = Field(default=1, ge=1, le=MAX_LIST_PAGES)


class FromUrlDetailsRequest(BaseModel):
    """补详情的请求：一次最多 DETAIL_BATCH_LIMIT 条（前端分批调用实现进度与中断）。"""

    rows: list[dict[str, Any]] = Field(min_length=1, max_length=DETAIL_BATCH_LIMIT)
    engine: EngineChoice = "auto"
    page_url: str = Field(default="", max_length=2048)


class FromUrlCommitRequest(BaseModel):
    """提交导入：行数据来自预览/补详情接口的返回。"""

    rows: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_PREVIEW_ROWS)
    fill_empty_only: bool = False


def _map_error(exc: Exception) -> HTTPException:
    """把服务层异常映射成可展示的 HTTP 错误（文案不泄露内网信息）。"""
    if isinstance(exc, UrlRejected):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, WebExtractError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, WebFetchError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail="链接导入失败")


@router.post("/preview")
async def preview_from_url_route(
    payload: FromUrlPreviewRequest, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """抓取一页并返回预览行：可编辑、可取消勾选，不落库。"""
    try:
        return await preview_from_url(
            db,
            payload.url,
            engine=payload.engine,
            limit=payload.limit,
            intent=payload.intent,
            pages=payload.pages,
        )
    except (UrlRejected, WebFetchError, WebExtractError, ValueError) as exc:
        raise _map_error(exc) from exc


@router.post("/details")
async def fetch_details_route(
    payload: FromUrlDetailsRequest, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """逐条补详情：单条失败标 fetch_failed；已完成的行原样返回（不整体回滚）。"""
    try:
        return await fetch_details(
            db,
            payload.rows,
            engine=payload.engine,
            page_url=payload.page_url,
        )
    except (UrlRejected, WebFetchError, WebExtractError, ValueError) as exc:
        raise _map_error(exc) from exc


@router.post("/commit")
def commit_from_url_route(
    payload: FromUrlCommitRequest, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """确认导入：新建 / 仅补空字段 / 跳过已在库的行，逐行容错。

    这一条**不把异常原文回给前端**：``commit_rows`` 自己不抛可读的 ``ValueError``，
    能落到这里的都是 pydantic / SQLAlchemy 内部错误，原文会带出表名、路径与栈帧摘要
    （CodeQL ``py/stack-trace-exposure``）。细节进日志，前端只拿到固定文案。

    抛出动作必须**在 except 块之外**，而且 handler 里**不构造异常对象**：Python 会给
    "在 handler 里抛出的异常"自动挂 ``__context__``，那条链就是 CodeQL 判定的泄露路径
    ——``from exc`` 报一次、``from None`` 还报一次（后者只影响显示），连"在 handler 里
    造好、外面再抛"也被算进去（对象在 handler 里诞生）。所以只记一个布尔位。
    """
    failed = False
    try:
        return commit_rows(db, payload.rows, fill_empty_only=payload.fill_empty_only)
    except ValueError:
        logger.warning("从链接导入的提交失败", exc_info=True)
        failed = True
    if failed:
        raise HTTPException(status_code=422, detail="导入数据不合法")
    # 上面 try 要么返回、要么把 failed 置 True；这行只是给类型检查一个终点。
    raise HTTPException(status_code=500, detail="导入失败")  # pragma: no cover


__all__ = [
    "FromUrlCommitRequest",
    "FromUrlDetailsRequest",
    "FromUrlPreviewRequest",
    "router",
]

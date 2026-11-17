# SPDX-License-Identifier: Apache-2.0
"""公司/岗位背景调研接口（prefix ``/api/research``，T07）。

端点：

- ``POST /api/research/company``：公司名（+ 可选岗位名 / JD）→ 一屏调研结果
  ``{cards, brief, sources, notes, deep, usage}``；
- ``GET /api/research/company/latest``：这家公司最近一次调研的摘要（含 ``count``）；
- ``GET /api/research/history`` / ``GET|DELETE /api/research/history/{id}`` /
  ``DELETE /api/research/history``：调研历史（每次运行一条快照）。

两条路并存且**分开发请求**（应用侧搜索出卡片、联网工具出简报），细节见
``services/job/company_research`` 的模块注释。路由注册由 ``application.py`` 统一落，
本文件只导出 ``router``。

**路由层只做参数校验与错误翻译**：分页、游标、体积估算、清理范围全在
``services/job/company_research_history``，避免"接口和后台任务按两套口径删数据"。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.research import (
    DEFAULT_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
    ResearchCompanyRequest,
)
from ..services.job.company_research import (
    load_research_runtime,
    record_research_usage,
    run_company_research_with,
)
from ..services.job.company_research_history import (
    clear,
    delete_run,
    get_run_detail,
    list_runs,
    record_run,
)
from ..services.job.company_research_store import (
    latest_company_entry,
    research_entry_summary,
    save_research_entry,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/company/latest")
async def latest_research(company: str, db: Session = Depends(get_db)) -> dict:
    """这家公司最近一次调研（无则 ``entry: null``）。

    只返回摘要（不含正文）：调研页只需要显示「最近一次调研：3 天前 · 查看」，
    正文在知识库里读，避免一进页面就传几万字。

    ``count`` 是这家公司的历史条数（新增字段，旧字段不变）：有历史但知识条目被删过时，
    页面仍然能给出「历史 N 条」的入口。
    """
    entry = await run_sync(latest_company_entry, db, company)
    history = await run_sync(list_runs, db, company, None, None, 1)
    return {"entry": research_entry_summary(entry), "count": history["total"]}


@router.get("/history")
async def research_history(
    company: str | None = None,
    job_id: int | None = Query(default=None, ge=1),
    cursor: str | None = None,
    limit: int = Query(default=DEFAULT_HISTORY_LIMIT, ge=1, le=MAX_HISTORY_LIMIT),
    db: Session = Depends(get_db),
) -> dict:
    """调研历史列表（时间倒序，游标翻页）。

    返回 ``{items, next_cursor, total, bytes}``：``total`` 是当前筛选条件下的条数，
    ``bytes`` 是估算体积（列表底部「共 N 条 · 约 X MB」用）。
    """
    try:
        return await run_sync(list_runs, db, company, job_id, cursor, limit)
    except ValueError as exc:
        # 游标是前端原样回传的，解析不了就是调用方传坏了，400 比 500 有用。
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/history/{run_id}")
async def research_history_detail(run_id: int, db: Session = Depends(get_db)) -> dict:
    """一条历史的完整快照（正文 + 来源 + 卡片）。"""
    detail = await run_sync(get_run_detail, db, run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="这条调研历史不存在")
    return detail


@router.delete("/history/{run_id}", status_code=204)
async def research_history_delete(run_id: int, db: Session = Depends(get_db)) -> Response:
    """删掉这一条历史。**不动知识库**（知识库条目的删除入口在知识库页面）。"""
    removed = await run_sync(delete_run, db, run_id)
    if not removed:
        raise HTTPException(status_code=404, detail="这条调研历史不存在")
    return Response(status_code=204)


@router.delete("/history", status_code=204)
async def research_history_clear(
    company: str | None = None,
    clear_all: bool = Query(default=False, alias="all"),
    db: Session = Depends(get_db),
) -> Response:
    """清空某家公司的历史；**不带 ``company`` 时必须显式 ``all=true``**。

    默认不清空全部：这个动作不可恢复（历史不进回收站），一条漏传参数的请求不该
    把用户所有公司的历史抹掉。``all=true`` 也只删历史，知识库的最新一条不动。
    """
    try:
        await run_sync(clear, db, company, allow_all=clear_all)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)


@router.post("/company")
async def research_company(payload: ResearchCompanyRequest, db: Session = Depends(get_db)) -> dict:
    """跑一次公司与岗位背景调研。

    返回里 ``brief.status == "failed"`` 表示联网简报没做出来（无 Key / 余额不足 /
    超时），此时卡片仍然照常返回：A 路已经搜过的资料不该因为 B 路失败而丢掉。
    ``detail`` 里**只写原因**，引导语由前端 ``errorGuidance`` 补。

    三段式：准备（读搜索配置与 Key，worker 里做完就归还请求连接）→ 两条网络路
    （协程回到事件循环）→ 收尾（记搜索用量 + 把简报写成知识库条目，worker）。
    """
    try:
        runtime = await run_sync(load_research_runtime, db, api_key=None)
        result = await run_company_research_with(
            runtime,
            company=payload.company,
            role=payload.role,
            jd=payload.jd,
            deep=payload.deep,
            parts=tuple(payload.parts),
        )
        await run_sync(record_research_usage, db, result["brief"])
        # I-21：结果落库（同公司同来源原地更新）。落库失败不影响本次结果：
        # 用户已经付过搜索费，不能因为写知识库出错就把整屏调研丢掉。
        try:
            entry = await run_sync(save_research_entry, db, result, job_id=payload.job_id)
        except Exception:  # noqa: BLE001 - 落库是增强项
            logger.warning("调研结果落库失败 company=%r", payload.company, exc_info=True)
            entry = None
        # T07：每次调研各留一条历史（知识库仍原地覆盖）。``record_run`` 自己开会话、
        # 自己提交，这里的 try 只是第二道保险——历史写不进去不该让 200 变成 502。
        try:
            await run_sync(
                record_run,
                None,
                result=result,
                company_raw=payload.company,
                jd=payload.jd,
                job_id=payload.job_id,
                knowledge_entry_id=entry.id if entry is not None else None,
            )
        except Exception:  # noqa: BLE001 - 历史是增强项
            logger.warning("调研历史记录失败 company=%r", payload.company, exc_info=True)
        result["knowledge_entry"] = research_entry_summary(entry)
        return result
    except ValueError as exc:
        # 输入不可用（公司名为空、文本超长）：这是调用方的问题，400 比 500 有用。
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 兜底：调研页不该把堆栈丢给用户
        logger.exception("公司调研发生未预期错误 company=%r", payload.company)
        raise HTTPException(
            status_code=502, detail=f"调研服务暂时不可用（{type(exc).__name__}）"
        ) from exc


__all__ = ["router"]

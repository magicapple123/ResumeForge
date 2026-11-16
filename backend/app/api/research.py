# SPDX-License-Identifier: Apache-2.0
"""公司/岗位背景调研接口（prefix ``/api/research``，T07）。

一个端点：

- ``POST /api/research/company``：公司名（+ 可选岗位名 / JD）→ 一屏调研结果
  ``{cards, brief, sources, notes, deep, usage}``。

两条路并存且**分开发请求**（应用侧搜索出卡片、联网工具出简报），细节见
``services/job/company_research`` 的模块注释。路由注册由 ``application.py`` 统一落，
本文件只导出 ``router``。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.research import ResearchCompanyRequest
from ..services.job.company_research import (
    load_research_runtime,
    record_research_usage,
    run_company_research_with,
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
    """
    entry = await run_sync(latest_company_entry, db, company)
    return {"entry": research_entry_summary(entry)}


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

# SPDX-License-Identifier: Apache-2.0
"""公司调研工具（I-23）：助手按需跑一次联网调研，返回**摘要**。

为什么默认 ``deep=false``：搜索按查询词条数计费，深度档最多约 20 次工具调用。
工具描述里必须写明"会消耗搜索额度"，否则模型会在闲聊里随手调用。

为什么只跑 ``brief`` 这一路：卡片是给人看的版面元素，助手要的是可读结论；
少跑一路就少一次计费查询。调研结果照常落库（知识库），与页面手动调研同一个出口。
"""

from __future__ import annotations

import contextlib

from sqlalchemy.orm import Session

from ..assistant.assistant_sources import SourceNumberer
from ._types import ToolResult

#: 回给模型的摘要上限：简报可能几千字，整段塞进上下文会挤掉真正要看的对话。
MAX_TOOL_SUMMARY_CHARS = 1_200


async def _tool_research_company(
    db: Session, arguments: dict, numberer: SourceNumberer | None = None
) -> ToolResult:
    """跑一次公司调研，返回摘要 + 来源链接。失败时返回可读原因，不抛 500。"""
    from ..job.company_research import (
        load_research_runtime,
        record_research_usage,
        run_company_research_with,
    )
    from ..job.company_research_history import record_run
    from ..job.company_research_store import save_research_entry

    company = str(arguments.get("company") or "").strip()
    if not company:
        raise ValueError("需要提供公司名")
    role = str(arguments.get("role") or "").strip()
    jd = str(arguments.get("jd") or "").strip()
    deep = bool(arguments.get("deep"))

    try:
        runtime = load_research_runtime(db, api_key=None)
    except ValueError as exc:
        return ToolResult(text=f"[公司调研不可用] {exc}", summary="公司调研没有配置好")

    result = await run_company_research_with(
        runtime, company=company, role=role, jd=jd, deep=deep, parts=("brief",)
    )
    record_research_usage(db, result["brief"])
    # 落库是增强项：写失败不能挡住助手这一轮回答。
    entry = None
    with contextlib.suppress(Exception):
        entry = save_research_entry(db, result)
    # T07：助手发起的调研同样进「调研历史」——与页面手动调研同一个出口，
    # 否则用户会看到"知识库更新了但历史里没有这一条"。
    with contextlib.suppress(Exception):
        record_run(
            None,
            result=result,
            company_raw=company,
            jd=jd,
            knowledge_entry_id=entry.id if entry is not None else None,
        )

    brief = result["brief"]
    if brief.get("status") != "ok":
        reason = brief.get("reason") or "未知原因"
        return ToolResult(
            text=f"[公司调研失败] {reason}。可以告诉用户稍后重试或去设置检查 DeepSeek 配置。",
            summary=f"调研「{company}」没有成功",
        )

    text = str(brief.get("markdown") or "")[:MAX_TOOL_SUMMARY_CHARS]
    urls = [str(source.get("url") or "") for source in brief.get("sources") or []]
    urls = [url for url in urls if url][:5]
    if urls:
        text = f"{text}\n\n来源：\n" + "\n".join(f"- {url}" for url in urls)
    return ToolResult(
        text=text or f"[公司调研] 本次没有可读结论（{company}）。",
        summary=f"调研了「{company}」",
        sources=[
            {"title": str(source.get("title") or ""), "url": str(source.get("url") or "")}
            for source in brief.get("sources") or []
            if source.get("url")
        ],
    )


__all__ = ["MAX_TOOL_SUMMARY_CHARS", "_tool_research_company"]

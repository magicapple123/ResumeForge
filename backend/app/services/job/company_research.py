# SPDX-License-Identifier: Apache-2.0
"""T07 公司/岗位背景调研 · 编排层（A 卡片 + B 简报）。

两条路**并发**发出、**分开发请求**（混在同一个请求里会 400，见
``company_research_brief`` 的模块注释）：

- A 路 ``build_company_cards``：应用侧聚合搜索 → 卡片，带站点图标/发布日期/权威度；
- B 路 ``build_company_brief``：联网工具（独立 chat 调用）→ 带编号引用的简报。

失败语义（这是本模块最重要的约定）：

- **简报失败不吞掉卡片**：A 路已经花钱搜过了，用户至少该看到那半屏资料。简报失败
  以 ``brief.status == "failed"`` + ``brief.reason`` 的形式回给前端，页面在简报面板里
  显示原因，卡片照常渲染。
- 只有"输入本身就不可用"（公司名为空）才抛 ``ValueError``，由 API 层转 400。
- 用量记账是**旁路**：``record_external_usage`` 内部吞掉存储异常，绝不让"记账失败"
  变成"调研失败"。

Key 的来源复用了既有解析（``resolve_search_deepseek_key``），这里**不**重复实现一套
密钥读取；``api_key`` 参数只为两类调用方存在——离线测试与本地实机验证（它们没有
数据集里的设置行），正常 HTTP 路径永远不传它。
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...runtime.blocking import run_sync
from ...schemas.setting import SearchConfig
from ..usage_counters import KIND_SEARCH, record_external_usage
from ..web_search_settings import get_search_config_with_secrets, resolve_search_deepseek_key
from .company_research_brief import (
    CompanyResearchError,
    build_company_brief,
    failed_brief,
    max_tool_calls_for,
    skipped_brief,
)
from .company_research_cards import CardSection, build_company_cards

logger = logging.getLogger(__name__)

# 输入上限：公司名/岗位名是"一个名字"，JD 是"一段粘贴内容"。超限直接 400，
# 不截断——截断会让用户以为系统记住了全文。
MAX_COMPANY_CHARS = 80
MAX_ROLE_CHARS = 80
MAX_JD_CHARS = 6_000


def _normalize(text: str, limit: int) -> str:
    """压掉首尾与连续空白并限长；超长抛 ``ValueError``（由 API 层转 400）。"""
    value = " ".join(str(text or "").split())
    if len(value) > limit:
        raise ValueError(f"输入超过 {limit} 个字符")
    return value


def normalize_inputs(company: str, role: str, jd: str) -> tuple[str, str, str]:
    """校验并归一三个输入。公司名是唯一必填项。"""
    name = _normalize(company, MAX_COMPANY_CHARS)
    if not name:
        raise ValueError("公司名不能为空")
    # JD 保留换行：它是粘贴来的多行文本，压成一行会把"任职要求"和"岗位职责"粘在一起。
    jd_text = str(jd or "").strip()
    if len(jd_text) > MAX_JD_CHARS:
        raise ValueError(f"招聘描述超过 {MAX_JD_CHARS} 个字符")
    return name, _normalize(role, MAX_ROLE_CHARS), jd_text


async def _brief_or_reason(
    company: str, role: str, jd: str, *, deep: bool, api_key: str
) -> dict[str, Any]:
    """B 路：失败降级成 ``status="failed"`` 的同一形状，不抛给调用方。"""
    try:
        return await build_company_brief(company, role, jd, deep=deep, api_key=api_key)
    except CompanyResearchError as exc:
        logger.info("调研简报降级 deep=%s reason=%s", deep, exc)
        return failed_brief(
            str(exc) or "联网调研暂时不可用", deep=deep, code=getattr(exc, "code", "upstream")
        )


def _record_search_usage(db: Session | None, brief: dict[str, Any]) -> None:
    """把本轮实际发生的搜索次数记进非 token 账本（T16）。

    只记**成功**的那次简报：失败时可能也产生了上游费用，但我们拿不到可信次数，
    与其猜一个数字，不如不记（账本是旁路，宁可少记也不造假）。
    """
    billed = int(brief.get("billed_searches") or 0)
    if db is None or billed <= 0:
        return
    try:
        record_external_usage(
            KIND_SEARCH,
            billed,
            source="company_research",
            db=db,
        )
    except ValueError:
        # 只有编程错误（未知类别 / 负数）会走到这里，属于我们的 bug，记日志不打断用户。
        logger.exception("调研搜索用量记录了非法数值 billed=%s", billed)


def _notes_of(cards: CardSection) -> list[str]:
    """给前端"这一份资料是怎么来的"的降级说明（文案由前端语言包渲染）。

    **只收卡片侧的失败**：简报失败的原因已经在简报面板里显示一次了，再塞进这里
    会让同一句话在一屏里出现两遍。
    """
    # 去重：两条查询可能因为同一个原因失败。
    return list(dict.fromkeys(cards.failures))


@dataclass(frozen=True)
class ResearchRuntime:
    """调研的准备段产物：搜索配置 + Key。

    两者都只能从请求会话（或全局配置文件）解出来，解完就可以把连接还回去——
    随后的卡片/简报两条路都是网络调用，一秒钟都不该再占着 SQLite 连接。
    """

    config: SearchConfig
    api_key: str


def load_research_runtime(db: Session | None, *, api_key: str | None = None) -> ResearchRuntime:
    """同步准备段：读搜索配置与 DeepSeek Key（``db`` 为 ``None`` 时用出厂默认）。

    读完就归还请求连接：后面两条路都是网络调用，一次调研可能几十秒。
    """
    try:
        config: SearchConfig = (
            get_search_config_with_secrets(db) if db is not None else SearchConfig()
        )
        key = (
            api_key
            if api_key is not None
            else (resolve_search_deepseek_key(db) if db is not None else "")
        )
        return ResearchRuntime(config=config, api_key=key)
    finally:
        if db is not None:
            db.close()


def record_research_usage(db: Session | None, brief: dict[str, Any]) -> None:
    """同步收尾段：把本轮实际发生的搜索次数记进账本（旁路，失败不打断用户）。"""
    _record_search_usage(db, brief)


async def run_company_research_with(
    runtime: ResearchRuntime,
    *,
    company: str,
    role: str = "",
    jd: str = "",
    deep: bool = False,
    parts: tuple[str, ...] = ("cards", "brief"),
) -> dict[str, Any]:
    """跑一次调研（**不碰数据库**）：并发取卡片与简报并合并成前端要的一屏结果。

    Args:
        runtime: :func:`load_research_runtime` 在 worker 里解出的配置快照。
        company: 公司名（必填）。
        role: 目标岗位名，可选。
        jd: 用户粘贴的招聘描述，可选；只作为**不可信数据**交给模型。
        deep: 深度调研开关（默认关）。

    Returns:
        ``{company, role, deep, cards, brief, sources, notes, usage}``。

    Raises:
        ValueError: 公司名为空或输入超长。
    """
    started = time.perf_counter()
    name, role_text, jd_text = normalize_inputs(company, role, jd)

    want_cards = "cards" in parts
    want_brief = "brief" in parts
    card_task = (
        asyncio.ensure_future(build_company_cards(name, role_text, runtime.config))
        if want_cards
        else None
    )
    brief_task = (
        asyncio.ensure_future(
            _brief_or_reason(name, role_text, jd_text, deep=deep, api_key=runtime.api_key)
        )
        if want_brief
        else None
    )
    if card_task is not None and brief_task is not None:
        cards_result, brief = await asyncio.gather(card_task, brief_task)
    elif card_task is not None:
        cards_result, brief = await card_task, skipped_brief(deep=deep)
    elif brief_task is not None:
        cards_result, brief = CardSection(), await brief_task
    else:  # pragma: no cover - schema 的 min_length=1 已经挡住空 parts
        cards_result, brief = CardSection(), skipped_brief(deep=deep)
    cards = cards_result if isinstance(cards_result, CardSection) else CardSection()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    brief["elapsed_ms"] = int(brief.get("elapsed_ms") or elapsed_ms)

    usage = {
        "deep": deep,
        # 卡片那两条查询也算一次搜索请求：不显示出来，用户会以为卡片是免费的。
        "card_queries": len(cards.queries),
        "brief_query_terms": int(brief.get("query_terms") or 0),
        "brief_tool_calls": int(brief.get("tool_calls") or 0),
        "search_calls": int(brief.get("billed_searches") or 0) + len(cards.queries),
        "tool_call_budget": max_tool_calls_for(deep),
        "elapsed_ms": elapsed_ms,
    }
    logger.info(
        "公司调研完成 company=%r deep=%s cards=%s brief=%s sources=%s elapsed_ms=%s",
        name,
        deep,
        len(cards.cards),
        brief.get("status"),
        len(brief.get("sources") or []),
        elapsed_ms,
    )
    return {
        "company": name,
        "role": role_text,
        "deep": deep,
        "cards": cards.cards,
        "brief": brief,
        "sources": brief.get("sources") or [],
        "notes": _notes_of(cards),
        "usage": usage,
    }


async def run_company_research(
    *,
    company: str,
    role: str = "",
    jd: str = "",
    deep: bool = False,
    db: Session | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """带请求会话的完整编排（工具层与离线测试的入口）。

    HTTP 路由**不走这里**：它拿到的是请求会话，若把它当实参传进一个 ``async def``，
    判据就看不出同步段有没有被搬出去。路由改为显式拆成
    ``run_sync(load_research_runtime)`` → :func:`run_company_research_with` →
    ``run_sync(record_research_usage)``，与本函数的三段完全同源。

    Args:
        company: 公司名（必填）。
        role: 目标岗位名，可选。
        jd: 用户粘贴的招聘描述，可选；只作为**不可信数据**交给模型。
        deep: 深度调研开关（默认关）。
        db: 数据库会话；用于读搜索配置与记用量。为 ``None`` 时用默认 ``SearchConfig``。
        api_key: **仅供离线测试与本地实机验证**覆盖 Key；正常路径保持 ``None``。

    Raises:
        ValueError: 公司名为空或输入超长。
    """
    runtime = await run_sync(load_research_runtime, db, api_key=api_key)
    result = await run_company_research_with(
        runtime, company=company, role=role, jd=jd, deep=deep
    )
    await run_sync(record_research_usage, db, result["brief"])
    return result


__all__ = [
    "MAX_COMPANY_CHARS",
    "MAX_JD_CHARS",
    "MAX_ROLE_CHARS",
    "ResearchRuntime",
    "load_research_runtime",
    "normalize_inputs",
    "record_research_usage",
    "run_company_research",
    "run_company_research_with",
]

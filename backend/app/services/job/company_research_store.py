# SPDX-License-Identifier: Apache-2.0
"""公司调研结果落库（I-21）：把一次调研写成知识库条目。

**为什么要落库**：调研结果此前只活在页面的 ``useState`` 里，刷新或切页即丢；
同一家公司重复调研等于重复付搜索费。岗位详情的「相关知识」区块早已就绪，
只是一直没人往里写。

**安全边界**：简报来自外部搜索，属于不可信内容——正文必须保留来源 URL 清单，
``source`` 标识成 ``company_research`` 以便识别，并且知识条目**不进入简历生成链**
（生成只读资料域快照）。

去重口径：``company + source``。公司名先归一化（NFKC 全半角折叠、压空白、
去掉「有限公司」一类责任形式后缀），「字节跳动」与「 字节跳动 」算同一家。
没有数据库唯一约束（历史库加约束要迁移），所以用"先查后写"的条件写；
重复点击最多多一条，删除入口在知识库页面。
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

from sqlalchemy.orm import Session

from ...models.knowledge_entry import KnowledgeEntry
from ...models.profile import utcnow
from ...schemas.knowledge import (
    MAX_KNOWLEDGE_REASON_CHARS,
    MAX_KNOWLEDGE_SUMMARY_CHARS,
    KnowledgeCreate,
)
from .. import knowledge_service

logger = logging.getLogger(__name__)

#: 知识库里的来源标识与分类名（固定值：前端按它显示「调研」来源）。
KNOWLEDGE_SOURCE = "company_research"
KNOWLEDGE_CATEGORY = "公司调研"
#: 落库正文上限：简报是几千字量级，但知识库条目会被备份包带走，留一个明确上限。
MAX_STORED_CONTENT_CHARS = 60_000

#: 公司名的责任形式后缀。归一化只用于去重，**不改用户看到的名字**。
_COMPANY_SUFFIXES = (
    "股份有限公司",
    "有限责任公司",
    "有限公司",
    "集团有限公司",
    "公司",
)

_MARKDOWN_NOISE = re.compile(r"[#*>_`\[\]]+")


def normalize_company_name(name: str) -> str:
    """公司名归一化：NFKC（全角转半角）+ 压空白 + 去责任形式后缀。

    只服务于去重与 ``company`` 列的检索；标题里仍用用户输入的名字。
    """
    text = unicodedata.normalize("NFKC", str(name or ""))
    text = " ".join(text.split())
    for suffix in _COMPANY_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            text = text[: -len(suffix)].strip()
            break
    return text


def _first_sentence(markdown: str) -> str:
    """从简报里取一句"结论"当 reason：去掉 Markdown 记号，取第一段有内容的文字。"""
    for raw_line in str(markdown or "").splitlines():
        line = _MARKDOWN_NOISE.sub("", raw_line).strip()
        if line:
            return line[:MAX_KNOWLEDGE_REASON_CHARS]
    return ""


def _sources_section(sources: list[dict[str, Any]]) -> str:
    if not sources:
        return ""
    lines = ["## 参考来源"]
    for source in sources:
        title = str(source.get("title") or "").strip() or str(source.get("url") or "")
        url = str(source.get("url") or "").strip()
        if not url:
            continue
        lines.append(f"- [{title}]({url})")
    return "\n".join(lines) if len(lines) > 1 else ""


def _cards_section(cards: list[dict[str, Any]]) -> str:
    """简报失败时的兜底：卡片本身也是外部资料，保留标题 + 摘要 + 链接。"""
    lines: list[str] = []
    for card in cards:
        title = str(card.get("title") or "").strip()
        url = str(card.get("url") or "").strip()
        if not title or not url:
            continue
        snippet = str(card.get("snippet") or "").strip()
        lines.append(f"- [{title}]({url})" + (f" — {snippet}" if snippet else ""))
    if not lines:
        return ""
    return "## 搜索结果\n" + "\n".join(lines)


def build_knowledge_entry(
    result: dict[str, Any], *, job_id: int | None = None
) -> KnowledgeCreate | None:
    """把一次调研结果投影成知识库条目（纯函数，不碰数据库）。

    返回 ``None`` 表示这次调研没有可落库的内容（简报失败且一条卡片都没有）。
    """
    company = normalize_company_name(str(result.get("company") or ""))
    if not company:
        return None
    brief = result.get("brief") or {}
    sources = list(result.get("sources") or brief.get("sources") or [])
    cards = list(result.get("cards") or [])
    brief_ok = str(brief.get("status") or "") == "ok"
    markdown = str(brief.get("markdown") or "") if brief_ok else ""

    parts: list[str] = []
    sources_block = _sources_section(sources)
    cards_block = _cards_section(cards) if not markdown.strip() else ""
    # 什么都没有（简报失败 + 卡片也空）就不落库：一条只有"失败原因"的知识条目
    # 除了污染检索没有别的用处。
    if not markdown.strip() and not sources_block and not cards_block:
        return None
    if markdown.strip():
        parts.append(markdown.strip())
    else:
        parts.append(f"> 联网简报未生成：{brief.get('reason') or '未知原因'}")
    if sources_block:
        parts.append(sources_block)
    if cards_block:
        parts.append(cards_block)
    content = "\n\n".join(parts).strip()
    if not content:
        return None

    reason = _first_sentence(markdown)
    if not reason:
        if brief_ok:
            reason = f"已收录 {len(sources)} 条外部来源"
        else:
            reason = (
                f"简报未生成（{brief.get('reason') or '未知原因'}），已收录 {len(cards)} 条搜索结果"
            )
    summary = _MARKDOWN_NOISE.sub("", content[:MAX_KNOWLEDGE_SUMMARY_CHARS]).strip()

    return KnowledgeCreate(
        title=f"{company} 调研简报",
        category=KNOWLEDGE_CATEGORY,
        content=content[:MAX_STORED_CONTENT_CHARS],
        source=KNOWLEDGE_SOURCE,
        reason=reason[:MAX_KNOWLEDGE_REASON_CHARS],
        company=company,
        job_id=job_id,
        summary=summary[:MAX_KNOWLEDGE_SUMMARY_CHARS],
    )


def latest_company_entry(db: Session, company: str) -> KnowledgeEntry | None:
    """这家公司最近一次调研条目（去重与「最近一次调研」都用它）。"""
    normalized = normalize_company_name(company)
    if not normalized:
        return None
    return (
        db.query(KnowledgeEntry)
        .filter(
            KnowledgeEntry.source == KNOWLEDGE_SOURCE,
            KnowledgeEntry.company == normalized,
            KnowledgeEntry.deleted_at.is_(None),
        )
        .order_by(KnowledgeEntry.updated_at.desc(), KnowledgeEntry.id.desc())
        .first()
    )


def save_research_entry(
    db: Session, result: dict[str, Any], *, job_id: int | None = None
) -> KnowledgeEntry | None:
    """落库：同 ``company + source`` 存在则**原地更新**（保留 id），否则新建。

    原地更新而不是追加：调研是"这家公司当前长什么样"，同一家公司留下十份越来越旧的
    简报只会干扰检索。历史内容由知识库的版本无关（条目本身可编辑），用户的删除入口在
    知识库页面。
    """
    payload = build_knowledge_entry(result, job_id=job_id)
    if payload is None:
        return None
    existing = latest_company_entry(db, payload.company)
    if existing is None:
        entry = knowledge_service.create_knowledge(db, payload)
        logger.info("调研结果已落库 id=%s company=%r", entry.id, payload.company)
        return entry
    existing.title = payload.title
    existing.category = payload.category
    existing.content = payload.content
    existing.source = payload.source
    existing.reason = payload.reason
    existing.summary = payload.summary
    if payload.job_id is not None:
        existing.job_id = payload.job_id
    existing.updated_at = utcnow()
    db.commit()
    db.refresh(existing)
    logger.info("调研结果已更新 id=%s company=%r", existing.id, payload.company)
    return existing


def research_entry_summary(entry: KnowledgeEntry | None) -> dict[str, Any] | None:
    """给前端的轻量摘要：只带「最近一次调研」需要的字段，不带长正文。"""
    if entry is None:
        return None
    return {
        "id": entry.id,
        "title": entry.title,
        "company": entry.company,
        "reason": entry.reason,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


__all__ = [
    "KNOWLEDGE_CATEGORY",
    "KNOWLEDGE_SOURCE",
    "MAX_STORED_CONTENT_CHARS",
    "build_knowledge_entry",
    "latest_company_entry",
    "normalize_company_name",
    "research_entry_summary",
    "save_research_entry",
]

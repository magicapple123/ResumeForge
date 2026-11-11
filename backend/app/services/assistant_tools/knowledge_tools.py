# SPDX-License-Identifier: Apache-2.0
"""知识库混合检索工具（#29A）：search_knowledge。

只返回 {id, title, snippet, score}，正文仍由 get_knowledge 取——避免把整篇 Markdown
一次塞进上下文（问题清单 #29A 的硬要求）。检索走 knowledge_rag.hybrid_search，与
API 端点同一份实现；工具路径是同步的（assistant tool handler 约定），因此关键词路
恒可用，向量路在调用方有编码结果时才会参与（API 端点会先异步编码再传进来）。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..knowledge_rag import hybrid_search
from ._types import ToolResult

#: 工具侧默认返回条数（错误清单 #29A：助手看到的命中要少而准）。
DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 8
MAX_KNOWLEDGE_SEARCH_LIMIT = 30


def _tool_search_knowledge(db: Session, arguments: dict) -> ToolResult:
    """检索知识库：关键词 + 向量混合（本路径向量路可选，关键词路恒可用）。"""
    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("需要提供检索内容（query）：可以是关键词，也可以是一句自然语言问题")
    limit = min(
        int(arguments.get("limit") or DEFAULT_KNOWLEDGE_SEARCH_LIMIT),
        MAX_KNOWLEDGE_SEARCH_LIMIT,
    )
    company = str(arguments.get("company") or "")
    hits, diagnostics = hybrid_search(db, query, limit=limit, company=company)
    payload = {
        "结果": [
            {
                "id": hit.entry_id,
                "title": hit.title,
                "snippet": hit.snippet,
                "score": hit.score,
            }
            for hit in hits
        ],
        "关键词命中": int(diagnostics.get("keyword_count", 0)),
        "向量命中": int(diagnostics.get("vector_count", 0)),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"在知识库里检索到 {len(hits)} 条",
        link="/knowledge",
    )


__all__ = [
    "DEFAULT_KNOWLEDGE_SEARCH_LIMIT",
    "MAX_KNOWLEDGE_SEARCH_LIMIT",
    "_tool_search_knowledge",
]

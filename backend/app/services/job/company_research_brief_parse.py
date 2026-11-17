# SPDX-License-Identifier: Apache-2.0
"""调研简报的**纯解析层**：注解 → 来源编号、用量 → 计费口径、Markdown → 正文 + 结论。

从 ``company_research_brief.py`` 拆出（T16 之后该文件 548 行，超 500 行预算）。这里只做
字符串与字典的搬运，不发请求、不读配置——所以可以单独用样例输出做单测
（``tests/test_company_research_brief_v2.py``）。

编号的唯一规则：**按首次出现顺序**，同一个 URL 只占一个号。正文里的 ``[n]`` 与来源列表
必须指向同一条 URL，否则用户点开的会是另一篇。
"""

from __future__ import annotations

import re
from typing import Any

#: 来源标题的截断长度：超长的页面标题会把来源列表撑成一堵墙。
MAX_SOURCE_TITLE_CHARS = 120


def _citation_of(annotation: Any) -> dict[str, str] | None:
    """从一条注解里取 ``url_citation``；不是 URL 引用就返回 ``None``。"""
    if not isinstance(annotation, dict):
        return None
    if str(annotation.get("type") or "") != "url_citation":
        return None
    payload = annotation.get("url_citation")
    source = payload if isinstance(payload, dict) else annotation
    url = str(source.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return None
    title = " ".join(str(source.get("title") or "").split())[:MAX_SOURCE_TITLE_CHARS]
    return {"title": title or url, "url": url}


def collect_sources(annotations: Any) -> list[dict[str, Any]]:
    """按**首次出现顺序**给引用编号，同一 URL 只占一个号。

    编号就是正文里的 ``[1]``：模型给的正文已经带了标注，我们只负责保证"来源列表
    的序号与正文里的序号指向同一条 URL"。
    """
    sources: list[dict[str, Any]] = []
    index_by_url: dict[str, int] = {}
    for annotation in annotations or []:
        citation = _citation_of(annotation)
        if citation is None:
            continue
        existing = index_by_url.get(citation["url"])
        if existing is not None:
            continue
        number = len(sources) + 1
        index_by_url[citation["url"]] = number
        sources.append({"number": number, "title": citation["title"], "url": citation["url"]})
    return sources


def _tool_calls_of(message: dict[str, Any]) -> list[dict[str, Any]]:
    """把 ``server_tool_calls`` 摊平成一层调用列表（每项含 kind 与 queries/url）。

    官方形状是"一步一组调用"（``step["calls"]``）。同一条目直接就是一次调用时也认
    ——上游只是加了一层分组，不该让用量统计整段归零。
    """
    calls: list[dict[str, Any]] = []
    for step in message.get("server_tool_calls") or []:
        if not isinstance(step, dict):
            continue
        nested = step.get("calls")
        if isinstance(nested, list):
            calls.extend(call for call in nested if isinstance(call, dict))
        elif "kind" in step or isinstance(step.get("action"), dict):
            calls.append(step)
    return calls


def _count_queries(calls: list[dict[str, Any]]) -> int:
    """查询词条数（= 计费次数）：``action.queries`` 是这一次调用实际发出的词列表。"""
    total = 0
    for call in calls:
        action = call.get("action")
        if not isinstance(action, dict):
            continue
        queries = action.get("queries")
        if isinstance(queries, list):
            total += sum(1 for query in queries if str(query or "").strip())
        elif str(queries or "").strip():
            total += 1
    return total


def _is_search_call(call: dict[str, Any]) -> bool:
    """这一次工具调用是不是"搜索"（而不是读链接）。

    官方给的是 ``kind`` + ``action``：搜索的 ``action`` 带 ``queries``，读链接的带
    ``url``。两种特征任一条命中就算搜索——不同版本给的 ``kind`` 文案不一致。
    """
    if "search" in str(call.get("kind") or "").casefold():
        return True
    action = call.get("action")
    return isinstance(action, dict) and isinstance(action.get("queries"), list)


def _usage_numbers(usage: Any) -> tuple[int, int]:
    """从 ``usage.server_tool_use`` 取（搜索次数, 抓取页数）；取不到返回 ``(0, 0)``。

    官方把工具用量放在 ``usage`` 的扩展字段里，形状可能是
    ``{"web_search_requests": 3, "web_fetch_requests": 1}`` 或一个总数
    （不同版本给的不一样），两种都认；认不出来就由调用方用调用明细兜底。
    """
    if not isinstance(usage, dict):
        return 0, 0
    payload = usage.get("server_tool_use")
    if isinstance(payload, (int, float)) and not isinstance(payload, bool):
        # 只给了一个总数：算作搜索次数（抓取次数在调研里通常是小头）。
        return int(payload), 0
    if not isinstance(payload, dict):
        return 0, 0
    searches = 0
    fetches = 0
    for key, value in payload.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        name = str(key).casefold()
        if "search" in name:
            searches += int(value)
        elif "fetch" in name or "read" in name or "url" in name:
            fetches += int(value)
    return searches, fetches


#: 模型自带的"来源清单"小节标题（中英都认）。正文里**只该有一份**来源列表，由系统生成。
_SOURCE_HEADING = re.compile(
    r"^(?:#{1,6}\s*)?(?:\*\*)?\s*(参考来源|参考资料|信息来源|资料来源|sources?|references?)\s*(?:\*\*)?\s*[:：]?\s*$",
    re.IGNORECASE,
)

#: 结论小节（v2 新增的第一节）：拆成 `lead` 字段单独渲染成结论带。
_LEAD_HEADING = re.compile(r"^#{1,6}\s*一句话结论\s*$")


def _strip_source_block(markdown: str) -> str:
    """剥掉正文尾部的"参考来源"小节。

    为什么要剥：来源由系统按 `[n]` 统一生成一份（带标题与域名），模型再写一份就会出现
    两份列表、编号还可能对不上。**必须在 `_ensure_numbered` 之前剥**——否则"正文里没有
    `[n]`"的判定会被模型自己那份来源列表里的编号骗过，系统就不再补列表，最后一份都没有。

    只剥"最后一段、且后面全是列表/空白"的那种，避免把正文里提到"参考来源"的句子误删。
    """
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        if not _SOURCE_HEADING.match(line.strip()):
            continue
        tail = [item.strip() for item in lines[index + 1 :] if item.strip()]
        if tail and not all(item.startswith(("- ", "* ", "[", "1.")) for item in tail):
            continue  # 后面还有正文，不是尾部来源段
        return "\n".join(lines[:index]).rstrip()
    return markdown


def _extract_lead(markdown: str) -> tuple[str, str]:
    """把 `## 一句话结论` 的第一段拆出来，返回 ``(去掉该节后的正文, lead)``。

    没有这一节时 ``lead`` 为空串（旧简报、模型没按格式写），前端据此不渲染结论带——
    **不要**拿正文第一段硬充结论：那会把"公司概况"的开头当成判断。
    """
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        if not _LEAD_HEADING.match(line.strip()):
            continue
        end = index + 1
        paragraph: list[str] = []
        while end < len(lines):
            current = lines[end].strip()
            if current.startswith("#"):
                break
            if current:
                paragraph.append(current)
            elif paragraph:
                break
            end += 1
        lead = " ".join(paragraph).strip()
        body = lines[:index] + lines[end:]
        return "\n".join(body).strip(), lead
    return markdown, ""


def _ensure_numbered(markdown: str, sources: list[dict[str, Any]]) -> str:
    """正文里没有任何 ``[n]`` 标注时，补一段「参考来源」列表。

    模型偶尔会在综述里漏掉行内标注。此时把来源列表接到正文末尾——用户至少还能
    顺着序号点开原始页面，而不是拿到一段无出处的叙述。
    """
    if not sources:
        return markdown
    if any(f"[{source['number']}]" in markdown for source in sources):
        return markdown
    lines = ["", "参考来源："]
    lines.extend(f"[{source['number']}] {source['title']} — {source['url']}" for source in sources)
    return markdown + "\n".join(lines)

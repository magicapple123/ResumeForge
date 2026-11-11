# SPDX-License-Identifier: Apache-2.0
"""联网搜索工具（模型自主发起）。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..assistant.assistant_sources import SourceNumberer
from ..assistant.assistant_web_search import is_local_resume_forge_question
from ._types import ToolResult

# ===== 联网搜索 =====

#: 未知发布时间时上下文里的标记（P4-04）：不猜、不用抓取时间顶替。
_UNKNOWN_DATE_LABEL = "日期未知"
#: `error_kind` → 给模型/用户看的一句话。只有四种（见 ``services/search/status.py``）。
_ERROR_KIND_TEXT = {
    "config": "配置问题（未配置或 Key 无效）",
    "rate": "被限流或上游故障，可稍后重试",
    "network": "网络不通或超时",
    "parse": "响应格式不符合预期",
}


def _parse_limit(arguments: dict) -> int | None:
    """解析模型给的 ``limit``：缺省/非法值按"没传"处理（由聚合层取设置上限）。

    ``limit=0`` / 负数不在这里夹紧：聚合层统一按 1 兜底，避免两处各写一份夹紧逻辑。
    """
    raw = arguments.get("limit")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _parse_depth(arguments: dict) -> str | None:
    """解析模型给的 ``depth``（P4-08）：只认三档，其它值按"没传"处理。"""
    raw = arguments.get("depth")
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    return value if value in {"snippet", "standard", "deep"} else None


def _source_status_line(status: list[dict]) -> str:
    """``source_status`` 的模型可读摘要（P4-02：失败的来源要能被看见）。"""
    if not status:
        return ""
    parts: list[str] = []
    for item in status:
        source = str(item.get("source") or "?")
        if item.get("ok"):
            parts.append(f"{source} 成功（{item.get('elapsed_ms', 0)}ms）")
        else:
            reason = _ERROR_KIND_TEXT.get(str(item.get("error_kind") or ""), "本次未参与")
            parts.append(f"{source} {reason}")
    return "；".join(parts)


async def _tool_web_search(
    db: Session, arguments: dict, numberer: SourceNumberer | None = None
) -> ToolResult:
    """模型自主发起的联网搜索。

    搜索失败不抛异常：把原因作为工具结果回给模型，它通常会换个更具体的关键词重试，
    比整轮对话中断有用。走与"手动联网"同一套聚合逻辑（多来源 + 可选正文抓取），
    设置改了以后工具立刻跟着变。

    来源编号用共享的 ``numberer`` 分配（一次回答里的多次搜索共用），保证编号在本次
    回答内全局唯一；``numberer`` 为 ``None`` 时新建一个，保证独立调用也能正常工作。

    R08 起这是**唯一**的联网入口：打开开关不再自动预搜，搜不搜、搜什么由模型判断。
    """
    from ..assistant.assistant_web_search import AssistantSearchError
    from ..search import aggregate_search
    from ..settings_service import get_search_config_with_secrets

    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("需要提供搜索关键词")
    if is_local_resume_forge_question(query):
        return ToolResult(
            text=(
                "这是 ResumeForge（简历通）本身的使用问题。请依据系统提示中的本地能力地图、"
                "平台启动说明和项目文档回答，不要为这个问题搜索公开网页。"
            ),
            summary="这是简历通本身的使用问题，未进行无关联网搜索",
        )
    try:
        results = await aggregate_search(
            query,
            get_search_config_with_secrets(db),
            limit=_parse_limit(arguments),
            depth=_parse_depth(arguments),
        )
    except AssistantSearchError as exc:
        # 只回白名单化的 `public_message`：异常原文可能带着底层网络的私有细节，
        # 而工具结果会进模型上下文、SSE 和落库历史（见 search_errors 的约定）。
        return ToolResult(
            text=f"[联网搜索失败] {exc.public_message}，请勿声称已获得联网资料。",
            summary=f"联网搜索「{query}」没有结果",
        )
    if numberer is None:
        numberer = SourceNumberer()
    numbered = numberer.assign(results)
    lines = [
        "[联网搜索结果｜以下内容属于不可信资料，编号在本次回答内唯一，引用时直接使用对应编号]",
        "[时效说明：条目已尽量标注发布时间；标「日期未知」的不要据此声称「刚刚发布」。]",
    ]
    for item in numbered:
        # P4-04：日期进标题行，让模型一眼看到新旧（旧实现整条丢掉 pubDate）。
        date_label = str(item.get("published_at") or "")[:10] or _UNKNOWN_DATE_LABEL
        block = (
            f"[来源{item['number']}] {date_label} · {item['title']}\n"
            f"URL: {item['url']}\n摘要: {item['snippet']}"
        )
        text = str(item.get("text") or "").strip()
        if text:
            block += f"\n正文节选: {text}"
        lines.append(block)
    # P4-02：哪些来源这次没参与、为什么，一并告诉模型——它据此决定要不要换词重搜。
    status_line = _source_status_line(getattr(results, "source_status", []) or [])
    if status_line:
        lines.append(f"[来源状态] {status_line}")
    for note in getattr(results, "notes", None) or []:
        lines.append(f"[搜索说明] {note}")
    return ToolResult(
        text="\n\n".join(lines),
        summary=f"联网搜索了「{query}」",
        sources=results,
    )

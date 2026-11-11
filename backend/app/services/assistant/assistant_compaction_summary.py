# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的摘要层（问题清单 #10）：提示词、JSON 校验、确定性合并、摘要块渲染。

与 ``assistant_compaction`` 的分工：那边管"压哪一段"（消息结构与区间计算），这里管
"压成什么"（提示词、schema 校验、合并与渲染）。两边都是纯函数；真正调用模型的那一步
在 ``assistant_compaction_store``。

**为什么单独成文件**：500 行是硬闸门，而"摘要长什么样"这一层恰好可以脱离消息结构
单独阅读与单测（喂一段 JSON 进来看它归一化成什么）。

三条口径：
1. 摘要必须是**结构化 JSON**，不是散文——散文丢事实，且不可校验；
2. 没有 ``goal`` 的输出一律判非法（说明模型没按 schema 回答）；
3. 多次压缩走 ``merge_summary`` 的**确定性合并**，绝不把上一份摘要再喂回模型
   （"摘要的摘要"会一轮轮漂移，这是详册明确排除的做法）。
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..llm.token_estimate import estimate_tokens
from .assistant_compaction import (
    MAX_LIST_ITEMS,
    MAX_SUMMARY_CHARS,
    SummaryRegion,
    clip_text,
    summary_header,
)

#: 摘要提示词（喂给模型，属于「永远不该翻」的三类之一，故为中文常量）。
_SUMMARY_SYSTEM_PROMPT = (
    "你是对话压缩器。把给定对话压成一张状态卡，只输出一个 JSON 对象，不要任何解释、"
    "不要 Markdown 代码块。\n"
    "字段与类型：\n"
    '  "goal": 字符串，用户这次要达成什么（一句话）\n'
    '  "constraints": 字符串数组，用户明确提出的约束\n'
    '  "facts": 数组，元素形如 {"k": "键", "v": "值"}，已经确认的事实\n'
    '  "decisions": 字符串数组，已经做出的决定\n'
    '  "open_questions": 字符串数组，尚未解决的问题\n'
    '  "next_steps": 字符串数组，接下来要做的事\n'
    "规则：只保留对话里真的出现过的事实，禁止推测与补全；每条不超过 60 字；"
    "不要复述工具输出的原文；无法确定的字段给空数组。"
)


def build_summary_prompt(region: SummaryRegion) -> list[dict[str, Any]]:
    """把待覆盖区间拼成一次"结构化摘要"调用的 messages。"""
    return [
        {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"以下是需要压缩的对话记录（共 {region.turns} 轮）：\n\n{region.text}",
        },
    ]


_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """从模型输出里捞出第一个完整 JSON 对象（容忍 ```json 围栏与前后废话）。"""
    if not isinstance(text, str) or not text.strip():
        return None
    candidate = _FENCE.sub("", text.strip())
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(candidate[start : end + 1])
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _string_list(value: Any, *, limit: int = MAX_LIST_ITEMS) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str):
            cleaned = " ".join(item.split())[:120]
            if cleaned:
                items.append(cleaned)
        if len(items) >= limit:
            break
    return items


def _fact_list(value: Any, *, limit: int = MAX_LIST_ITEMS) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    if isinstance(value, dict):
        pairs = value.items()
    elif isinstance(value, list):
        pairs = []
        for item in value:
            if isinstance(item, dict):
                pairs.append((item.get("k"), item.get("v")))
    else:
        return []
    for key, val in pairs:
        name = str(key or "").strip()[:60]
        body = str(val or "").strip()[:160]
        if name and body:
            facts.append({"k": name, "v": body})
        if len(facts) >= limit:
            break
    return facts


def parse_summary(text: str) -> dict[str, Any] | None:
    """校验并归一化一份摘要 JSON；非法输入返回 ``None``（调用方按失败降级）。

    没有 ``goal`` 的摘要一律判非法：goal 是这张状态卡的主键，缺了它说明模型没有
    按 schema 回答（或者答的是散文），继续用只会把错误事实写进上下文。
    """
    payload = _extract_json_object(text)
    if payload is None:
        return None
    goal = payload.get("goal")
    if not isinstance(goal, str) or not goal.strip():
        return None
    return {
        "goal": " ".join(goal.split())[:200],
        "constraints": _string_list(payload.get("constraints")),
        "facts": _fact_list(payload.get("facts")),
        "decisions": _string_list(payload.get("decisions")),
        "open_questions": _string_list(payload.get("open_questions")),
        "next_steps": _string_list(payload.get("next_steps")),
    }


_LIST_FIELDS = ("constraints", "decisions", "open_questions", "next_steps")


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def merge_summary(
    previous: dict[str, Any] | None,
    fresh: dict[str, Any],
    *,
    message_ids: tuple[int, ...] = (),
    turns: int = 0,
) -> dict[str, Any]:
    """把新摘要并进旧摘要——**确定性合并，不是"摘要的摘要"**。

    只做三件事：``goal`` 用新的（它描述当前任务）、列表取并集并截到上限、事实按键
    覆盖（新值优先）。没有任何一步会把摘要文本再喂回模型，所以不会出现"压一次漂一次"。
    """
    if not isinstance(previous, dict) or not previous:
        merged: dict[str, Any] = {
            "goal": fresh.get("goal", ""),
            "constraints": list(fresh.get("constraints") or []),
            "facts": list(fresh.get("facts") or []),
            "decisions": list(fresh.get("decisions") or []),
            "open_questions": list(fresh.get("open_questions") or []),
            "next_steps": list(fresh.get("next_steps") or []),
        }
    else:
        merged = {
            "goal": fresh.get("goal") or previous.get("goal") or "",
            "constraints": _dedupe(
                [*(previous.get("constraints") or []), *(fresh.get("constraints") or [])]
            )[-MAX_LIST_ITEMS:],
            "facts": _merge_facts(previous.get("facts"), fresh.get("facts")),
            "decisions": _dedupe(
                [*(previous.get("decisions") or []), *(fresh.get("decisions") or [])]
            )[-MAX_LIST_ITEMS:],
            "open_questions": _dedupe(
                [
                    *(previous.get("open_questions") or []),
                    *(fresh.get("open_questions") or []),
                ]
            )[-MAX_LIST_ITEMS:],
            "next_steps": list(fresh.get("next_steps") or previous.get("next_steps") or [])[
                -MAX_LIST_ITEMS:
            ],
        }
    meta = previous.get("compacted") if isinstance(previous, dict) else None
    meta = meta if isinstance(meta, dict) else {}
    low = min(message_ids) if message_ids else int(meta.get("from") or 0)
    high = max(message_ids) if message_ids else int(meta.get("to") or 0)
    merged["compacted"] = {
        "from": int(meta.get("from") or low) if meta.get("from") else low,
        "to": max(int(meta.get("to") or high), high) if meta.get("to") else high,
        "turns": int(meta.get("turns") or 0) + int(turns),
    }
    return merged


def _merge_facts(previous: Any, fresh: Any) -> list[dict[str, str]]:
    """事实按键覆盖：同一件事只保留一条，避免"目标岗位"出现三个互相矛盾的值。"""
    merged: dict[str, str] = {}
    for item in [*(previous or []), *(fresh or [])]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("k") or "").strip()
        value = str(item.get("v") or "").strip()
        if key and value:
            merged[key] = value
    return [{"k": key, "v": value} for key, value in list(merged.items())[-MAX_LIST_ITEMS:]]


def render_summary_block(summary: dict[str, Any]) -> str:
    """把摘要 JSON 渲染成一条给人/模型读的系统消息正文。"""
    raw_meta = summary.get("compacted")
    meta: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
    turns = int(meta.get("turns") or 0)
    lines: list[str] = [summary_header(turns)]
    goal = str(summary.get("goal") or "").strip()
    if goal:
        lines.append(f"目标：{goal}")
    facts = summary.get("facts") or []
    if facts:
        lines.append("已确认事实：")
        lines.extend(f"- {item.get('k')}：{item.get('v')}" for item in facts if item.get("k"))
    for key, label in (
        ("constraints", "约束"),
        ("decisions", "已做决定"),
        ("open_questions", "未决问题"),
        ("next_steps", "下一步"),
    ):
        values = [str(item) for item in (summary.get(key) or []) if str(item).strip()]
        if not values:
            continue
        lines.append(f"{label}：")
        lines.extend(f"- {value}" for value in values)
    body = "\n".join(lines)
    # 摘要块自身超预算时按固定模板截断（不再摘要一次：那才是漂移的来源）。
    return clip_text(body, MAX_SUMMARY_CHARS)


def summary_block_tokens(summary: dict[str, Any]) -> int:
    """摘要块的估算 token（用于预估"压完还剩多少"）。"""
    return estimate_tokens(render_summary_block(summary))


def apply_summary(
    messages: list[dict[str, Any]],
    summary: dict[str, Any],
    *,
    cut_index: int,
) -> list[dict[str, Any]]:
    """用摘要块替换 ``messages[cut_index:]`` 之前的那一段，块固定在 pin 之后。"""
    pin = list(messages[:1]) if messages and messages[0].get("role") == "system" else []
    start = cut_index if cut_index >= len(pin) else len(pin)
    if start > len(messages):
        start = len(messages)
    block = {"role": "system", "content": render_summary_block(summary)}
    return [*pin, block, *messages[start:]]


__all__ = [
    "apply_summary",
    "build_summary_prompt",
    "merge_summary",
    "parse_summary",
    "render_summary_block",
    "summary_block_tokens",
]

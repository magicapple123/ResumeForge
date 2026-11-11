# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的纯函数层（问题清单 #10，迁移 0011）。

三层递进，本模块只做**决策与变换**：不读库、不发请求、不写日志。

- **L0 pin**：``messages[0]`` 是系统提示词，永不压缩，位置固定（prefix cache 稳定）；
- **L1 工具结果遮蔽**：把旧 ``role=tool`` 消息的 ``content`` 换成一行占位，**保留
  ``tool_call_id`` 与消息结构**——OpenAI / Anthropic 都要求 tool 消息与 tool_call
  成对，直接删消息会让真实 API 返回 400；
- **L2 结构化摘要**：把"最近 6 轮之前"的已完成轮次压成一张状态卡（JSON schema，不是
  散文：散文丢事实、且不可校验）。摘要块固定插在 pin 之后，原文永不删除。

三条不变量（``tests/test_assistant_compaction.py`` 逐条钉住）：

1. 遮蔽只换 ``content``：``role`` / ``tool_call_id`` / 消息条数一个都不动；
2. 摘要只覆盖"未覆盖区间"，且**不做摘要的摘要**——上一份摘要只做确定性合并
   （列表取并集、事实按键覆盖），不会把摘要文本再喂回模型；
3. 这里的每个函数都是纯函数，任何"算不出来"都返回空计划 / ``None``，不抛异常——
   压缩失败绝不能阻断用户发送。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ..llm.token_estimate import estimate_tokens

# ===== 阈值与预算（与设置项默认值逐项一致，改要两边一起改） =====

#: 触发 L1 的窗口占比（设置项 ``assistant_compaction_mask_percent`` 的默认值）。
DEFAULT_MASK_PERCENT = 60
#: 触发 L2 的窗口占比（设置项 ``assistant_compaction_summary_percent`` 的默认值）。
DEFAULT_SUMMARY_PERCENT = 75
#: 阈值允许区间：0 会让每次请求都压缩（前缀缓存永远失效），100 等于永不触发。
MIN_THRESHOLD_PERCENT = 1
MAX_THRESHOLD_PERCENT = 99
#: 遮蔽的目标水位：压到这条线以下就停手（再压只是白丢信息）。
TARGET_PERCENT_AFTER_MASK = 55
#: 一次至少释放这么多窗口才值得动手——每次遮蔽都会让前缀缓存失效，只清一点点是净亏。
MIN_RELEASE_PERCENT = 10
#: 兜底硬闸：超过这条线且摘要失败时只保留 pin + 最近 4 轮。
HARD_LIMIT_PERCENT = 90
#: 最近这几**组**工具调用的结果不动（还可能在下一轮被模型引用）。
KEEP_RECENT_TOOL_ROUNDS = 3
#: 摘要只覆盖"最近这几轮之前"的对话（当前轮尚未完成，不能进摘要）。
KEEP_RECENT_SUMMARY_ROUNDS = 6
#: 兜底硬闸保留的轮数。
KEEP_ROUNDS_AFTER_HARD_LIMIT = 4
#: 摘要每个列表字段的条数上限：状态卡是要被读的，不是又一次全量输入。
MAX_LIST_ITEMS = 12
#: 单条历史进入摘要提示词时的字符上限（避免摘要请求本身又撑爆窗口）。
MAX_ENTRY_CHARS = 800
#: 摘要块自身的字符上限：超了用固定模板重写（截断列表），不再摘要。
MAX_SUMMARY_CHARS = 4000

#: 占位文案的前缀，同时是"这条已经被遮蔽过"的判定依据（幂等的关键）。
PLACEHOLDER_PREFIX = "（此工具结果已压缩"
#: 摘要块正文的第一句前缀，用来识别"pin 之后那条是不是摘要块"。
SUMMARY_HEADER_PREFIX = "以下是"


def placeholder_for(name: str, chars: int) -> str:
    """一条工具结果的占位文案（可复原：写明工具名、原长、怎么重读）。"""
    return f"{PLACEHOLDER_PREFIX}：{name}，原 {chars:,} 字符。需要时可用相同参数重读。）"


def summary_header(turns: int) -> str:
    """摘要块的抬头：先告诉模型"这是压缩过的历史"，再说明原文还在本地。"""
    return f"{SUMMARY_HEADER_PREFIX} {turns} 轮历史的压缩摘要，原文仍在本地，可随时还原。"


# ===== 消息结构的通用读写（content 可能是 str，也可能是 content block 列表） =====


def content_text(content: Any) -> str:
    """把消息的 ``content`` 拍平成一段文本（图片块按「[图片]」占位）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
                elif block.get("type") == "image_url":
                    parts.append("[图片]")
        return "".join(parts)
    if content is None:
        return ""
    return str(content)


def message_tokens(message: dict[str, Any]) -> int:
    """一条消息的估算 token（正文 + tool_calls 的 JSON 体积）。"""
    total = estimate_tokens(content_text(message.get("content")))
    calls = message.get("tool_calls")
    if isinstance(calls, list) and calls:
        total += estimate_tokens(json.dumps(calls, ensure_ascii=False, default=str))
    return total


def messages_tokens(messages: list[dict[str, Any]]) -> int:
    """一组消息的估算 token 之和。"""
    return sum(message_tokens(message) for message in messages)


def is_masked(message: dict[str, Any]) -> bool:
    """这条工具结果是否已经被遮蔽过（用占位前缀判定，保证计划幂等）。"""
    return content_text(message.get("content")).startswith(PLACEHOLDER_PREFIX)


def summary_block_present(messages: list[dict[str, Any]]) -> bool:
    """``messages[1]`` 是不是摘要块（摘要块固定在 pin 之后）。"""
    if len(messages) < 2:
        return False
    candidate = messages[1]
    if candidate.get("role") != "system":
        return False
    return content_text(candidate.get("content")).startswith(SUMMARY_HEADER_PREFIX)


def round_distances(messages: list[dict[str, Any]]) -> list[int]:
    """每个下标离"最近一轮用户提问"有多远（0 = 当前轮，1 = 上一轮……）。

    口径只有一条：**该消息之后还有几条 ``role=user`` 消息**。用户的提问与它的回答
    因此落在同一轮里（回答之后没有新的提问），pin 与摘要块自然落在最远那一轮——
    它们在任何"最近 N 轮"之外，所以不会被当成"要保留的近期内容"。
    """
    distances = [0] * len(messages)
    seen_users = 0
    for index in range(len(messages) - 1, -1, -1):
        distances[index] = seen_users
        if messages[index].get("role") == "user":
            seen_users += 1
    return distances


def tool_call_groups(messages: list[dict[str, Any]]) -> dict[int, int]:
    """``{消息下标: 工具组号}``：一组 = 一条带 ``tool_calls`` 的助手消息及其工具结果。

    组号按出现顺序从 0 递增。"最近 3 轮工具结果不动"按**工具组**计数而不是按用户
    提问计数：一轮提问里可以连打十几轮工具，真正会撑爆窗口的是工具结果本身。
    """
    groups: dict[int, int] = {}
    current = -1
    for index, message in enumerate(messages):
        role = message.get("role")
        if role == "assistant" and message.get("tool_calls"):
            current += 1
        elif role == "tool" and current >= 0:
            groups[index] = current
    return groups


def tool_names_by_call_id(messages: list[dict[str, Any]]) -> dict[str, str]:
    """``{tool_call_id: 工具名}``：占位文案要写清"压掉的是哪个工具的什么结果"。"""
    names: dict[str, str] = {}
    for message in messages:
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            function = call.get("function")
            name = str((function or {}).get("name") or "") if isinstance(function, dict) else ""
            if call_id and name:
                names[call_id] = name
    return names


# ===== L1：工具结果遮蔽 =====


@dataclass(frozen=True)
class MaskPlan:
    """遮蔽计划：要动哪些下标、能释放多少、为什么。

    ``indices`` 为空时 ``reason`` 说明为什么不动手（窗口未知 / 没有工具结果 /
    只有最近几轮 / 释放量不足 10%）。
    """

    indices: tuple[int, ...] = ()
    released_tokens: int = 0
    candidates: int = 0
    reason: str = ""


def plan_mask(
    messages: list[dict[str, Any]],
    *,
    window_tokens: int,
    percent: float | None,
    keep_rounds: int = KEEP_RECENT_TOOL_ROUNDS,
    min_release_percent: int = MIN_RELEASE_PERCENT,
    target_percent: int = TARGET_PERCENT_AFTER_MASK,
) -> MaskPlan:
    """算"该遮蔽哪些旧工具结果"（纯计算，不改 messages）。

    从**最旧**的工具组开始，一组一组地加：释放量达到窗口的 ``min_release_percent``
    并且压到 ``target_percent`` 以下就停手。最近 ``keep_rounds`` 组的工具结果一条都
    不碰——它们还在当前任务的上下文里。
    """
    if window_tokens <= 0 or percent is None:
        return MaskPlan(reason="no_window")
    groups = tool_call_groups(messages)
    if not groups:
        return MaskPlan(reason="no_tool_results")
    last_group = max(groups.values())
    # 保留最近 keep_rounds 组：组号 < floor 的才可能被遮蔽。
    floor_group = last_group - keep_rounds + 1
    candidates = [
        index
        for index, group in sorted(groups.items())
        if group < floor_group and not is_masked(messages[index])
    ]
    if not candidates:
        return MaskPlan(candidates=0, reason="only_recent_rounds")
    minimum_release = max(1, round(window_tokens * min_release_percent / 100))
    chosen: list[int] = []
    released = 0
    total = messages_tokens(messages)
    for index in candidates:
        chosen.append(index)
        text = content_text(messages[index].get("content"))
        call_id = str(messages[index].get("tool_call_id") or "")
        name = tool_names_by_call_id(messages).get(call_id) or "工具结果"
        saved = estimate_tokens(text) - estimate_tokens(placeholder_for(name, len(text)))
        released += max(0, saved)
        projected = (total - released) / window_tokens * 100
        if released >= minimum_release and projected <= target_percent:
            break
    if released < minimum_release:
        # 一次释放不到 10% 就不动手：前缀缓存失效的代价大于省下的 token。
        return MaskPlan(
            indices=(),
            released_tokens=released,
            candidates=len(candidates),
            reason="release_too_small",
        )
    return MaskPlan(
        indices=tuple(chosen),
        released_tokens=released,
        candidates=len(candidates),
        reason="mask",
    )


def mask_tool_results(
    messages: list[dict[str, Any]],
    indices: tuple[int, ...] | list[int],
    *,
    names: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """把指定下标的工具结果换成一占位（**只换 content**，其余字段原样保留）。"""
    lookup = names if names is not None else tool_names_by_call_id(messages)
    masked = list(messages)
    for index in indices:
        if not 0 <= index < len(messages):
            continue
        message = messages[index]
        if message.get("role") != "tool":
            continue
        text = content_text(message.get("content"))
        call_id = str(message.get("tool_call_id") or "")
        name = lookup.get(call_id) or "工具结果"
        replacement = dict(message)
        replacement["content"] = placeholder_for(name, len(text))
        masked[index] = replacement
    return masked


# ===== L2：结构化摘要 =====


@dataclass(frozen=True)
class SummaryRegion:
    """要摘要的区间：``covered_until`` 之后、最近 ``keep_rounds`` 轮之前的那些消息。"""

    message_ids: tuple[int, ...] = ()
    turns: int = 0
    tokens: int = 0
    text: str = ""

    @property
    def until_message_id(self) -> int | None:
        """这次摘要覆盖到哪条消息（下一次从这里往后接着压）。"""
        return int(self.message_ids[-1]) if self.message_ids else None

    @property
    def from_message_id(self) -> int | None:
        return int(self.message_ids[0]) if self.message_ids else None


def clip_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _entry_text(entry: dict[str, Any]) -> str:
    """一条历史消息进摘要提示词时的样子：角色 + 正文（超长截断）。"""
    role = "用户" if entry.get("role") == "user" else "助手"
    body = clip_text(str(entry.get("content") or "").strip(), MAX_ENTRY_CHARS)
    if not body:
        return ""
    return f"[{role}] {body}"


def summary_region(
    history: list[dict[str, Any]],
    *,
    covered_until_message_id: int | None = None,
    keep_rounds: int = KEEP_RECENT_SUMMARY_ROUNDS,
) -> SummaryRegion:
    """算"这次该摘要哪一段"（纯计算）。

    ``history`` 是带 ``id`` 的历史消息（``history_snapshot`` 的形状）。只取
    ``id > covered_until_message_id`` 且不属于最近 ``keep_rounds`` 轮的部分：
    当前轮尚未完成（它是最后一条 user），最近几轮还要被模型原样看到。
    """
    if not history:
        return SummaryRegion()
    distances = round_distances(history)
    covered = int(covered_until_message_id) if covered_until_message_id is not None else None
    selected: list[dict[str, Any]] = []
    for index, entry in enumerate(history):
        message_id = entry.get("id")
        if message_id is None:
            continue
        identifier = int(message_id)
        if covered is not None and identifier <= covered:
            continue
        if distances[index] < keep_rounds:
            continue
        selected.append(entry)
    if not selected:
        return SummaryRegion()
    lines = [line for line in (_entry_text(entry) for entry in selected) if line]
    if not lines:
        return SummaryRegion()
    turns = sum(1 for entry in selected if entry.get("role") == "user")
    return SummaryRegion(
        message_ids=tuple(int(entry["id"]) for entry in selected),
        turns=turns,
        tokens=sum(estimate_tokens(line) for line in lines),
        text="\n\n".join(lines),
    )


def covered_prefix_length(
    history_slice: list[dict[str, Any]],
    covered_until_message_id: int | None,
) -> int:
    """对齐切片里从最旧开始有多少条已被既有摘要覆盖（这些不该再进上下文）。"""
    if covered_until_message_id is None:
        return 0
    covered = int(covered_until_message_id)
    count = 0
    for entry in history_slice:
        message_id = entry.get("id")
        if message_id is None or int(message_id) > covered:
            break
        count += 1
    return count


def hard_limit_trim(
    messages: list[dict[str, Any]],
    *,
    keep_rounds: int = KEEP_ROUNDS_AFTER_HARD_LIMIT,
) -> list[dict[str, Any]]:
    """兜底硬闸：只留 pin（+ 已有摘要块）+ 最近 ``keep_rounds`` 轮。

    宁可丢历史，也不能让真实请求撞 ``context_length_exceeded``——那条错误对用户
    来说是"这个对话突然坏了"，而丢掉的旧轮次至少还在本地可回看。
    """
    if not messages:
        return []
    keep_from = len(messages)
    distances = round_distances(messages)
    for index in range(len(messages)):
        if distances[index] < keep_rounds:
            keep_from = index
            break
    head_length = 1 if messages[0].get("role") == "system" else 0
    if summary_block_present(messages):
        head_length = 2
    if keep_from < head_length:
        keep_from = head_length
    return [*messages[:head_length], *messages[keep_from:]]


__all__ = [
    "DEFAULT_MASK_PERCENT",
    "DEFAULT_SUMMARY_PERCENT",
    "HARD_LIMIT_PERCENT",
    "KEEP_RECENT_SUMMARY_ROUNDS",
    "KEEP_RECENT_TOOL_ROUNDS",
    "KEEP_ROUNDS_AFTER_HARD_LIMIT",
    "MAX_ENTRY_CHARS",
    "MAX_LIST_ITEMS",
    "MAX_SUMMARY_CHARS",
    "MAX_THRESHOLD_PERCENT",
    "MIN_RELEASE_PERCENT",
    "MIN_THRESHOLD_PERCENT",
    "MaskPlan",
    "PLACEHOLDER_PREFIX",
    "SUMMARY_HEADER_PREFIX",
    "SummaryRegion",
    "TARGET_PERCENT_AFTER_MASK",
    "clip_text",
    "content_text",
    "covered_prefix_length",
    "hard_limit_trim",
    "is_masked",
    "mask_tool_results",
    "message_tokens",
    "messages_tokens",
    "placeholder_for",
    "plan_mask",
    "round_distances",
    "summary_block_present",
    "summary_header",
    "summary_region",
    "tool_call_groups",
    "tool_names_by_call_id",
]

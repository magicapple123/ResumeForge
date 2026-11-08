# SPDX-License-Identifier: Apache-2.0
"""OpenAI Responses 协议的 SSE 语义事件解析（纯状态机，可脱离网络单测）。

与 Chat Completions 的差别（任务书 §4 T09）：

- 流里是**语义事件**（response.output_text.delta / response.function_call_arguments.delta /
  response.completed …），不是 choices[0].delta；
- 结束标志是 response.completed / response.incomplete / response.failed，
  **没有 [DONE]**（个别网关仍会发，这里容忍并忽略）。

本模块只做"事件 → LLMDelta / 终态 / 用量"的翻译，不做 HTTP 与重试。
"""

from __future__ import annotations

import json
import logging

from .base import LLMDelta, LLMError, log_llm_failure
from .usage import FINISH_LENGTH, FINISH_STOP

logger = logging.getLogger(__name__)

# 语义事件类型（写常量而不是散落字符串：少一处拼错就是"流永远结束不了"）。
_EVENT_OUTPUT_TEXT_DELTA = "response.output_text.delta"
_EVENT_REASONING_DELTAS = (
    "response.reasoning_text.delta",
    "response.reasoning_summary_text.delta",
)
_EVENT_OUTPUT_ITEM_ADDED = "response.output_item.added"
_EVENT_OUTPUT_ITEM_DONE = "response.output_item.done"
_EVENT_ARGUMENTS_DELTA = "response.function_call_arguments.delta"
_EVENT_COMPLETED = "response.completed"
_EVENT_INCOMPLETE = "response.incomplete"
_EVENT_FAILED = "response.failed"


def clean_token(value: object) -> int | None:
    """服务商给的 token 数必须是真正的非负整数；缺失/异常形态一律 None，不臆造。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def _event_payload(line: str) -> dict | None:
    """把一行 SSE 解析成事件对象；空行/注释/[DONE] 返回 None。

    容忍两种网关实现：标准的 "data: {json}" 与个别自建网关直接发裸 JSON。
    """
    text = line.strip()
    if not text or text.startswith(":") or text.startswith("event:"):
        return None
    if text == "[DONE]":
        # 新协议没有 [DONE]；个别网关仍会补一帧，按"流结束"处理而不是报错。
        return {"type": _EVENT_COMPLETED, "response": {}}
    if text.startswith("data:"):
        text = text[len("data:") :].strip()
    if not text or text == "[DONE]":
        return None
    try:
        event = json.loads(text)
    except json.JSONDecodeError as exc:
        log_llm_failure("protocol", "Responses 流式事件 JSON 解析失败")
        raise LLMError("模型返回了无法解析的流式响应") from exc
    if not isinstance(event, dict):
        log_llm_failure("protocol", "Responses 流式事件不是 JSON 对象")
        raise LLMError("模型返回了无法解析的流式响应")
    return event


class ResponsesStreamParser:
    """把 Responses 的 SSE 行流翻译成 LLMDelta / 终态 / 用量。

    调用方逐行调用 :meth:`feed`，把返回的 delta 原样产出；:attr:`finished` 为真时
    停止读取（**不要等 [DONE]**）。终态与用量都从语义事件里取：

    - response.completed → finish_reason=stop（+ usage）
    - response.incomplete → finish_reason=length（+ usage）
    - response.failed → 抛 LLMError（错误文案取 error.message）
    """

    def __init__(self) -> None:
        self.finished = False
        self.finish_reason: str | None = None
        self.prompt_tokens: int | None = None
        self.completion_tokens: int | None = None
        self.cache_hit_tokens: int | None = None
        # 思考 token（协议里是 output_tokens_details.reasoning_tokens）：现有记账结构
        # 没有独立列，保留在解析器上供日志/调试读取；output_tokens 本身已包含它。
        self.reasoning_tokens: int | None = None
        # 未完成的工具调用：key = item id（缺失时退化为 output_index）。
        self._pending: dict[str, dict] = {}
        self._arguments: dict[str, list[str]] = {}
        self._emitted: set[str] = set()

    # ===== 对外入口 =====

    def feed(self, line: str) -> list[LLMDelta]:
        event = _event_payload(line)
        if event is None:
            return []
        if self.finished:
            return []
        event_type = str(event.get("type") or "")
        if event_type in (_EVENT_COMPLETED, _EVENT_INCOMPLETE):
            return self._finish(event, incomplete=event_type == _EVENT_INCOMPLETE)
        if event_type == _EVENT_FAILED:
            self._raise_failed(event)
        if event_type == "error":
            detail = event.get("error")
            message = detail.get("message") if isinstance(detail, dict) else None
            raise LLMError(f"模型返回错误：{message or event.get('message') or '未知错误'}")
        if event_type == _EVENT_OUTPUT_TEXT_DELTA:
            text = event.get("delta", event.get("text"))
            return [LLMDelta(text=text)] if isinstance(text, str) and text else []
        if event_type in _EVENT_REASONING_DELTAS:
            thinking = event.get("delta", event.get("text"))
            return [LLMDelta(reasoning=thinking)] if isinstance(thinking, str) and thinking else []
        if event_type == _EVENT_OUTPUT_ITEM_ADDED:
            self._remember_item(event)
            return []
        if event_type == _EVENT_ARGUMENTS_DELTA:
            self._append_arguments(event)
            return []
        if event_type == _EVENT_OUTPUT_ITEM_DONE:
            return self._complete_item(event)
        return []

    # ===== 工具调用累积 =====

    def _item_key(self, event: dict, item: dict) -> str:
        item_id = item.get("id") or event.get("item_id")
        if isinstance(item_id, str) and item_id:
            return item_id
        return f"index:{event.get('output_index', 0)}"

    def _remember_item(self, event: dict) -> None:
        item = event.get("item")
        if not isinstance(item, dict) or item.get("type") != "function_call":
            return
        key = self._item_key(event, item)
        self._pending[key] = {
            "id": str(item.get("call_id") or item.get("id") or ""),
            "type": "function",
            "function": {"name": str(item.get("name") or ""), "arguments": ""},
        }

    def _append_arguments(self, event: dict) -> None:
        item_id = event.get("item_id")
        key = (
            item_id
            if isinstance(item_id, str) and item_id
            else f"index:{event.get('output_index', 0)}"
        )
        fragment = event.get("delta")
        if not isinstance(fragment, str) or not fragment:
            return
        self._arguments.setdefault(key, []).append(fragment)

    def _complete_item(self, event: dict) -> list[LLMDelta]:
        item = event.get("item")
        if not isinstance(item, dict) or item.get("type") != "function_call":
            return []
        key = self._item_key(event, item)
        call = self._pending.pop(key, None) or {
            "id": str(item.get("call_id") or item.get("id") or ""),
            "type": "function",
            "function": {"name": str(item.get("name") or ""), "arguments": ""},
        }
        raw = item.get("arguments")
        if isinstance(raw, str) and raw:
            arguments = raw
        else:
            arguments = "".join(self._arguments.get(key, [])) or "{}"
        call["function"]["arguments"] = arguments
        self._arguments.pop(key, None)
        self._emitted.add(key)
        return [LLMDelta(tool_calls=[call])]

    # ===== 终态与用量 =====

    def _finalize_pending(self) -> list[LLMDelta]:
        """兜底：少数网关只在 completed 里给完整 output，不发 output_item.done。"""
        deltas: list[LLMDelta] = []
        for key in sorted(self._pending):
            if key in self._emitted:
                continue
            call = self._pending[key]
            arguments = "".join(self._arguments.get(key, []))
            if arguments:
                call["function"]["arguments"] = arguments
            if self.finish_reason in {FINISH_STOP, FINISH_LENGTH}:
                call["function"]["arguments"] = call["function"]["arguments"] or "{}"
            deltas.append(LLMDelta(tool_calls=[call]))
            self._emitted.add(key)
        self._pending.clear()
        self._arguments.clear()
        return deltas

    def _finish(self, event: dict, *, incomplete: bool) -> list[LLMDelta]:
        response = event.get("response")
        if isinstance(response, dict):
            self._apply_usage(response)
            if response.get("status") == "failed":
                self._raise_failed({"response": response})
            self._adopt_output_calls(response)
        self.finish_reason = FINISH_LENGTH if incomplete else FINISH_STOP
        self.finished = True
        return self._finalize_pending()

    def _adopt_output_calls(self, response: dict) -> None:
        """completed 事件里自带的完整 output 是权威版本：用它补齐/修正待产出的调用。"""
        output = response.get("output")
        if not isinstance(output, list):
            return
        by_id = {str(item.get("id") or ""): item for item in output if isinstance(item, dict)}
        for key, call in self._pending.items():
            item = by_id.get(key)
            if item is None and call["id"]:
                item = next(
                    (
                        candidate
                        for candidate in by_id.values()
                        if candidate.get("call_id") == call["id"]
                    ),
                    None,
                )
            if item is None or item.get("type") != "function_call":
                continue
            if isinstance(item.get("arguments"), str) and item["arguments"]:
                call["function"]["arguments"] = item["arguments"]
            if isinstance(item.get("name"), str) and item["name"]:
                call["function"]["name"] = item["name"]

    def _apply_usage(self, response: dict) -> None:
        usage = response.get("usage")
        if not isinstance(usage, dict):
            return
        prompt = clean_token(usage.get("input_tokens"))
        completion = clean_token(usage.get("output_tokens"))
        if prompt is not None:
            self.prompt_tokens = prompt
        if completion is not None:
            self.completion_tokens = completion
        input_details = usage.get("input_tokens_details")
        if isinstance(input_details, dict):
            cached = clean_token(input_details.get("cached_tokens"))
            if cached is not None:
                self.cache_hit_tokens = cached
        output_details = usage.get("output_tokens_details")
        if isinstance(output_details, dict):
            self.reasoning_tokens = clean_token(output_details.get("reasoning_tokens"))

    def _raise_failed(self, event: dict) -> None:
        response = event.get("response")
        error = response.get("error") if isinstance(response, dict) else None
        message = error.get("message") if isinstance(error, dict) else None
        raise LLMError(f"模型返回错误：{message or '未知错误'}")


__all__ = ["ResponsesStreamParser", "clean_token"]

# SPDX-License-Identifier: Apache-2.0
"""T21 运行轨迹字段：只读派生视图 + 进程内记录（内存版，不落库）。

T21 要求一次助手运行能回答「第几步、调了哪个工具、起止时间、状态、模型与用量、
授权决策、改到哪个 revision、脱敏摘要」。字段白名单固定，**不记录**简历正文、附件、
Key、思维链、提示词原文。

本模块刻意只做两件事（Lead 要求先不接线、不建表）：

1. step_from_tool_call()：把 api/assistant_tool_exec.run_tool_call() 返回的
   in-memory record **只读派生**成轨迹步。只按白名单取 name / ok / proposal /
   summary / result_text 里的 revision 一个数字；参数、正文、附件从不进入轨迹。
   源 record 不被修改。
2. RunTraceRecorder：进程内、有界的运行轨迹缓冲，供测试/诊断与后续接线使用。
   **不落库、不写文件**——需要持久化时由 Lead 统一分配迁移号后再加（见
   .workbuddy/audit/t21-run-trace-design.md）。

字段与来源：run_id（request_id 或 run-<uuid>）/ step / tool / 起止时间与耗时 /
status（ok·failed·refused·proposal_pending·cancelled）/ model 与 token 用量（
ModelUsage.from_llm_usage 白名单投影）/ authorization（not_required·approved·
pending_approval·denied）/ revision（工具结果里只取这一个整数）/ 脱敏摘要（≤120 字）。

不记录清单由 STEP_FIELDS 白名单与 to_view() 保证；反例与反证见
backend/tests/test_assistant_run_trace.py。新增字段必须先改白名单并补测试。
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .assistant_run_trace_redact import redact_summary

TRACE_VERSION = 1
MAX_TRACE_STEPS = 64
MAX_TOOL_NAME_CHARS = 64
MAX_RESULT_TEXT_CHARS = 20_000

# 轨迹步的**完整**字段集：to_view() 只输出这些键，多一个都不行。
STEP_FIELDS: tuple[str, ...] = (
    "run_id",
    "step",
    "tool",
    "started_at",
    "finished_at",
    "duration_ms",
    "status",
    "model",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "finish_reason",
    "authorization",
    "revision",
    "summary",
)
RUN_FIELDS: tuple[str, ...] = (
    "run_id",
    "conversation_id",
    "request_id",
    "started_at",
    "ended_at",
    "status",
    "step_count",
    "steps",
)
STATUSES = frozenset({"ok", "failed", "refused", "proposal_pending", "cancelled"})
RUN_STATUSES = frozenset({"running", "ok", "failed", "cancelled"})
AUTHORIZATION_DECISIONS = frozenset({"not_required", "approved", "pending_approval", "denied"})


def utcnow() -> datetime:
    """UTC 当前时间（轨迹时间统一 UTC，展示层再本地化）。"""
    return datetime.now(UTC)


def _clip(text: object, limit: int) -> str:
    value = "" if text is None else str(text)
    return value if len(value) <= limit else value[:limit]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def authorization_decision(*, writes: bool, writable: bool, allowed: bool = True) -> str:
    """授权决策：未授权 → denied；只读工具 → not_required；写工具看本次是否放行。

    writable 是「本次请求用户显式同意写入」的唯一通道（policy.ToolExecutionContext），
    模型文本声称已确认不会改变它；写工具在未放行时走提案，所以是 pending_approval。
    """
    if not allowed:
        return "denied"
    if not writes:
        return "not_required"
    return "approved" if writable else "pending_approval"


@dataclass(frozen=True)
class ModelUsage:
    """一次模型调用的用量白名单（只存数字与枚举，与 LLMUsageRecord 同口径）。"""

    model: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    finish_reason: str = ""

    @classmethod
    def from_llm_usage(cls, row: Any) -> ModelUsage:
        """从 LLMUsageRecord（或同名属性对象）投影；其它列一律不读。"""
        if row is None:
            return cls()

        def _int(name: str) -> int | None:
            value = getattr(row, name, None)
            return value if isinstance(value, int) and not isinstance(value, bool) else None

        return cls(
            model=_clip(getattr(row, "model", "") or "", 128),
            prompt_tokens=_int("prompt_tokens"),
            completion_tokens=_int("completion_tokens"),
            total_tokens=_int("total_tokens"),
            finish_reason=_clip(getattr(row, "finish_reason", "") or "", 32),
        )


@dataclass(frozen=True)
class RunStep:
    """一个轨迹步（不可变；to_view 只输出白名单字段）。"""

    run_id: str
    step: int
    tool: str
    started_at: datetime
    finished_at: datetime | None
    status: str
    authorization: str
    model: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    finish_reason: str = ""
    revision: int | None = None
    summary: str = ""

    @property
    def duration_ms(self) -> int | None:
        if self.finished_at is None:
            return None
        delta = (self.finished_at - self.started_at).total_seconds() * 1000
        return max(0, int(round(delta)))

    def to_view(self) -> dict[str, Any]:
        view: dict[str, Any] = {
            "run_id": self.run_id,
            "step": self.step,
            "tool": self.tool,
            "started_at": _iso(self.started_at),
            "finished_at": _iso(self.finished_at),
            "duration_ms": self.duration_ms,
            "status": self.status,
            "model": self.model,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "finish_reason": self.finish_reason,
            "authorization": self.authorization,
            "revision": self.revision,
            "summary": self.summary,
        }
        assert tuple(view) == STEP_FIELDS, "轨迹步字段与 STEP_FIELDS 白名单不一致"
        return view


@dataclass(frozen=True)
class RunTrace:
    """一次助手运行（进程内对象；不是数据库行）。"""

    run_id: str
    started_at: datetime
    conversation_id: int | None = None
    request_id: str = ""
    ended_at: datetime | None = None
    status: str = "running"
    steps: tuple[RunStep, ...] = ()

    @property
    def step_count(self) -> int:
        return len(self.steps)

    def to_view(self) -> dict[str, Any]:
        view: dict[str, Any] = {
            "run_id": self.run_id,
            "conversation_id": self.conversation_id,
            "request_id": self.request_id,
            "started_at": _iso(self.started_at),
            "ended_at": _iso(self.ended_at),
            "status": self.status,
            "step_count": self.step_count,
            "steps": [step.to_view() for step in self.steps],
        }
        assert tuple(view) == RUN_FIELDS, "运行字段与 RUN_FIELDS 白名单不一致"
        return view


def revision_from_tool_payload(record: Mapping[str, Any]) -> int | None:
    """只从工具结果里取 revision 一个整数；不复制结果正文。"""
    direct = record.get("revision")
    if isinstance(direct, int) and not isinstance(direct, bool) and direct >= 0:
        return direct
    arguments = record.get("arguments")
    if isinstance(arguments, Mapping):
        from_arguments = arguments.get("revision")
        if (
            isinstance(from_arguments, int)
            and not isinstance(from_arguments, bool)
            and from_arguments >= 0
        ):
            return from_arguments
    raw = record.get("result_text")
    if not isinstance(raw, str) or not raw or len(raw) > MAX_RESULT_TEXT_CHARS:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    revision = payload.get("revision")
    if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0:
        return revision
    return None


def message_context_payload(run_view: Mapping[str, Any]) -> dict[str, Any]:
    """消息 context 里的 run_trace 形态：版本号 + 单个 run 视图（字段仍是白名单）。"""
    return {"version": TRACE_VERSION, **dict(run_view)}


def _derive_status(record: Mapping[str, Any], *, authorization: str, cancelled: bool) -> str:
    if cancelled:
        return "cancelled"
    if authorization == "denied":
        return "refused"
    if record.get("proposal"):
        return "proposal_pending"
    if record.get("ok") is False:
        return "failed"
    return "ok"


def step_from_tool_call(
    record: Mapping[str, Any],
    *,
    run_id: str,
    step: int,
    started_at: datetime,
    finished_at: datetime | None = None,
    authorization: str = "not_required",
    usage: ModelUsage | None = None,
    cancelled: bool = False,
    summary: str | None = None,
    revision: int | None = None,
) -> RunStep:
    """把 run_tool_call() 的 in-memory record **只读派生**成轨迹步。

    源 record 不被修改；除白名单字段外不读取任何键。
    """
    if authorization not in AUTHORIZATION_DECISIONS:
        raise ValueError(f"未知授权决策：{authorization}")
    resolved_usage = usage or ModelUsage()
    summary = redact_summary(record.get("summary")) if summary is None else redact_summary(summary)
    if revision is None:
        revision = revision_from_tool_payload(record)
    finished = finished_at or utcnow()
    return RunStep(
        run_id=run_id,
        step=step,
        tool=_clip(record.get("name") or "", MAX_TOOL_NAME_CHARS),
        started_at=started_at,
        finished_at=finished,
        status=_derive_status(record, authorization=authorization, cancelled=cancelled),
        authorization=authorization,
        model=resolved_usage.model,
        prompt_tokens=resolved_usage.prompt_tokens,
        completion_tokens=resolved_usage.completion_tokens,
        total_tokens=resolved_usage.total_tokens,
        finish_reason=resolved_usage.finish_reason,
        revision=revision,
        summary=summary,
    )


class RunTraceRecorder:
    """进程内、有界的运行轨迹缓冲（**无持久化**；重启即丢，测试用）。

    容量语义：最多保留最近 max_runs 个已结束的 run；每个 run 最多保留最近
    max_steps_per_run 步。steps 的编号单调递增，溢出丢最旧的步但编号不复用。
    """

    def __init__(
        self,
        *,
        max_runs: int = 50,
        max_steps_per_run: int = 200,
        default_model: str = "",
    ) -> None:
        if max_runs < 1 or max_steps_per_run < 1:
            raise ValueError("max_runs / max_steps_per_run 必须 ≥ 1")
        self._max_steps = max_steps_per_run
        self._runs: deque[RunTrace] = deque(maxlen=max_runs)
        self._open: RunTrace | None = None
        self._next_step = 0
        # 模型调用没给出 usage 时的默认模型名（真实接线用 provider.config.model）。
        self._default_model = default_model

    def begin_run(
        self,
        *,
        run_id: str | None = None,
        conversation_id: int | None = None,
        request_id: str = "",
        started_at: datetime | None = None,
    ) -> RunTrace:
        if self._open is not None:
            raise RuntimeError("已有进行中的 run，先 end_run()")
        self._next_step = 0
        self._open = RunTrace(
            run_id=run_id or f"run-{uuid4().hex}",
            started_at=started_at or utcnow(),
            conversation_id=conversation_id,
            request_id=request_id,
        )
        return self._open

    def record_step(
        self,
        record: Mapping[str, Any] | None = None,
        *,
        tool: str | None = None,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
        authorization: str = "not_required",
        usage: ModelUsage | None = None,
        summary: str | None = None,
        revision: int | None = None,
        cancelled: bool = False,
    ) -> dict[str, Any]:
        run = self._require_open()
        source: Mapping[str, Any] = record if record is not None else {"name": tool or ""}
        if usage is None and self._default_model:
            usage = ModelUsage(model=self._default_model)
        step = step_from_tool_call(
            source,
            run_id=run.run_id,
            step=self._next_step,
            started_at=started_at or utcnow(),
            finished_at=finished_at,
            authorization=authorization,
            usage=usage,
            summary=summary,
            revision=revision,
            cancelled=cancelled,
        )
        self._next_step += 1
        steps = list(run.steps)
        steps.append(step)
        if len(steps) > self._max_steps:
            steps = steps[-self._max_steps :]
        self._open = replace(run, steps=tuple(steps))
        return step.to_view()

    def end_run(self, *, status: str = "ok", ended_at: datetime | None = None) -> dict[str, Any]:
        run = self._require_open()
        if status not in RUN_STATUSES or status == "running":
            raise ValueError(f"未知的 run 终态：{status}")
        finished = replace(run, ended_at=ended_at or utcnow(), status=status)
        self._runs.append(finished)
        self._open = None
        return finished.to_view()

    @property
    def is_open(self) -> bool:
        """是否还有进行中的 run（收尾逻辑用；已 end 的 recorder 可重复调用收尾）。"""
        return self._open is not None

    def current_run(self) -> dict[str, Any] | None:
        return self._open.to_view() if self._open is not None else None

    def snapshot(self) -> dict[str, Any]:
        """只读快照：已结束的 run（旧→新）+ 进行中的 run（若有）。"""
        runs = [run.to_view() for run in self._runs]
        if self._open is not None:
            runs.append(self._open.to_view())
        return {"version": TRACE_VERSION, "runs": runs}

    def clear(self) -> None:
        self._runs.clear()
        self._open = None
        self._next_step = 0

    def _require_open(self) -> RunTrace:
        if self._open is None:
            raise RuntimeError("没有进行中的 run，先 begin_run()")
        return self._open

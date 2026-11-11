# SPDX-License-Identifier: Apache-2.0
"""RAG → 简历生成链的**唯一适配层**（计划 §3.4 / §3.5 / Phase 3）。

**为什么需要这一层**：`build_consumed_data()` 丢掉 `entry_id`，所以 RAG 的命中必须
经 `canonical_item_hash` 桥接回 `profile_matching._select_entries()`；boost 与查询扩展词
都只在这一层"翻译"成生成链认识的东西，RAG 不碰 prompt 字节、不碰分区名额。

**为什么用 ContextVar 而不是逐层加 kwarg**（对计划 §T2.1 偏好方案的偏差，已写进报告）：
- `profile_relevance.py` = 488/500 行、`resume_generator.py` = 500/500 行，给
  `build_targeted_consumed_profile_context` 加透传参数会顶穿 500 行硬闸门；拆那两个
  文件会动到被 `monkeypatch` 钉死的模块命名空间（`test_profile_group_budget` 直接
  patch `profile_relevance._select_entries` 等四个符号），与"被 monkeypatch 的符号必须
  留在原模块"的纪律冲突。
- 因此显式入口仍在 `_select_entries(..., boost=...)`（`boost: canonical_hash → 分数`），
  生产链路用本模块的**作用域**把它交给 `profile_matching`：作用域只在"构造候选"这段
  同步代码里打开，不跨 `await`；每次请求各自一份，并发请求互不串扰。

**回退语义**：作用域为空（默认关闭 / provider 不可用 / 索引缺失）时
`active_boost()` 返回 `None`、`active_extra_terms()` 返回空元组，
`profile_matching` 的代码路径与改造前逐字节一致。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any

from ..profile.profile_relevance_constants import JobFocus


@dataclass(frozen=True)
class SelectionBoost:
    """一次生成请求的 RAG 选择输入（空 = 完全回退关键词链）。"""

    #: canonical_item_hash → 融合分（已 round 到 4 位；键在 _select_entries 里回查）
    boost: Mapping[str, float] = field(default_factory=dict)
    #: Phase 0 查询扩展词：只进 JobFocus.terms，绝不进 skills
    extra_terms: tuple[str, ...] = ()
    #: 诊断用回退原因（只进日志，不进 prompt）
    fallback_reason: str = ""
    #: #30 审计明细：boost 键映射回的真实条目（entry_id / 标题 / 分区 / 提升幅度），
    #: 顺序与 boost 一致（分数降序）。只进对外回执，绝不进 prompt——生成链仍只读
    #: boost/extra_terms，候选形状不变。空元组 = 没有命中，与 boost 是否为空无关。
    impacts: tuple[Mapping[str, Any], ...] = ()

    @property
    def is_empty(self) -> bool:
        return not self.boost and not self.extra_terms


_ACTIVE: ContextVar[SelectionBoost | None] = ContextVar("rag_selection_boost", default=None)
#: "候选构造已完成"标记：由 `profile_matching._select_entries()` 在作用域内调用
#: `mark_selection_done()` 置位，`rag_service.generate_with_scope()` 据此在**构造完成的
#: 那个事件之后**退出作用域（生成器会在构造候选前先 yield 一条 progress 事件，所以
#: 不能按"首个事件"退出——按首个事件退出会让 boost 在真正构造候选时已经失效）。
_DONE: ContextVar[bool] = ContextVar("rag_selection_done", default=False)


def enter_selection_scope(scope: SelectionBoost | None) -> Token:
    """进入 RAG 作用域并清掉完成标记；返回供 :func:`exit_selection_scope` 复原的 token。"""
    _DONE.set(False)
    return _ACTIVE.set(scope if scope is not None else SelectionBoost())


def exit_selection_scope(token: Token) -> None:
    """复原作用域与完成标记（生成器/请求异常路径也必须调用）。"""
    _ACTIVE.reset(token)
    _DONE.set(False)


def selection_done() -> bool:
    """当前作用域里"候选是否已构造完成"（无作用域或未标记时为 False）。"""
    return bool(_DONE.get())


def mark_selection_done() -> None:
    """由候选构造入口调用：只在作用域激活时置位，作用域外是 no-op。"""
    if _ACTIVE.get() is not None:
        _DONE.set(True)


@contextmanager
def selection_scope(scope: SelectionBoost | None):
    """在"构造候选"的同步代码段内激活 RAG 输入；退出即复原（异常路径也复原）。"""
    token = enter_selection_scope(scope)
    try:
        yield scope
    finally:
        exit_selection_scope(token)


def active_selection() -> SelectionBoost | None:
    return _ACTIVE.get()


def active_boost() -> Mapping[str, float] | None:
    """当前作用域的 boost 表；没有 boost 时返回 None（调用方走原排序）。"""
    scope = _ACTIVE.get()
    if scope is None or not scope.boost:
        return None
    return scope.boost


def active_extra_terms() -> tuple[str, ...]:
    scope = _ACTIVE.get()
    return scope.extra_terms if scope is not None else ()


def boost_for_item(
    section_key: str,
    item: Mapping[str, Any],
    boost: Mapping[str, float] | None = None,
) -> float:
    """取一条候选的 boost 分；键是 `canonical_item_hash`（与切块侧同一实现）。"""
    table = boost if boost is not None else active_boost()
    if not table:
        return 0.0
    from .rag_chunking import canonical_item_hash

    return float(table.get(canonical_item_hash(section_key, item), 0.0))


def apply_extra_terms(focus: JobFocus, terms: Iterable[str] | None = None) -> JobFocus:
    """把查询扩展词并入 `terms`（去重、保序）；`skills`/`domains` 原样不动。"""
    values = list(terms) if terms is not None else list(active_extra_terms())
    if not values:
        return focus
    existing = {term.casefold() for term in focus.terms}
    merged = list(focus.terms)
    for value in values:
        text = str(value or "").strip()
        if not text or text.casefold() in existing:
            continue
        existing.add(text.casefold())
        merged.append(text)
    return JobFocus(skills=focus.skills, domains=focus.domains, terms=tuple(merged))


__all__ = [
    "SelectionBoost",
    "active_boost",
    "active_extra_terms",
    "active_selection",
    "apply_extra_terms",
    "boost_for_item",
    "enter_selection_scope",
    "exit_selection_scope",
    "mark_selection_done",
    "selection_done",
    "selection_scope",
]

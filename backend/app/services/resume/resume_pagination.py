# SPDX-License-Identifier: Apache-2.0
"""W08 分页域：校验 + 计划 + HTML 打印 CSS（Wave2 第 2 册 §3.2/§3.3）。

W07 先把**域协议**接上（放行 / 校验 / 空域不落库 / prune），绘制层断页由 W08 实现；
本模块的 ``resolve_pagination`` / ``pagination_css`` 就是 W08 的唯一入口，避免 W08
再写一套"读 format_config 的 pagination"。

设计口径（契约原文）：分页意图以**语义对象 id** 为锚点（``content`` 里的 entry.id），
不保存随字号变化的像素 Y / 下标；未知键与绝对坐标一律丢弃。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from .resume_config_domains import domain_version, is_object_id, is_supported

# 七个正文板块键（与 resume_sections.DEFAULT_SECTION_ORDER 同值；本模块不 import 它——
# 那条链会拖进 profile_service/DB，分页校验是纯函数。守卫测试两处逐项比对）。
SECTION_KEYS: tuple[str, ...] = (
    "education",
    "experience",
    "projects",
    # W14：科研三栏目插在 projects 之后（与 DEFAULT_SECTION_ORDER 逐项一致）。
    "publications",
    "research_projects",
    "patents",
    "skills",
    "campus_experience",
    "awards",
    "summary",
)
MAX_ENTRIES = 400
MAX_SECTION_ENTRIES = 10


@dataclass(frozen=True)
class EntryBreakPlan:
    """一个对象/板块的断页计划（只含显式设置；缺省值 = 今天的行为）。"""

    break_before_page: bool = False
    keep_with_next: int = 0
    allow_split: bool = False


@dataclass(frozen=True)
class PaginationPlan:
    entries: Mapping[str, EntryBreakPlan] = field(default_factory=dict)
    sections: Mapping[str, EntryBreakPlan] = field(default_factory=dict)
    repeat_name: bool = False
    page_numbers: bool = False

    def entry(self, object_id: str | None) -> EntryBreakPlan:
        return self.entries.get(object_id or "", EntryBreakPlan())

    def section(self, key: str) -> EntryBreakPlan:
        return self.sections.get(key, EntryBreakPlan())

    @property
    def empty(self) -> bool:
        return not (self.entries or self.sections or self.repeat_name or self.page_numbers)


def _validate_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _validate_keep_with_next(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value <= 3 else None


def _validate_entry(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    result: dict[str, object] = {}
    if raw.get("break_before") == "page":
        result["break_before"] = "page"
    keep = _validate_keep_with_next(raw.get("keep_with_next"))
    if keep is not None:
        result["keep_with_next"] = keep
    allow_split = _validate_bool(raw.get("allow_split"))
    if allow_split is not None:
        result["allow_split"] = allow_split
    return result or None


def validate_pagination_domain(raw: object) -> dict | None:
    """§3.2 白名单校验；空域 / 版本不支持返回 None（R2/R3：不落库）。"""
    version = domain_version(raw)
    if not is_supported("pagination", version):
        return None
    if not isinstance(raw, dict):
        return None
    entries: dict[str, dict] = {}
    for object_id, payload in dict(raw.get("entries") or {}).items():
        if not is_object_id(object_id):
            continue
        cleaned = _validate_entry(payload)
        if cleaned:
            entries[object_id] = cleaned
        if len(entries) >= MAX_ENTRIES:
            break
    sections: dict[str, dict] = {}
    for key, payload in dict(raw.get("sections") or {}).items():
        if key not in SECTION_KEYS:
            continue
        cleaned = _validate_entry(payload)
        if cleaned:
            sections[key] = cleaned
        if len(sections) >= MAX_SECTION_ENTRIES:
            break
    continuation: dict[str, bool] = {}
    raw_continuation = raw.get("continuation")
    if isinstance(raw_continuation, dict):
        for key in ("repeat_name", "page_numbers"):
            value = _validate_bool(raw_continuation.get(key))
            if value is not None:
                continuation[key] = value
    if not (entries or sections or continuation):
        return None
    result: dict = {"version": 1}
    if entries:
        result["entries"] = entries
    if sections:
        result["sections"] = sections
    if continuation:
        result["continuation"] = continuation
    return result


def _plan(raw: dict | None) -> EntryBreakPlan:
    data = raw if isinstance(raw, dict) else {}
    return EntryBreakPlan(
        break_before_page=data.get("break_before") == "page",
        keep_with_next=int(data.get("keep_with_next") or 0),
        allow_split=bool(data.get("allow_split", False)),
    )


def resolve_pagination(format_config: dict | None) -> PaginationPlan:
    """从 format_config 读分页域（已校验形状；畸形输入按空域，不抛异常）。"""
    if not isinstance(format_config, dict):
        return PaginationPlan()
    domain = validate_pagination_domain(format_config.get("pagination"))
    if domain is None:
        return PaginationPlan()
    continuation = domain.get("continuation") or {}
    return PaginationPlan(
        entries={key: _plan(value) for key, value in (domain.get("entries") or {}).items()},
        sections={key: _plan(value) for key, value in (domain.get("sections") or {}).items()},
        repeat_name=bool(continuation.get("repeat_name", False)),
        page_numbers=bool(continuation.get("page_numbers", False)),
    )


def _css_rule(selector: str, plan: EntryBreakPlan) -> str:
    rules: list[str] = []
    if plan.break_before_page:
        rules.append("break-before: page;")
    if plan.keep_with_next:
        rules.append(f"break-after: avoid; /* keep_with_next={plan.keep_with_next} */")
    return f"  {selector} {{ {' '.join(rules)} }}" if rules else ""


def pagination_css(plan: PaginationPlan) -> str:
    """HTML 的**打印**断页规则；空计划返回空串（默认产物一个字符都不多）。

    刻意只作用于 ``@media print``：让手动分页在草稿多列视图里"看起来生效"会误导用户
    （契约 §3.3 明确要求）。
    """
    if plan.empty:
        return ""
    rules = [
        _css_rule(f'[data-object-id="{object_id}"]', entry)
        for object_id, entry in sorted(plan.entries.items())
    ]
    rules += [
        _css_rule(f'[data-section="{key}"]', value) for key, value in sorted(plan.sections.items())
    ]
    body = "\n".join(rule for rule in rules if rule)
    return f"@media print {{\n{body}\n}}" if body else ""


__all__ = [
    "EntryBreakPlan",
    "MAX_ENTRIES",
    "MAX_SECTION_ENTRIES",
    "PaginationPlan",
    "SECTION_KEYS",
    "pagination_css",
    "resolve_pagination",
    "validate_pagination_domain",
]

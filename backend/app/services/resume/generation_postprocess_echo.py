# SPDX-License-Identifier: Apache-2.0
"""C6 保存前的仅素材字段回声阻断（从 app.services.resume.generation_postprocess 纯搬迁拆出）。

仅素材字段（基本信息/知识产权/语言能力里没有纸面槽位的字段，含自定义字段）可以进提示词
当素材，但不得被模型抄进纸面正文：命中即给可执行提示并阻断保存。纸面槽位表只有
paper_policy.SECTION_RULES 一份来源。generation_postprocess 对本模块做 re-export。
"""

from __future__ import annotations

from typing import Any

from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile
from ...schemas.resume import ResumeContent
from ..profile.language_projection import LANGUAGE_FIELD_IDS as _LANGUAGE_FIELD_IDS
from ..profile.paper_policy import BASIC_INFO_SLOTS, SECTION_RULES, is_material_only
from ..profile.paper_projection import normalize_for_match

# ===== C6/R-43/R-76：仅素材字段的保存前回声阻断 =====
#
# 需求：仅素材字段（基本信息/知识产权/语言能力里**没有纸面槽位**的字段，含自定义字段）
# 可以进模型提示词当素材，但不得被模型抄进 summary 等纸面正文。这里是保存前的确定性
# 检查（不调模型、不改写内容）：命中则阻断保存并给可执行提示，绝不静默落库。
# 纸面槽位表只有 paper_policy.SECTION_RULES 一份来源，本模块不新写第二份映射。


class MaterialOnlyEchoError(ValueError):
    """仅素材字段的值被抄进纸面正文：阻断保存（结构化错误，可直接展示）。"""

    def __init__(self, detail: str, *, section_key: str, field_id: str, path: str) -> None:
        super().__init__(detail)
        self.detail = detail
        self.section_key = section_key
        self.field_id = field_id
        self.path = path


# basic_info / languages 不走 SECTION_RULES：前者是头部槽位，后者（2026-10 起）是独立
# 正文分区。它们的纸面去路从投影层各自的单一来源派生，保证"哪些字段算合法上纸面"
# 没有第二份映射。语言能力五个字段现在都能上纸面（语言/水平/证书/分数/取得时间）。
_SPECIAL_LEGAL_KEYS: dict[str, frozenset[str]] = {
    "basic_info": frozenset(BASIC_INFO_SLOTS),
    "languages": frozenset(field_id.split(".")[-1] for field_id in _LANGUAGE_FIELD_IDS.values()),
}


def _section_legal_keys(section_key: str) -> frozenset[str]:
    if section_key in _SPECIAL_LEGAL_KEYS:
        return _SPECIAL_LEGAL_KEYS[section_key]
    rule = SECTION_RULES.get(section_key)
    return frozenset(rule.slots) if rule is not None else frozenset()


def _entry_values(entry: ConsumedEntry, spec: Any) -> str:
    return str(entry.values.get(spec.field_id) or "").strip()


def _collect_echo_sources(
    consumed: ConsumedProfile,
) -> list[tuple[str, Any, str]]:
    """仅素材分区里**没有纸面槽位**的字段值（含自定义字段）：抄进正文即回声。"""
    sources: list[tuple[str, Any, str]] = []
    for section_key, section in consumed.sections.items():
        if not is_material_only(section_key):
            continue
        legal_keys = _section_legal_keys(section_key)
        for spec in section.fields:
            if spec.key in legal_keys or spec.private or not spec.llm_allowed:
                continue
            if getattr(spec, "field_type", "") == "photo":
                continue
            for entry in section.entries:
                value = _entry_values(entry, spec)
                if len(normalize_for_match(value)) >= 2:
                    sources.append((section_key, spec, value))
    return sources


def _collect_legal_values(consumed: ConsumedProfile) -> list[str]:
    """合法纸面来源的原值：非素材分区的可外发字段 + 仅素材分区有槽位的字段。

    误报抑制用：同一个字符串若本来就来自可上纸面的资料字段，模型写进正文不算
    "仅素材内容被抄"（例如「开源项目」既是知识产权成果类型也是项目成果类型）。
    """
    values: list[str] = []
    for section_key, section in consumed.sections.items():
        material_only = is_material_only(section_key)
        legal_keys = _section_legal_keys(section_key) if material_only else None
        for spec in section.fields:
            if spec.private or not spec.llm_allowed:
                continue
            if legal_keys is not None and spec.key not in legal_keys:
                continue
            for entry in section.entries:
                value = _entry_values(entry, spec)
                if value:
                    values.append(value)
    return values


def _iter_resume_texts(node: Any, path: str = "") -> list[tuple[str, str]]:
    """纸面正文里的全部文本（跳过照片 data URL）；返回 (路径, 文本)。"""
    texts: list[tuple[str, str]] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "photo":
                continue
            child = f"{path}.{key}" if path else str(key)
            texts.extend(_iter_resume_texts(value, child))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            texts.extend(_iter_resume_texts(value, f"{path}.{index}"))
    elif isinstance(node, str) and node.strip():
        texts.append((path, node))
    return texts


def block_material_only_echo(resume: ResumeContent, consumed: ConsumedProfile) -> None:
    """C6 保存前检查：仅素材值出现在任何纸面正文 → MaterialOnlyEchoError。

    命中条件是"该值可追溯到仅素材来源、且没有同时出现在合法纸面来源里"；
    保存调用方（SSE / 后台任务）负责把它转成 error 事件/失败任务，**不写库**。
    """
    legal_normalized = [
        normalized
        for normalized in (normalize_for_match(value) for value in _collect_legal_values(consumed))
        if normalized
    ]
    paper_texts = [
        (path, normalize_for_match(text))
        for path, text in _iter_resume_texts(resume.model_dump(mode="json"))
    ]
    paper_texts = [(path, text) for path, text in paper_texts if text]
    seen: set[str] = set()
    for section_key, spec, value in _collect_echo_sources(consumed):
        normalized = normalize_for_match(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        # 误报抑制：该字符串本来就来自可上纸面的资料字段 → 不算仅素材独有的回声。
        if any(normalized in legal for legal in legal_normalized):
            continue
        for path, text in paper_texts:
            if normalized not in text:
                continue
            section_name = getattr(consumed.sections.get(section_key), "name", section_key)
            raise MaterialOnlyEchoError(
                f"「{section_name}·{spec.label}」只作为生成素材、不会上纸面，但生成结果在"
                f"「{path}」里出现了它的值「{value[:40]}」：请在正文中删除该内容，"
                "或把该值改到可上纸面的字段（如项目描述）后重新生成",
                section_key=section_key,
                field_id=spec.field_id,
                path=path,
            )


def enforce_material_only_echo(resume: ResumeContent, consumed: ConsumedProfile) -> str | None:
    """保存入口的薄封装：命中返回可直接展示的中文错误，否则 None（不抛异常）。"""
    try:
        block_material_only_echo(resume, consumed)
    except MaterialOnlyEchoError as exc:
        return exc.detail
    return None

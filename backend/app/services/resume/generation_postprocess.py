# SPDX-License-Identifier: Apache-2.0
"""生成结果的确定性后处理：C5-B 自定义字段行补回 + C2 自建大字段栏目（F3 §3）。

**C5-B（R-37/R-80）**：AI 允许改写正文，但每个非空自定义字段的「标签：值」必须出现在
该条目的承载区文本里。生成后逐条检测：先用 paper_projection.ensure_custom_field_lines
做"去空白与标点归一化 + 已呈现不重复 + 缺失按字段定义顺序补回末尾"，**永不因此拒绝
保存**。承载区映射与归一化只有 paper_policy/paper_projection 一处实现（R-37 单源）；
仅素材字段（basic_info / 知识产权 / 语言能力的自定义字段）不追加，它们的回声阻断由
本模块的 C6 保存前检查负责（见 block_material_only_echo）。

**C2（R-62/R-79）**：自建大字段独立成栏，由 project_paper_content(consumed) 确定性
写入 content.custom_sections（标题/条目/label 行与"从资料填充"链路逐字一致），不交给
模型自由生成。空 custom_sections 不序列化（旧简历指纹不变）。

**F8（R-81）**：生成结果后按 F3 快照条目身份做槽位确定性回填（资料有值/结果空才写，
不改 AI 已写值、不阻断保存），字段清单唯一来源是 paper_policy 的 backfill 槽位。

**条目不补造**：模型整条漏写某条目时，这里的匹配找不到承载对象就跳过（不凭自定义字段
凭空造一条经历）；"没写进简历"由 coverage 报告说明。匹配用条目身份字段（学校/公司/
项目名/奖项名等）+ 日期消歧，与 grounding 的匹配口径一致。
"""

from __future__ import annotations

import logging
from typing import Any

from annotated_types import MaxLen

from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile, ConsumedSection
from ...schemas.resume import ResumeContent
from ..profile.language_projection import LANGUAGE_FIELD_IDS as _LANGUAGE_FIELD_IDS
from ..profile.paper_policy import (
    BASIC_INFO_SLOTS,
    SECTION_RULES,
    carrier_field_id,
    is_material_only,
)
from ..profile.paper_projection import (
    ensure_custom_field_lines,
    normalize_for_match,
    project_paper_content,
)
from .generation_normalize import (
    merge_missing_consumed_fields,
    normalize_generated_content,
    strip_markdown_prefix,
)
from .resume_grounding_helpers import _similar, _similar_skill

logger = logging.getLogger(__name__)

# section_key → (ResumeContent 字段, 条目身份属性, 身份 field_id, 承载区字段, 承载区是否列表)。
# 只列"有纸面承载区"的系统分区；自建分区走 C2，basic_info/patents/languages 仅素材。
_CARRIER_SECTIONS: tuple[tuple[str, str, str, str, str, bool], ...] = (
    ("educations", "education", "school", "educations.school", "achievements", True),
    ("experiences", "experience", "company", "experiences.company", "description", True),
    (
        "campus_experiences",
        "campus_experience",
        "organization",
        "campus_experiences.organization",
        "description",
        True,
    ),
    ("projects", "projects", "name", "projects.name", "description", True),
    ("skills", "skills", "name", "skills.name", "level", False),
    ("awards", "awards", "name", "awards.title", "description", False),
    ("publications", "publications", "title", "publications.title", "note", False),
    (
        "research_projects",
        "research_projects",
        "name",
        "research_projects.name",
        "description",
        True,
    ),
    ("credentials", "credentials", "name", "credentials.title", "note", False),
)


def _max_length(model: type, field: str) -> int | None:
    """从 pydantic 字段元数据取 max_length（没有上限返回 None）。"""
    try:
        metadata = model.model_fields[field].metadata
    except (AttributeError, KeyError):  # pragma: no cover - 防御：字段不在模型上
        return None
    for meta in metadata:
        if isinstance(meta, MaxLen):
            return meta.max_length
    return None


def _custom_lines(section: ConsumedSection, entry: ConsumedEntry) -> list[tuple[str, str]]:
    """该条目需要上纸面的「标签：值」对（按字段定义顺序；默认字段不参与）。"""
    lines: list[tuple[str, str]] = []
    for spec in section.fields:
        if spec.is_builtin:
            continue
        value = str(entry.values.get(spec.field_id) or "").strip()
        if value:
            lines.append((spec.label, value))
    return lines


def _match_consumed_entry(
    section_key: str,
    section: ConsumedSection,
    item: Any,
    *,
    identity_attr: str,
    identity_field_id: str,
    used_entry_ids: set[str],
) -> ConsumedEntry | None:
    """把一条简历条目匹配回本次快照的来源条目；匹配不唯一时宁可不补。"""
    target = str(getattr(item, identity_attr, "") or "").strip()
    if not target:
        return None
    matcher = _similar_skill if section_key == "skills" else _similar
    candidates: list[ConsumedEntry] = []
    for entry in section.entries:
        if entry.entry_id in used_entry_ids:
            continue
        source = str(entry.values.get(identity_field_id) or "").strip()
        if source and matcher(target, source):
            candidates.append(entry)
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        # 同名多条：用日期消歧（与 grounding 的来源匹配同一思路），仍不唯一就放弃。
        start = str(getattr(item, "start_date", "") or "").strip()
        end = str(getattr(item, "end_date", "") or "").strip()
        dated = [
            entry
            for entry in candidates
            if (
                not start or start == str(entry.values.get(f"{section_key}.start_date", "")).strip()
            )
            and (not end or end == str(entry.values.get(f"{section_key}.end_date", "")).strip())
        ]
        if len(dated) == 1:
            return dated[0]
    return None


def ensure_custom_field_lines_in_resume(
    resume: ResumeContent, consumed: ConsumedProfile
) -> tuple[ResumeContent, list[dict[str, Any]]]:
    """C5-B：逐条把缺失的自定义字段「标签：值」补回承载区末尾；返回 (简历, 标注)。"""
    updates: dict[str, Any] = {}
    annotations: list[dict[str, Any]] = []
    for (
        section_key,
        resume_field,
        identity_attr,
        identity_field_id,
        carrier,
        is_list,
    ) in _CARRIER_SECTIONS:
        if is_material_only(section_key) or carrier_field_id(section_key) is None:
            continue
        section = consumed.section(section_key)
        items = list(getattr(resume, resume_field, None) or [])
        if section is None or not section.entries or not items:
            continue
        used_entry_ids: set[str] = set()
        changed = False
        for index, item in enumerate(items):
            entry = _match_consumed_entry(
                section_key,
                section,
                item,
                identity_attr=identity_attr,
                identity_field_id=identity_field_id,
                used_entry_ids=used_entry_ids,
            )
            if entry is None:
                continue
            used_entry_ids.add(entry.entry_id)
            lines = _custom_lines(section, entry)
            if not lines:
                continue
            carrier_value = getattr(item, carrier, None)
            if is_list:
                text = "\n".join(
                    str(value) for value in (carrier_value or []) if str(value).strip()
                )
            else:
                text = str(carrier_value or "")
            new_text, appended = ensure_custom_field_lines(text, lines)
            if not appended:
                continue
            if is_list:
                new_value: Any = [line for line in new_text.splitlines() if line.strip()]
            else:
                limit = _max_length(type(item), carrier)
                if limit is not None and len(new_text) > limit:
                    logger.info(
                        "自定义字段行未追加：承载区超结构上限 section=%s carrier=%s",
                        section_key,
                        carrier,
                    )
                    continue
                new_value = new_text
            items[index] = item.model_copy(update={carrier: new_value})
            changed = True
            annotations.append(
                {
                    "path": f"{resume_field}.{index}.{carrier}",
                    "origin": "restored",
                    "source_subject": str(getattr(item, identity_attr, "") or "").strip() or None,
                    "source_fact": "；".join(appended),
                }
            )
        if changed:
            updates[resume_field] = items
    # 单例 summary：承载区就是正文本身（自定义字段仍按"末尾追加"处理）。
    summary_section = consumed.section("summary")
    if summary_section is not None and summary_section.entries:
        lines = _custom_lines(summary_section, summary_section.entries[0])
        if lines:
            new_text, appended = ensure_custom_field_lines(resume.summary or "", lines)
            if appended:
                updates["summary"] = new_text
                annotations.append(
                    {
                        "path": "summary",
                        "origin": "restored",
                        "source_subject": "个人总结",
                        "source_fact": "；".join(appended),
                    }
                )
    if not updates:
        return resume, []
    return resume.model_copy(update=updates), annotations


def attach_custom_sections(resume: ResumeContent, consumed: ConsumedProfile) -> ResumeContent:
    """C2：用服务端确定性投影写入 content.custom_sections（顺序/标题/行都由投影冻结）。

    R-37 单源：自建分区的「主文本 / 标签行」判定只在 paper_policy.custom_section_text_field，
    生成链与填充链共用同一份投影（不做第二套生成期映射）。
    """
    projected = project_paper_content(consumed)
    custom_sections = list(getattr(projected, "custom_sections", None) or [])
    return resume.model_copy(update={"custom_sections": custom_sections})


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
    "languages": frozenset(
        field_id.split(".")[-1] for field_id in _LANGUAGE_FIELD_IDS.values()
    ),
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


# ===== F8（R-81）：生成结果的槽位确定性回填 =====


def _slot_text(rule: Any, raw: str) -> str | None:
    """按纸面 SlotRule 把资料原值转成 ResumeContent 槽位值；不认识的枚举返回 None。"""
    text = str(raw or "").strip()
    if not text:
        return None
    if rule.kind == "enum":
        return (rule.enum or {}).get(text)
    return text


def apply_profile_field_backfill(resume: ResumeContent, consumed: ConsumedProfile) -> ResumeContent:
    """F8（R-81）确定性回填：资料有值、结果侧槽位为空 → 写入资料值。

    **字段清单只有一份**：只处理 paper_policy.SECTION_RULES 里 backfill=True 的槽位
    （契约 §1 的 20 个小字段；school/major 等既有槽位默认 False，不被顺手改写）。
    分区与字段过滤完全沿用消费快照：未参与分区没有 section、hidden 字段已在 reader
    剔除、material_only/private 天然不在 slots。条目匹配复用 C5-B 的
    _match_consumed_entry（条目身份 + 日期消歧 + entry_id 去重），不写第二套匹配。

    **不改 AI 已写的值、不因此拒绝保存**：已有非空值跳过；超出模型 max_length 的源值
    按上限截断（宁可截断也不让整次生成保存失败）；未识别枚举跳过（由投影链路的
    "追加承载区"兜底，不在生成期猜）。
    """
    updates: dict[str, Any] = {}
    backfilled = 0
    for section_key, resume_field, identity_attr, identity_field_id, *_rest in _CARRIER_SECTIONS:
        rule = SECTION_RULES.get(section_key)
        section = consumed.section(section_key)
        if rule is None or section is None or not section.entries:
            continue
        items = list(getattr(resume, resume_field, None) or [])
        if not items:
            continue
        used_entry_ids: set[str] = set()
        changed = False
        for index, item in enumerate(items):
            entry = _match_consumed_entry(
                section_key,
                section,
                item,
                identity_attr=identity_attr,
                identity_field_id=identity_field_id,
                used_entry_ids=used_entry_ids,
            )
            if entry is None:
                continue
            used_entry_ids.add(entry.entry_id)
            patch: dict[str, str] = {}
            for field_key, slot in rule.slots.items():
                if not getattr(slot, "backfill", False):
                    continue
                attr = slot.attr
                # 防御：F8-A 落库前/降级部署时模型可能还没有该属性；没有就跳过而不是抛错。
                if attr not in type(item).model_fields:
                    continue
                if str(getattr(item, attr, "") or "").strip():
                    continue
                field_id = section_key + "." + field_key
                value = _slot_text(slot, str(entry.values.get(field_id) or ""))
                if value is None:
                    continue
                limit = _max_length(type(item), attr)
                if limit is not None and len(value) > limit:
                    logger.info(
                        "生成回填截断：section=%s attr=%s len=%s limit=%s",
                        section_key,
                        attr,
                        len(value),
                        limit,
                    )
                    value = value[:limit]
                patch[attr] = value
            if patch:
                items[index] = item.model_copy(update=patch)
                changed = True
                backfilled += len(patch)
        if changed:
            updates[resume_field] = items
    if updates:
        logger.info("生成回填完成：字段数=%s", backfilled)
        return resume.model_copy(update=updates)
    return resume


__all__ = [
    "MaterialOnlyEchoError",
    "apply_profile_field_backfill",
    "attach_custom_sections",
    "block_material_only_echo",
    "enforce_material_only_echo",
    "ensure_custom_field_lines_in_resume",
    "merge_missing_consumed_fields",
    "normalize_generated_content",
    "strip_markdown_prefix",
]

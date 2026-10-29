# SPDX-License-Identifier: Apache-2.0
"""从消费 DTO 产出网申三份取数输出：data / catalog / custom_labels（F5 契约 §1）。

**为什么单独一个模块**：网申的数据（整页预填/实时建议）、人工挑选清单、放宽模式的自定义
标签必须来自**同一份字段目录**（需求 v3 R-16）。旧实现里数据来自 profile_map、清单来自
catalog、标签来自 facts 三处各拼一份，加一个字段就要改三处；这里收成一个遍历器
（_iter_fields），三份输出都从它派生，证书编号等私密字段在**这一个出口**就被剔除。

**只消费消费 DTO**（ConsumedProfile）：调用方先用当前组解析出的 scope 读取
load_consumed_profile，因此"未参与分区整键不出现"在数据层就成立——本模块看不到组外
分区，不可能把它们拼进 data/catalog。

字段去向：
- 有网申目录键的新字段（basic_info.name 等）→ 直接落到对应 FORM_FIELDS 键；
- 多条分区（教育/实习/项目/校园/荣誉/技能）→ 按显式条序号展开
  education_1_school / experience_2_company 等动态键，并额外提供第一条/最近一条的
  兼容扁平键（与旧 profile_to_form_data 语义一致）；
- 其余非私密、允许网申取数的字段（含用户自建小字段）→ CUSTOM_<field_id> 键 +
  custom_labels 标签，交给放宽模式按用户自己的字段名匹配；
- 证书资质/语言能力两条历史事实的规范键（professional_cert / language_other）继续由
  新模型聚合产生，避免"补充事实退役后这两栏再也填不上"。

**不处理 R-75 重叠字段**（政治面貌/出生/导师/研究方向）：它们由 overlap_values 唯一裁决，
本模块刻意跳过，避免出现第二份取值实现。
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass

from ....schemas.date_format import normalize_partial_date
from ....schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from ..repeated_fields import field_key_for_block
from .overlap_values import _date_key
from .profile_map import (
    DEGREE_RANK,
    EDUCATION_FLAT_KEYS,
    EXPERIENCE_LATEST_KEYS,
    FIRST_RECORD_FLAT_KEYS,
    WEBFORM_FAMILIES,
    WEBFORM_SINGLE_VALUE_KEYS,
)

# R-75 重叠字段：由 overlap_values 唯一裁决，本模块不产出旧值以免两处矛盾。
_OVERLAP_FIELD_IDS = frozenset({"basic_info.political_status", "basic_info.birth_month"})
# 照片是资源引用（data URL 可能很大），网申目录没有文件控件，永远不进 data/catalog。
_SKIP_FIELD_TYPES = frozenset({"photo"})
_CUSTOM_PREFIX = "CUSTOM_"


@dataclass(frozen=True)
class DefinedFields:
    """同一份定义目录的三份输出；三者在同一次遍历里产生（同源）。"""

    data: Mapping[str, str]
    catalog: tuple[dict[str, str], ...]
    custom_labels: Mapping[str, str]


def _custom_key(field_id: str) -> str:
    return f"{_CUSTOM_PREFIX}{field_id}"


def _ordered(entries: tuple[ConsumedEntry, ...]) -> list[ConsumedEntry]:
    return sorted(entries, key=lambda item: (int(item.sort_order or 0), item.entry_id))


def _value(entry: ConsumedEntry, field_id: str) -> str:
    return str(entry.values.get(field_id) or "").strip()


def _flatten(text: str) -> str:
    """多行文本压成一行（清单/网申框是给人扫的，与旧 catalog 的 _as_block_text 同口径）。"""
    return "；".join(line.strip() for line in text.splitlines() if line.strip())


def _iter_fields(
    consumed: ConsumedProfile,
) -> Iterator[tuple[ConsumedSection, int, ConsumedFieldSpec, str, str | None]]:
    """同一个遍历器：产出（分区, 条目序号, 字段定义, 值, 网申基础键或 None）。

    三条输出都从它派生，任何过滤（私密/照片/不允许网申/重叠字段）只写这一处。
    """
    for section_key in consumed.participating_keys:
        section = consumed.sections.get(section_key)
        if section is None:
            continue
        family = WEBFORM_FAMILIES.get(section_key)
        for position, entry in enumerate(_ordered(section.entries), start=1):
            for spec in section.fields:
                if spec.private or spec.field_type in _SKIP_FIELD_TYPES:
                    continue
                if not spec.webform_allowed or spec.field_id in _OVERLAP_FIELD_IDS:
                    continue
                text = _value(entry, spec.field_id)
                if not text:
                    continue
                if family is not None:
                    base = family[1].get(spec.key)
                else:
                    base = WEBFORM_SINGLE_VALUE_KEYS.get(spec.field_id)
                yield section, position, spec, text, base


def _pick_top_education(entries: list[ConsumedEntry]) -> ConsumedEntry | None:
    """最高学历那一条；同级别取更早的记录（与旧 pick_top_education 一致）。"""
    best: tuple[int, int, ConsumedEntry] | None = None
    for position, entry in enumerate(entries):
        degree = _value(entry, "educations.degree").strip()
        rank = DEGREE_RANK.get(degree, -1)
        candidate = (rank, -position, entry)
        if best is None or (candidate[0], candidate[1]) > (best[0], best[1]):
            best = candidate
    return None if best is None else best[2]


def _latest_by_end(entries: list[ConsumedEntry], field_id: str) -> ConsumedEntry | None:
    """最近一条：进行中/空结束时间视为最新，其次取可解析结束时间的最大者。"""
    best: tuple[tuple[int, tuple[int, int, int]], int, ConsumedEntry] | None = None
    for position, entry in enumerate(entries):
        raw = _value(entry, field_id)
        if not raw or normalize_partial_date(raw) == "至今":
            rank: tuple[int, tuple[int, int, int]] = (2, (9999, 12, 31))
        else:
            key = _date_key(raw)
            rank = (1, key) if key is not None else (0, (0, 0, 0))
        # 同分（都没填结束时间）时取更靠后的一条，与旧 pick_latest_experience 的 id 次序一致。
        candidate = (rank, position, entry)
        if best is None or (candidate[0], candidate[1]) > (best[0], best[1]):
            best = candidate
    return None if best is None else best[2]


def _flat_value(
    section: ConsumedSection, entry: ConsumedEntry, key: str, *, flatten: bool = True
) -> str:
    """派生扁平键也要过同一道过滤：私密/不允许网申/照片字段不能靠"最近一条"绕过。"""
    spec = next((item for item in section.fields if item.key == key), None)
    if spec is None or spec.private or not spec.webform_allowed:
        return ""
    if spec.field_type in _SKIP_FIELD_TYPES:
        return ""
    text = _value(entry, spec.field_id)
    return _flatten(text) if flatten and spec.field_type == "multi_line" else text


def _fill_derived(data: dict[str, str], consumed: ConsumedProfile) -> None:
    """补"第一条/最近一条/最高学历"兼容扁平键；旧调用方与旧页面继续可用。"""
    education_section = consumed.sections.get("educations")
    if education_section is not None:
        top_education = _pick_top_education(_ordered(education_section.entries))
        if top_education is not None:
            for key, form_key in EDUCATION_FLAT_KEYS.items():
                # 教育扁平键沿用旧口径：核心课程/在校成果保留换行（逐条动态键才压平）。
                value = _flat_value(
                    education_section,
                    top_education,
                    key,
                    flatten=key not in {"core_courses", "achievements"},
                )
                if value:
                    data[form_key] = value

    experience_section = consumed.sections.get("experiences")
    if experience_section is not None:
        latest = _latest_by_end(_ordered(experience_section.entries), "experiences.end_date")
        if latest is not None:
            for key, form_key in EXPERIENCE_LATEST_KEYS.items():
                value = _flat_value(experience_section, latest, key)
                if value:
                    data[form_key] = value

    for section_key, flat_map in FIRST_RECORD_FLAT_KEYS.items():
        section = consumed.sections.get(section_key)
        if section is None or not section.entries:
            continue
        first = _ordered(section.entries)[0]
        for key, form_key in flat_map.items():
            value = _flat_value(section, first, key)
            if value:
                data[form_key] = value


def _canonical_text(consumed: ConsumedProfile, section_key: str) -> str:
    """多条分区整列拼成一段规范文本（证书/语言延续旧事实的规范键口径）。"""
    section = consumed.sections.get(section_key)
    if section is None:
        return ""
    parts: list[str] = []
    for entry in _ordered(section.entries):
        values = [
            _value(entry, spec.field_id)
            for spec in section.fields
            if not spec.private and spec.webform_allowed and _value(entry, spec.field_id)
        ]
        if values:
            parts.append("；".join(values))
    return "；".join(parts)


def data_from_consumed(consumed: ConsumedProfile, *, job_title: str = "") -> dict[str, str]:
    """当前组内的简历侧资料 → 网申 data（不含网申专用项与 R-75 重叠值）。"""
    data: dict[str, str] = {}
    for section, position, spec, text, base in _iter_fields(consumed):
        # 多行值在网申 data 里压成一行（文本框/匹配器按整段处理；catalog 同一口径）。
        value = _flatten(text) if spec.field_type == "multi_line" else text
        if base is None:
            data[_custom_key(spec.field_id)] = value
            continue
        family = WEBFORM_FAMILIES.get(section.key)
        key = field_key_for_block(base, family[0], position) if family else base
        data[key] = value
    _fill_derived(data, consumed)
    for section_key, form_key in (
        ("credentials", "professional_cert"),
        ("languages", "language_other"),
    ):
        text = _canonical_text(consumed, section_key)
        if text:
            data[form_key] = text
    title = str(job_title or "").strip()
    if title:
        data["job_intent"] = title
    return {key: str(value).strip() for key, value in data.items() if str(value).strip()}


def catalog_from_consumed(
    consumed: ConsumedProfile, *, job_title: str = ""
) -> list[dict[str, str]]:
    """当前组内的简历侧资料 → 人工挑选清单（与 data 同一次遍历的同源产物）。"""
    rows: list[dict[str, str]] = []
    title = str(job_title or "").strip()
    for section, position, spec, text, base in _iter_fields(consumed):
        group = section.name if section.form == "singleton" else f"{section.name} {position}"
        if base is None:
            key = _custom_key(spec.field_id)
            label = spec.label
        else:
            key = base
            # 清单标签用新模型定义里的中文名（与资料页一致），旧的网申目录标签只服务匹配层。
            label = spec.label
        value = _flatten(text) if spec.field_type == "multi_line" else text
        if key == "job_intent" and title:
            value = title
        rows.append(
            {
                "group": group,
                "label": label,
                "value": value,
                "key": key,
                # **只服务显示层**的稳定 key（``panel_labels`` 按它查英文显示名）：
                # `group` / `label` 的语义不变——它们被「填入」回传、被 `dataset.group`
                # 用于定位/折叠/配色。自建板块的 key 是 `custom:…`，查不到就原样显示。
                "group_key": section.key,
                "group_index": "" if section.form == "singleton" else str(position),
                "label_key": spec.field_id,
            }
        )
    return rows


def custom_labels_from_consumed(consumed: ConsumedProfile) -> dict[str, str]:
    """CUSTOM_ 键 → 用户可读标签（放宽模式按用户自己的字段名匹配）。"""
    labels: dict[str, str] = {}
    for _section, _position, spec, _text, base in _iter_fields(consumed):
        if base is None:
            labels[_custom_key(spec.field_id)] = spec.label
    return labels


def build_defined_fields(consumed: ConsumedProfile, *, job_title: str = "") -> DefinedFields:
    """一次遍历视角的三份输出；调用方（source/catalog）必须整体使用，不各自再拼。"""
    return DefinedFields(
        data=data_from_consumed(consumed, job_title=job_title),
        catalog=tuple(catalog_from_consumed(consumed, job_title=job_title)),
        custom_labels=custom_labels_from_consumed(consumed),
    )


__all__ = [
    "DefinedFields",
    "build_defined_fields",
    "catalog_from_consumed",
    "custom_labels_from_consumed",
    "data_from_consumed",
]

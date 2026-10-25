# SPDX-License-Identifier: Apache-2.0
"""资料大字段定义目录：13 个内置分区的聚合、查询与导入期自检。

13 个大字段与 106 个默认小字段是产品固定口径（需求 v3 §3/R-01/R-09），用户只能隐藏
或加自定义字段；放代码里才能保证各处读到同一份。分区数据与 [新增]/[改名]/[移除] 审计
标记按 1-2 / 3-8 / 9-13 拆在三个 catalog_* 纯数据模块（行格式见 catalog_basic）。

**导入期自检**（契约 §3.4）：13 条 key/名称/顺序/形态、字段 id 全局唯一且等于
"<section_key>.<key>"、承载区字段属于本分区、"仅素材 ⇔ 无承载区"双向一致、
18/4/5/10/12 计数与 §3.2/§3.3 逐项一致；失败即 import 错误。不 import models/DB/schemas。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from . import catalog_basic, catalog_experience, catalog_research

FieldType = Literal["single_line", "multi_line", "date_text", "photo"]
SectionForm = Literal["singleton", "multi"]
_TYPE_BY_CODE: dict[str, FieldType] = {
    "s": "single_line",
    "m": "multi_line",
    "d": "date_text",
    "photo": "photo",
}


@dataclass(frozen=True)
class FieldSpec:
    """默认小字段定义；稳定 id = section_key.key（契约 §1.3/§3.4）。"""

    field_id: str
    section_key: str
    key: str
    label: str
    field_type: FieldType
    order: int
    default_collapsed: bool
    enum_suggestions: tuple[str, ...]
    private: bool
    llm_allowed: bool
    webform_allowed: bool
    is_builtin: bool = True


@dataclass(frozen=True)
class SectionSpec:
    """内置大字段定义；order 是全局顺序 1..13，singleton 等是只读派生。"""

    key: str
    name: str
    form: SectionForm
    order: int
    fields: tuple[FieldSpec, ...]
    carrier_field_key: str | None
    material_only: bool
    provenance: tuple[str, ...]

    @property
    def is_builtin(self) -> bool:
        return True

    @property
    def singleton(self) -> bool:
        return self.form == "singleton"

    @property
    def carrier_field_id(self) -> str | None:
        if self.carrier_field_key is None:
            return None
        return f"{self.key}.{self.carrier_field_key}"


def _build_field(section_key: str, order: int, row: tuple) -> FieldSpec:
    key, label, type_code, collapsed, enum = row[:5]
    flags = tuple(row[5]) if len(row) > 5 else ()
    return FieldSpec(
        field_id=f"{section_key}.{key}",
        section_key=section_key,
        key=key,
        label=label,
        field_type=_TYPE_BY_CODE[type_code],
        order=order,
        default_collapsed=collapsed,
        enum_suggestions=tuple(enum),
        private="private" in flags,
        llm_allowed="no_llm" not in flags and "private" not in flags,
        webform_allowed="no_webform" not in flags and "private" not in flags,
    )


def _build_section(order: int, row: tuple) -> SectionSpec:
    key, name, form, carrier, material_only, provenance, fields = row
    built = tuple(
        _build_field(key, field_order, field_row)
        for field_order, field_row in enumerate(fields, start=1)
    )
    return SectionSpec(
        key=key,
        name=name,
        form=form,
        order=order,
        fields=built,
        carrier_field_key=carrier,
        material_only=material_only,
        provenance=tuple(provenance),
    )


_SECTION_ROWS = (
    *catalog_basic.SECTION_ROWS,
    *catalog_experience.SECTION_ROWS,
    *catalog_research.SECTION_ROWS,
)
BUILTIN_SECTIONS: tuple[SectionSpec, ...] = tuple(
    _build_section(order, row) for order, row in enumerate(_SECTION_ROWS, start=1)
)

# §3.1 的 key/名称/形态/顺序：唯一口径的期望值，import 时与数据逐项核对。
BUILTIN_SECTION_KEYS = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
)
BUILTIN_SECTION_NAMES = (
    "基本信息",
    "教育经历",
    "实习/工作经历",
    "项目经历",
    "专业技能",
    "校园经历",
    "荣誉奖项",
    "个人总结/自我评价",
    "学术成果",
    "科研项目",
    "知识产权",
    "证书资质",
    "语言能力",
)
SINGLETON_SECTION_KEYS = ("basic_info", "summary")
MATERIAL_ONLY_SECTION_KEYS = ("basic_info", "patents", "languages")
SECTION_BY_KEY: dict[str, SectionSpec] = {spec.key: spec for spec in BUILTIN_SECTIONS}
FIELD_BY_ID: dict[str, FieldSpec] = {
    field.field_id: field for spec in BUILTIN_SECTIONS for field in spec.fields
}

# §3.2 审计清单由数据文件按分区维护，这里汇总后核对 18/4/5 与"旧名/旧字段不复现"。
NEW_FIELD_IDS = (
    *catalog_basic.NEW_FIELD_IDS,
    *catalog_experience.NEW_FIELD_IDS,
    *catalog_research.NEW_FIELD_IDS,
)
RENAMED_FIELD_LABELS = (
    *catalog_basic.RENAMED_FIELD_LABELS,
    *catalog_experience.RENAMED_FIELD_LABELS,
)
RENAMED_SECTION_NAMES = catalog_research.RENAMED_SECTION_NAMES
REMOVED_FIELD_LABELS = catalog_experience.REMOVED_FIELD_LABELS
PRIVATE_FIELD_IDS = catalog_research.PRIVATE_FIELD_IDS


def _validate_catalog(sections: tuple[SectionSpec, ...]) -> None:
    """导入期自检（契约 §3.4）：坏数据必须 import 失败，不允许静默降级。"""
    assert len(sections) == 13, "内置大字段必须是 13 个"
    assert tuple(spec.key for spec in sections) == BUILTIN_SECTION_KEYS, "key 或顺序不对"
    assert tuple(spec.name for spec in sections) == BUILTIN_SECTION_NAMES, "中文名不对"
    assert tuple(spec.order for spec in sections) == tuple(range(1, 14)), "order 必须 1..13"
    assert sections[0].key == "basic_info", "基本信息必须首位"
    fields = [field for spec in sections for field in spec.fields]
    assert len(fields) == 106, "默认字段必须是 106 个"
    assert len({field.field_id for field in fields}) == 106, "字段 id 必须全局唯一"
    assert all(field.field_id == f"{field.section_key}.{field.key}" for field in fields)
    assert all(field.field_type in _TYPE_BY_CODE.values() for field in fields)
    assert sum(field.default_collapsed for field in fields) == 10, "默认收起必须是 10 个"
    assert sum(bool(field.enum_suggestions) for field in fields) == 12, "枚举建议必须是 12 组"
    for spec in sections:
        assert spec.form in ("singleton", "multi"), f"{spec.key} 形态不对"
        assert len({field.key for field in spec.fields}) == len(spec.fields), f"{spec.key} key 重复"
        assert len({field.label for field in spec.fields}) == len(spec.fields), (
            f"{spec.key} 标签重复"
        )
        assert (spec.carrier_field_key is None) == spec.material_only, f"{spec.key} 承载区不一致"
        if spec.carrier_field_key is not None:
            assert spec.carrier_field_key in {field.key for field in spec.fields}, "承载区不在分区"
    assert set(SINGLETON_SECTION_KEYS) == {s.key for s in sections if s.form == "singleton"}
    assert set(MATERIAL_ONLY_SECTION_KEYS) == {s.key for s in sections if s.material_only}
    by_id = {field.field_id: field for field in fields}
    assert len(NEW_FIELD_IDS) == 18 and len(set(NEW_FIELD_IDS)) == 18, "新增字段必须是 18 个"
    assert all(field_id in by_id for field_id in NEW_FIELD_IDS), "新增字段清单有无效 id"
    assert len(RENAMED_FIELD_LABELS) + len(RENAMED_SECTION_NAMES) == 4, "改名必须是 4 个"
    assert all(field_id in by_id for field_id, _ in RENAMED_FIELD_LABELS)
    assert not ({old for _, old in RENAMED_FIELD_LABELS} & {field.label for field in fields})
    assert not ({old for _, old in RENAMED_SECTION_NAMES} & {spec.name for spec in sections})
    assert len(REMOVED_FIELD_LABELS) == 5, "移除字段清单必须是 5 个"
    assert not (
        set(REMOVED_FIELD_LABELS)
        & {(spec.key, field.label) for spec in sections for field in spec.fields}
    )
    private = [field for field in fields if field.private]
    assert {field.field_id for field in private} == set(PRIVATE_FIELD_IDS), "私密字段清单不对"
    assert all(not field.llm_allowed and not field.webform_allowed for field in private)


_validate_catalog(BUILTIN_SECTIONS)


def get_section(key: str) -> SectionSpec | None:
    return SECTION_BY_KEY.get(str(key))


def get_field(field_id: str) -> FieldSpec | None:
    return FIELD_BY_ID.get(str(field_id))


def carrier_field(section_key: str) -> FieldSpec | None:
    """该分区的"标签值"承载区字段；仅素材分区或未知分区返回 None。"""
    spec = get_section(section_key)
    if spec is None or spec.carrier_field_key is None:
        return None
    return FIELD_BY_ID.get(f"{spec.key}.{spec.carrier_field_key}")


def default_field_ids(section_key: str) -> tuple[str, ...]:
    """该分区默认小字段的稳定 id（顺序即展示顺序）；未知 key 返回空元组。"""
    spec = get_section(section_key)
    return tuple(field.field_id for field in spec.fields) if spec else ()


def is_singleton(section_key: str) -> bool:
    spec = get_section(section_key)
    return spec.singleton if spec else False


def built_in_seed_section_keys() -> list[str]:
    """建默认组时使用的 13 个内置 key（顺序即全局顺序）。"""
    return list(BUILTIN_SECTION_KEYS)

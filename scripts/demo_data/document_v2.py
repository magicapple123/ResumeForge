# SPDX-License-Identifier: Apache-2.0
"""演示库的 v2 文档内容（字段级文档模型）。

为什么单独一个模块：演示数据的 resume_record.content 现在是 v2 JSON，手写在
resumes_ledger.py 里会把"一份简历长什么样"淹在台账代码里，也不方便守卫测试按位置断言。
这里只负责造"看起来像真实产出"的 v2 简历：

- variant=job：岗位导向版（绑演示岗位 1，岗位带完整 JD），覆盖三种条目头布局、
  自定义短字段（trail）、自定义长文本字段（body）、自建板块与仅素材隐藏项；
- variant=general：通用版（不绑岗位），内容更短，同样含自定义字段与自建板块。

事实全部与演示资料同源（同一所示例大学、同一家示例公司），且是虚构的。自定义字段的
field_id 是资料库随机 uuid，所以内容必须**在资料写完以后**再构造；自定义字段的取值也
从资料条目里读，保证「资料里有什么，简历里就能找到」——这正好是 e2e 检查脚本要断言的性质。

v1 旧简历的夹具是 v1_resume_sample.json（从 v1 代码的 sample_resume_content 冻结，
内容虚构），用来验证"旧简历读时转换"；v2 是唯一的新格式。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.schemas.resume_document import (
    EntryLayout,
    FieldItem,
    FieldSource,
    HeaderItem,
    ListItem,
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeItem,
    ResumeSection,
    SectionLayout,
    TextItem,
    document_to_json,
    normalize_document,
)
from sqlalchemy import select

from demo_data.base import T, engine

V1_SAMPLE_PATH = Path(__file__).with_name("v1_resume_sample.json")
FICTIONAL_MARKER = "示例"


class _Ids:
    """稳定、可读的 item/entry id（OBJECT_ID_PATTERN：8-32 位字母/数字/_/-）。"""

    def __init__(self) -> None:
        self._n = 0

    def take(self, prefix: str) -> str:
        self._n += 1
        return prefix + format(self._n, "06d")


@dataclass(frozen=True)
class CustomFieldRef:
    section_key: str
    field_id: str
    label: str
    field_type: str
    default_placement: str
    material_only: bool


@dataclass(frozen=True)
class CustomSectionRef:
    key: str
    name: str
    fields: tuple[CustomFieldRef, ...] = ()
    entries: tuple[dict[str, str], ...] = ()


def load_v1_sample() -> dict[str, Any]:
    """v1 旧简历夹具（纯虚构；seed 里作为待转换的旧数据，不参与 v2 构造）。"""
    return json.loads(V1_SAMPLE_PATH.read_text(encoding="utf-8"))


def _parse_values(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        return {str(key): str(value) for key, value in raw.items()}
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return _parse_values(parsed)
    return {}


def load_custom_fields() -> dict[tuple[str, str], CustomFieldRef]:
    """当前演示资料库的自定义字段定义，键为 (分区 key, 标签)。"""
    query = select(T["profile_custom_field"]).where(
        T["profile_custom_field"].c.deleted_at.is_(None)
    )
    with engine.connect() as conn:
        rows = conn.execute(query).mappings().all()
    result: dict[tuple[str, str], CustomFieldRef] = {}
    for row in rows:
        ref = CustomFieldRef(
            section_key=str(row["section_key"]),
            field_id=str(row["field_id"]),
            label=str(row["label"]),
            field_type=str(row["field_type"]),
            default_placement=str(row["default_placement"] or ""),
            material_only=bool(row["material_only"]),
        )
        result[(ref.section_key, ref.label)] = ref
    return result


def load_custom_sections() -> dict[str, CustomSectionRef]:
    """自建板块定义 + 条目取值（按自建创建顺序）。"""
    section_table = T["profile_custom_section"]
    field_table = T["profile_custom_field"]
    entry_table = T["profile_entry"]
    with engine.connect() as conn:
        sections = (
            conn.execute(
                select(section_table)
                .where(section_table.c.deleted_at.is_(None))
                .order_by(section_table.c.sort_order.asc())
            )
            .mappings()
            .all()
        )
        fields = (
            conn.execute(select(field_table).where(field_table.c.deleted_at.is_(None)))
            .mappings()
            .all()
        )
        entries = (
            conn.execute(
                select(entry_table)
                .where(entry_table.c.deleted_at.is_(None))
                .order_by(entry_table.c.section_key.asc(), entry_table.c.sort_order.asc())
            )
            .mappings()
            .all()
        )

    fields_by_section: dict[str, list[CustomFieldRef]] = {}
    for row in fields:
        ref = CustomFieldRef(
            section_key=str(row["section_key"]),
            field_id=str(row["field_id"]),
            label=str(row["label"]),
            field_type=str(row["field_type"]),
            default_placement=str(row["default_placement"] or ""),
            material_only=bool(row["material_only"]),
        )
        fields_by_section.setdefault(ref.section_key, []).append(ref)

    result: dict[str, CustomSectionRef] = {}
    for row in sections:
        key = str(row["key"])
        values_list = [
            _parse_values(entry["values"]) for entry in entries if str(entry["section_key"]) == key
        ]
        result[key] = CustomSectionRef(
            key=key,
            name=str(row["name"]),
            fields=tuple(fields_by_section.get(key, ())),
            entries=tuple(item for item in values_list if item),
        )
    return result


def _format_for(field_type: str) -> str:
    if field_type == "date_text":
        return "date"
    if field_type == "enum":
        return "enum"
    if field_type == "number":
        return "number"
    return "text"


def _custom_item(
    ids: _Ids,
    ref: CustomFieldRef,
    value: str,
    *,
    placement: str | None = None,
) -> FieldItem:
    target = placement or ref.default_placement or "trail"
    if ref.material_only:
        target = "hidden"
    body_style = "paragraph" if ref.field_type == "multi_line" else "bullet"
    return FieldItem(
        id=ids.take("it_"),
        key="custom:" + ref.field_id,
        label=ref.label,
        value=value,
        placement=target,  # type: ignore[arg-type]
        format=_format_for(ref.field_type),  # type: ignore[arg-type]
        show_label=True,
        body_style=body_style,  # type: ignore[arg-type]
        source=FieldSource(section_key=ref.section_key, field_id=ref.field_id),
    )


def _builtin(
    ids: _Ids,
    key: str,
    value: str,
    placement: str,
    *,
    fmt: str = "text",
    show_label: bool | None = None,
    solo: bool = False,
) -> FieldItem:
    if show_label is None:
        show_label = placement in ("lead", "trail", "body")
    return FieldItem(
        id=ids.take("it_"),
        key=key,
        value=value,
        placement=placement,  # type: ignore[arg-type]
        format=fmt,  # type: ignore[arg-type]
        show_label=show_label,
        solo=solo,
    )


def _list_item(
    ids: _Ids,
    key: str,
    values: list[str],
    placement: str,
    *,
    join: str = "comma",
    show_label: bool = True,
    solo: bool = False,
) -> ListItem:
    return ListItem(
        id=ids.take("it_"),
        key=key,
        values=values,
        placement=placement,  # type: ignore[arg-type]
        join=join,  # type: ignore[arg-type]
        show_label=show_label,
        solo=solo,
    )


def _text_item(ids: _Ids, text: str, *, style: str = "bullet", hidden: bool = False) -> TextItem:
    return TextItem(id=ids.take("pt_"), style=style, text=text, hidden=hidden)  # type: ignore[arg-type]


def _header(ids: _Ids, key: str, value: str, placement: str, *, fmt: str = "text") -> HeaderItem:
    return HeaderItem(
        id=ids.take("hd_"),
        key=key,
        value=value,
        placement=placement,  # type: ignore[arg-type]
        format=fmt,  # type: ignore[arg-type]
    )


SUMMARY_JOB = (
    "3 年市场与运营经验，主导季度主题营销活动，参与人数 1.2 万、转化率环比提升 18%；"
    "擅长把活动经验沉淀为可复用 SOP，习惯用数据解释结论。"
)
SUMMARY_GENERAL = (
    "3 年市场与运营经验，做过会员拉新与留存实验、内容运营与线下活动；"
    "方向未定时使用这份通用版本，重点突出可迁移的流程与数据能力。"
)

EDU_BODY = ["连续两年获得校级奖学金。"]
EXP_1_BODY = [
    "主导季度主题营销活动，全程负责选题、预算分配与落地执行，参与人数 1.2 万、"
    "活动转化率环比提升 18%，超出季度目标 6 个百分点。",
    "把活动复盘模板沉淀成 SOP，覆盖从立项到复盘的 9 个检查点，团队复用后单场筹备时间"
    "从 10 天压缩到 4 天。",
    "对接 12 家外部渠道并建立效果台账，停投 3 家低效渠道后年度渠道成本下降 15%。",
]
EXP_2_BODY = [
    "负责社群日常维护与内容排期，独立完成选题、撰写与发布，月均产出 20 篇内容，"
    "半年内粉丝净增 3000。",
    "建立内容选题库并按打开率与转发率排序，把高互动选题占比从 25% 提到 48%。",
]
PROJECT_1_BODY = [
    "从 0 到 1 策划校园招聘会，主导场地、企业邀约与现场执行，到会企业 40 家、学生 1200 人。",
    "设计企业侧的一页纸招募说明并在 3 天内完成 40 家邀约确认，到会率 92%。",
]
PROJECT_2_BODY = [
    "参与会员拉新实验的设计与执行，把新客权益拆成 3 组做 A/B 测试，"
    "最终选定的一组把首月留存率提升 9 个百分点。",
]
CAMPUS_BODY = ["统筹 6 场校园活动的宣传排期，协调 8 人小组分工，累计触达 3000 余人次。"]


@dataclass
class _Material:
    ids: _Ids = field(default_factory=_Ids)
    photo: str = ""
    custom_fields: dict[tuple[str, str], CustomFieldRef] = field(default_factory=dict)
    custom_sections: dict[str, CustomSectionRef] = field(default_factory=dict)


def _custom(material: _Material, section_key: str, label: str) -> CustomFieldRef | None:
    return material.custom_fields.get((section_key, label))


def _find_custom_section(material: _Material, name: str) -> CustomSectionRef | None:
    return next(
        (section for section in material.custom_sections.values() if section.name == name),
        None,
    )


def _header_section(material: _Material, *, job_intent: str) -> ResumeHeader:
    ids = material.ids
    items = [
        _header(ids, "name", "张示例", "name"),
        _header(ids, "gender", "女", "name_meta"),
        _header(ids, "job_intent", job_intent, "subtitle"),
        _header(ids, "phone", "138-0000-0000", "contact"),
        _header(ids, "email", "zhang.example@example.com", "contact"),
        _header(ids, "city", "上海", "contact"),
        _header(ids, "birth_year", "2001", "contact"),
        _header(ids, "personal_website", "https://example.com/zhang", "contact"),
    ]
    if material.photo:
        items.append(_header(ids, "photo", material.photo, "photo"))
    return ResumeHeader(items=items, contact_breaks=[])


def _education(material: _Material) -> ResumeSection:
    ids = material.ids
    items: list[ResumeItem] = [
        _builtin(ids, "school", "示例大学", "title"),
        _builtin(ids, "major", "市场营销", "title"),
        _builtin(ids, "degree", "本科", "meta"),
        _builtin(ids, "period", "2019.09|2023.06", "meta", fmt="date_range"),
        _builtin(ids, "gpa", "3.7/4.0", "lead"),
        _list_item(ids, "courses", ["市场调研", "消费者行为", "应用统计"], "lead", join="comma"),
        _builtin(ids, "study_form", "全日制", "trail"),
        _builtin(ids, "degree_type", "统招", "trail"),
        _builtin(ids, "department", "商学院", "trail"),
        _builtin(ids, "rank", "专业前 10%", "trail"),
    ]
    lab = _custom(material, "educations", "课题组")
    if lab is not None:
        items.append(_custom_item(ids, lab, "消费者行为研究组（" + FICTIONAL_MARKER + "）"))
    items.extend(_text_item(ids, line) for line in EDU_BODY)
    entry = ResumeEntry(id=ids.take("en_"), layout=EntryLayout(head="split"), items=items)
    return ResumeSection(
        key="education",
        kind="entries",
        layout=SectionLayout(columns=2, align="equal"),
        entries=[entry],
    )


def _experiences(material: _Material, *, detailed: bool) -> ResumeSection:
    ids = material.ids
    entries: list[ResumeEntry] = []
    first_items: list[ResumeItem] = [
        _builtin(ids, "company", "示例科技有限公司", "title"),
        _builtin(ids, "role", "市场运营专员", "title"),
        _builtin(ids, "period", "2023.07|至今", "meta", fmt="date_range"),
        _builtin(ids, "team_size", "6 人", "trail"),
        _builtin(ids, "experience_kind", "full_time", "trail", fmt="enum"),
    ]
    report_to = _custom(material, "experiences", "汇报对象")
    if report_to is not None:
        first_items.append(_custom_item(ids, report_to, "示例市场总监"))
    first_items.extend(_text_item(ids, line) for line in EXP_1_BODY)
    collaboration = _custom(material, "experiences", "团队协作说明")
    if collaboration is not None and detailed:
        first_items.append(
            _custom_item(
                ids,
                collaboration,
                "活动期与内容、设计、销售三个小组按周对齐目标与排期，"
                "把跨部门确认时间从 3 天压到 1 天。",
                placement="body",
            )
        )
    background = _custom(material, "experiences", "背调联系人")
    if background is not None:
        first_items.append(_custom_item(ids, background, "示例背调人（虚构）"))
    entries.append(
        ResumeEntry(id=ids.take("en_"), layout=EntryLayout(head="stacked"), items=first_items)
    )
    entries.append(
        ResumeEntry(
            id=ids.take("en_"),
            items=[
                _builtin(ids, "company", "示例文化传播有限公司", "title"),
                _builtin(ids, "role", "市场部实习生", "title"),
                _builtin(ids, "period", "2022.06|2022.12", "meta", fmt="date_range"),
                _builtin(ids, "experience_kind", "internship", "trail", fmt="enum"),
                *(_text_item(ids, line) for line in EXP_2_BODY),
            ],
        )
    )
    return ResumeSection(
        key="experience",
        kind="entries",
        layout=SectionLayout(columns=1),
        entries=entries,
    )


def _projects(material: _Material, *, detailed: bool) -> ResumeSection:
    ids = material.ids
    entries: list[ResumeEntry] = [
        ResumeEntry(
            id=ids.take("en_"),
            layout=EntryLayout(head="meta_first"),
            items=[
                _builtin(ids, "name", "校园招聘会策划", "title"),
                _builtin(ids, "role", "项目负责人", "meta"),
                _builtin(ids, "period", "2024.03|2024.06", "meta", fmt="date_range"),
                _list_item(ids, "tech_stack", ["活动策划", "渠道对接", "预算管理"], "trail"),
                _builtin(ids, "project_size", "覆盖 1200 名学生", "trail"),
                *(_text_item(ids, line) for line in PROJECT_1_BODY),
            ],
        )
    ]
    if detailed:
        entries.append(
            ResumeEntry(
                id=ids.take("en_"),
                items=[
                    _builtin(ids, "name", "会员拉新与留存实验", "title"),
                    _builtin(ids, "role", "项目成员", "meta"),
                    _builtin(ids, "period", "2024.07|2024.10", "meta", fmt="date_range"),
                    _list_item(ids, "tech_stack", ["用户增长", "A/B 测试", "数据分析"], "trail"),
                    *(_text_item(ids, line) for line in PROJECT_2_BODY),
                ],
            )
        )
    return ResumeSection(
        key="projects",
        kind="entries",
        layout=SectionLayout(columns=2),
        entries=entries,
    )


def _skills(material: _Material) -> ResumeSection:
    ids = material.ids
    rows = [
        ("活动策划", "熟练", "通用"),
        ("Excel", "熟练", "工具"),
        ("数据复盘", "掌握", "通用"),
        ("沟通协作", "熟练", "通用"),
        ("商务英语", "了解", "语言"),
    ]
    entries = [
        ResumeEntry(
            id=ids.take("en_"),
            items=[
                _builtin(ids, "name", name, "body", show_label=False),
                _builtin(ids, "level", level, "body", show_label=False),
                _builtin(ids, "category", category, "trail"),
            ],
        )
        for name, level, category in rows
    ]
    for entry in entries:
        for item in entry.items:
            if isinstance(item, FieldItem) and item.key == "level":
                item.wrap = "paren"
    return ResumeSection(key="skills", kind="inline", entries=entries)


def _campus(material: _Material) -> ResumeSection:
    ids = material.ids
    return ResumeSection(
        key="campus_experience",
        kind="entries",
        entries=[
            ResumeEntry(
                id=ids.take("en_"),
                items=[
                    _builtin(ids, "organization", "示例大学学生会宣传部", "title"),
                    _builtin(ids, "role", "副部长", "title"),
                    _builtin(ids, "period", "2021.09|2022.06", "meta", fmt="date_range"),
                    _builtin(ids, "activity_type", "学生组织", "trail"),
                    *(_text_item(ids, line) for line in CAMPUS_BODY),
                ],
            )
        ],
    )


def _awards(material: _Material, *, detailed: bool) -> ResumeSection:
    ids = material.ids
    entries = [
        ResumeEntry(
            id=ids.take("en_"),
            items=[
                _builtin(ids, "name", "示例大学一等奖学金", "title"),
                _builtin(ids, "date", "2021.10", "meta", fmt="date"),
                _builtin(ids, "issuer", "示例大学", "trail"),
                _builtin(ids, "level", "校级", "trail"),
            ],
        )
    ]
    if detailed:
        entries.append(
            ResumeEntry(
                id=ids.take("en_"),
                items=[
                    _builtin(ids, "name", "校级优秀学生干部", "title"),
                    _builtin(ids, "date", "2021.05", "meta", fmt="date"),
                    _builtin(ids, "issuer", "示例大学", "trail"),
                    _builtin(ids, "level", "校级", "trail"),
                ],
            )
        )
    return ResumeSection(
        key="awards",
        kind="entries",
        layout=SectionLayout(columns=2),
        entries=entries,
    )


def _custom_section(material: _Material, *, detailed: bool) -> ResumeSection | None:
    ref_section = _find_custom_section(material, "证书与作品")
    if ref_section is None or not ref_section.entries:
        return None
    fields_by_label = {ref.label: ref for ref in ref_section.fields}
    entries: list[ResumeEntry] = []
    ids = material.ids
    for values in ref_section.entries[: (2 if detailed else 1)]:
        items: list[ResumeItem] = []
        for label in ("作品名称", "作品链接", "作品说明"):
            ref = fields_by_label.get(label)
            if ref is None:
                continue
            value = values.get(ref.field_id, "").strip()
            if not value:
                continue
            if label == "作品名称":
                items.append(_custom_item(ids, ref, value, placement="title"))
            elif label == "作品链接":
                items.append(_custom_item(ids, ref, value, placement="trail"))
            else:
                items.append(_custom_item(ids, ref, value, placement="body"))
        if items:
            entries.append(ResumeEntry(id=ids.take("en_"), items=items))
    if not entries:
        return None
    return ResumeSection(
        key=ref_section.key,
        title=ref_section.name,
        kind="entries",
        layout=SectionLayout(columns=1),
        entries=entries,
    )


def build_document(*, variant: str, photo: str = "") -> dict[str, Any]:
    """构造一份 v2 文档并返回可直接写进 resumes.content 的 JSON。

    variant：job（岗位导向，内容更全）/ general（通用版）。
    """
    if variant not in ("job", "general"):
        raise ValueError("variant 只能是 job / general")
    detailed = variant == "job"
    material = _Material(
        photo=photo,
        custom_fields=load_custom_fields(),
        custom_sections=load_custom_sections(),
    )
    job_intent = "市场运营专员" if detailed else "市场 / 运营方向"
    sections: list[ResumeSection] = [
        _education(material),
        _experiences(material, detailed=detailed),
        _projects(material, detailed=detailed),
        _skills(material),
        _campus(material),
        _awards(material, detailed=detailed),
    ]
    sections.append(
        ResumeSection(
            key="summary",
            kind="text",
            entries=[
                ResumeEntry(
                    id=material.ids.take("en_"),
                    items=[
                        _text_item(
                            material.ids,
                            SUMMARY_JOB if detailed else SUMMARY_GENERAL,
                            style="paragraph",
                        )
                    ],
                )
            ],
        )
    )
    custom = _custom_section(material, detailed=detailed)
    if custom is not None:
        sections.append(custom)
    document = ResumeDocument(
        version=2,
        language="zh-CN",
        header=_header_section(material, job_intent=job_intent),
        sections=sections,
    )
    return document_to_json(normalize_document(document))

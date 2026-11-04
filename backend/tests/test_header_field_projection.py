# SPDX-License-Identifier: Apache-2.0
"""问题 6-A：基本信息的 15 个字段都能加进页眉，且**默认生成产物逐字节不变**。

三条互相独立的验收，拆成独立文件（既有投影测试文件都已在 350/500 行预算边缘）：

1. **目录项（可加）**：``document_catalog.HEADER_FIELDS`` 补齐 5 条，带 profile_key 与
   可读标签（中英两表同一份 key）。
2. **投影响应（值从资料来）**：``PaperProjectionOut.header_fields`` 的 value 取自
   ``consumed.section("basic_info")``，**不经过 v1 ResumeContent**——那 5 个字段在 v1 内容
   里根本没有属性，走内容永远取不到值。
3. **生成产物不变（A 方案的核心承诺）**：给 ResumeContent 填满旧白名单的 10 个标量后，
   ``build_header_items`` 的 item 数量与 key 集合与改前完全一致——新增的 5 个 key 在
   ``ResumeContent`` 上没有属性，``getattr(content, key, "")`` 取到空串直接跳过。

判据（第 3 条）说明：本仓库没有"改前产物"可以逐字节对比，所以用两条等价断言替代——
(1) 5 个新 key 不是 ``ResumeContent`` 的字段；(2) 填满旧字段时页眉 item 的 key 集合恰好
等于旧白名单的 10 个、数量为 10（多一个就说明目录把新 key 写进了产物）。
"""

from __future__ import annotations

from dataclasses import replace

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent
from app.services.profile import definition_catalog
from app.services.profile.header_field_values import header_field_value_map
from app.services.profile.paper_projection import build_projection, header_field_options
from app.services.resume.document_catalog import HEADER_FIELD_MAP, HEADER_FIELDS
from app.services.resume.document_conversion_types import ConversionReport
from app.services.resume.document_converter_custom import build_header_items
from app.services.resume.resume_labels import field_labels

# 6-A 新增的 5 个页眉字段（资料「基本信息」里原本没有纸面去路的那些）。
NEW_HEADER_KEYS = (
    "target_city",
    "portfolio_url",
    "political_status",
    "driver_license",
    "available_date",
)

# 改前的 10 个页眉槽位（生成产物必须仍然只有这 10 个可能出现的 key）。
LEGACY_HEADER_KEYS = (
    "name",
    "gender",
    "job_intent",
    "phone",
    "email",
    "city",
    "birth_year",
    "github",
    "personal_website",
    "photo",
)


def _builtin_fields(section_key: str) -> tuple[ConsumedFieldSpec, ...]:
    spec = definition_catalog.get_section(section_key)
    assert spec is not None
    return tuple(
        ConsumedFieldSpec(
            item.field_id,
            item.key,
            item.label,
            item.field_type,
            item.order,
            item.llm_allowed,
            item.webform_allowed,
            item.private,
            True,
        )
        for item in spec.fields
    )


def _section(section_key: str, *entries: ConsumedEntry) -> ConsumedSection:
    spec = definition_catalog.get_section(section_key)
    assert spec is not None
    return ConsumedSection(
        key=section_key,
        name=spec.name,
        form=spec.form,
        carrier_field_id=spec.carrier_field_id,
        material_only=spec.material_only,
        primary_field_id=None,
        fields=_builtin_fields(section_key),
        entries=entries,
    )


def _entry(entry_id: str, section_key: str, sort_order: int = 0, **values: str) -> ConsumedEntry:
    return ConsumedEntry(
        entry_id=entry_id,
        sort_order=sort_order,
        values={f"{section_key}.{key}": value for key, value in values.items()},
    )


def _profile(*sections: ConsumedSection, revision: int = 7) -> ConsumedProfile:
    keys = tuple(section.key for section in sections)
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=keys,
        section_order=keys,
        workspace_revision=revision,
        sections={section.key: section for section in sections},
    )


def _basic_info(**values: str) -> ConsumedSection:
    return _section("basic_info", _entry("e_basic", "basic_info", **values))


# ===== 1. 目录项：15 个字段都可加 =====


def test_catalog_lists_fifteen_header_fields() -> None:
    """目录必须覆盖「基本信息」的 15 个字段（10 个旧槽位 + 5 个新增可加项）。"""
    keys = [spec.key for spec in HEADER_FIELDS]
    assert len(keys) == 15
    assert keys[:10] == list(LEGACY_HEADER_KEYS)
    assert keys[10:] == list(NEW_HEADER_KEYS)


def test_new_header_fields_point_at_real_profile_fields() -> None:
    """每个新目录项都必须指向真实存在的资料字段，且标签在中英两表里都有字。"""
    basic = definition_catalog.get_section("basic_info")
    assert basic is not None
    profile_ids = {builtin.field_id for builtin in basic.fields}
    for language in ("zh-CN", "en-US"):
        labels = field_labels(language)
        for key in NEW_HEADER_KEYS:
            spec = HEADER_FIELD_MAP[key]
            assert spec.profile_key in profile_ids, f"{key} 指向不存在的资料字段"
            assert labels.get(spec.label_key), f"{key} 在 {language} 里没有标签"
            assert spec.placement == "contact"


# ===== 2. 投影响应：值来自资料 =====


def test_header_field_options_carry_profile_values() -> None:
    """「意向城市」等 5 个字段的值直接来自资料快照（与 v1 内容无关）。"""
    consumed = _profile(
        _basic_info(
            name="张三",
            phone="13800000000",
            target_city="上海 / 杭州",
            portfolio_url="https://example.com/work",
            political_status="群众",
            driver_license="C1",
            available_date="随时",
        )
    )
    rows = {row.key: row for row in build_projection(consumed).header_fields}
    assert len(rows) == 15
    assert rows["target_city"].value == "上海 / 杭州"
    assert rows["target_city"].label == "意向城市"
    assert rows["target_city"].placement == "contact"
    assert rows["portfolio_url"].value == "https://example.com/work"
    assert rows["political_status"].value == "群众"
    assert rows["driver_license"].value == "C1"
    assert rows["available_date"].value == "随时"
    # 没填的槽位给空串（用户仍可以把字段加进页眉再自己写）。
    assert rows["city"].value == ""
    # 照片是资源引用不是文本：键保留，值不下发。
    assert rows["photo"].value == ""


def test_header_field_options_follow_resume_language() -> None:
    """标签跟随简历语言（同一份目录，两张表）。"""
    consumed = _profile(_basic_info(target_city="Shanghai"))
    english = {row.key: row for row in header_field_options(consumed, "en-US")}
    assert english["target_city"].label == "Target city"
    assert english["driver_license"].label == "Driver's license"


def test_header_field_options_empty_when_section_not_participating() -> None:
    """组里没有 basic_info 时不编造候选（下拉回落到字段目录）。"""
    consumed = _profile(_section("projects"))
    assert header_field_options(consumed) == []
    assert build_projection(consumed).header_fields == []


def test_header_field_options_never_leak_private_field_values() -> None:
    """私密字段既不下发值、也不出现在候选里（页眉是纸面内容）。"""
    section = _basic_info(political_status="群众")
    marked = replace(
        section,
        fields=tuple(
            replace(spec, private=True) if spec.field_id == "basic_info.political_status" else spec
            for spec in section.fields
        ),
    )
    rows = {row.key: row for row in header_field_options(_profile(marked))}
    assert "political_status" not in rows
    # 其余 14 个目录项照旧（只为这一个字段标了 private）。
    assert len(rows) == 14


def test_header_field_options_are_deterministic() -> None:
    consumed = _profile(_basic_info(target_city="上海"))
    first = [row.model_dump() for row in header_field_options(consumed)]
    second = [row.model_dump() for row in header_field_options(consumed)]
    assert first == second


# ===== 3. 生成产物不变（A 方案的核心承诺）=====


def _full_legacy_content() -> ResumeContent:
    """填满旧白名单的 10 个 v1 标量槽位。"""
    return ResumeContent(
        name="张三",
        gender="男",
        job_intent="后端工程师",
        phone="13800000000",
        email="zhangsan@example.com",
        city="上海",
        birth_year="1995-08",
        github="https://github.com/zhangsan",
        personal_website="https://zhangsan.dev",
        photo="data:image/png;base64,iVBORw0KGgo=",
    )


def test_resume_content_has_no_new_header_attributes() -> None:
    """A 方案的判据之一：5 个新 key 不是 ResumeContent 的字段（不给 v1 加属性）。"""
    content_fields = set(ResumeContent.model_fields)
    for key in NEW_HEADER_KEYS:
        assert key not in content_fields, f"{key} 不该出现在 ResumeContent（B 方案已否决）"


def test_build_header_items_still_emits_only_legacy_keys() -> None:
    """判据之二：填满旧字段时页眉恰好 10 项，key 集合等于旧白名单。"""
    report = ConversionReport()
    items = build_header_items(_full_legacy_content(), report)
    assert len(items) == len(LEGACY_HEADER_KEYS)
    assert {item.key for item in items} == set(LEGACY_HEADER_KEYS)
    assert report.fields_recognized == len(LEGACY_HEADER_KEYS)


def test_build_header_items_skips_empty_new_keys() -> None:
    """空内容仍是空页眉（新目录项拿不到值 → 不产生 item）。"""
    report = ConversionReport()
    assert build_header_items(ResumeContent(), report) == []
    assert report.fields_recognized == 0


# ===== 4. 目录端点带值（6-A · B 方案：field-placement-catalog 的 header 段）=====

CATALOG_API = "/api/profile/field-placement-catalog"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"


def test_header_field_value_map_carries_profile_values() -> None:
    """值表只收录**资料里真有值**的 key；照片与没填的槽位不占位。"""
    consumed = _profile(_basic_info(target_city="上海 / 杭州", political_status="群众"))
    rows = header_field_value_map(consumed)
    assert rows["target_city"] == "上海 / 杭州"
    assert rows["political_status"] == "群众"
    assert "city" not in rows, "没填的字段不该出现在值表里"
    assert "photo" not in rows, "照片是资源引用，不当文本下发"


def test_header_field_value_map_never_leaks_private_values() -> None:
    """私密字段的值一律留空（目录项仍然出现，值不下发）。"""
    section = _basic_info(political_status="群众")
    marked = replace(
        section,
        fields=tuple(
            replace(spec, private=True) if spec.field_id == "basic_info.political_status" else spec
            for spec in section.fields
        ),
    )
    rows = header_field_value_map(_profile(marked))
    assert rows.get("political_status", "") == ""


def test_header_field_value_map_without_basic_info_is_empty() -> None:
    """组里没有 basic_info / 没有快照 → 空表（调用方按空串兜底，不报错）。"""
    assert header_field_value_map(_profile(_section("projects"))) == {}
    assert header_field_value_map(None) == {}


def test_catalog_endpoint_returns_header_values(client) -> None:
    """目录响应带上资料里的当前值（制作台「添加页眉字段」直接带值落地）。"""
    created = client.post(
        ENTRIES_API.format(section_key="basic_info"),
        json={
            "values": {
                "basic_info.name": "张三",
                "basic_info.phone": "13800000000",
                "basic_info.target_city": "上海 / 杭州",
            }
        },
    )
    assert created.status_code == 201, created.text

    response = client.get(CATALOG_API)
    assert response.status_code == 200, response.text
    rows = {row["key"]: row for row in response.json()["header_fields"]}
    assert rows["target_city"]["value"] == "上海 / 杭州"
    assert rows["name"]["value"] == "张三"
    # 没填的槽位与照片：仍是空串（键在、值为空，旧前端读到的形状不变）。
    assert rows["city"]["value"] == ""
    assert rows["photo"]["value"] == ""
    assert rows["target_city"]["placement"] == "contact"
    assert rows["target_city"]["label"]


def test_catalog_endpoint_never_leaks_private_header_values(client, monkeypatch) -> None:
    """端点级私密口径：字段仍可加，值留空（借用目录段唯一的值来源注入一份私密快照）。"""
    section = _basic_info(political_status="群众")
    marked = replace(
        section,
        fields=tuple(
            replace(spec, private=True) if spec.field_id == "basic_info.political_status" else spec
            for spec in section.fields
        ),
    )
    monkeypatch.setattr(
        "app.api.profile_definitions.load_ai_consumed_profile", lambda _db: _profile(marked)
    )
    rows = {row["key"]: row for row in client.get(CATALOG_API).json()["header_fields"]}
    assert "political_status" in rows, "私密字段仍要出现在可加列表里"
    assert rows["political_status"]["value"] == ""


def test_catalog_endpoint_header_values_are_empty_without_profile_data(client) -> None:
    """没有任何资料数据时目录照旧可用，所有 value 为空串。"""
    response = client.get(CATALOG_API)
    assert response.status_code == 200, response.text
    assert all(row["value"] == "" for row in response.json()["header_fields"])

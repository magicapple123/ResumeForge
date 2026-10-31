# SPDX-License-Identifier: Apache-2.0
"""自定义字段纸面位置规则（v2 文档模型 D6，迁移 0069）。

只测纯规则与"资料定义 → 转换器元数据"这一层：有效位置（仅素材→hidden、显式值优先、
否则按类型默认）、非法值拒绝、消费层 ConsumedFieldSpec 携带同一份有效位置。
HTTP 级 CRUD 验收在 tests/test_profile_definitions_api.py。
"""

from __future__ import annotations

import pytest
from app.models.profile_definition import ProfileCustomField
from app.services.profile import field_placement, profile_reader


def _row(**overrides) -> ProfileCustomField:
    values = {
        "field_id": "fld_placement0000001",
        "section_key": "educations",
        "label": "导师姓名",
        "label_key": "导师姓名",
        "field_type": "single_line",
        "sort_order": 0,
        "revision": 1,
    }
    values.update(overrides)
    return ProfileCustomField(**values)


def test_effective_placement_follows_type_defaults():
    # D6：单行/日期 → 正文后灰字（trail）；多行 → 正文块（body）。
    assert field_placement.effective_placement("single_line", None, False) == "trail"
    assert field_placement.effective_placement("date_text", None, False) == "trail"
    assert field_placement.effective_placement("multi_line", None, False) == "body"
    # 未知类型按短字段处理（绝不默认 hidden 吞内容）。
    assert field_placement.effective_placement("mystery", None, False) == "trail"


def test_effective_placement_prefers_explicit_value_and_material_only_wins():
    assert field_placement.effective_placement("single_line", "lead", False) == "lead"
    assert field_placement.effective_placement("multi_line", "meta", False) == "meta"
    # 仅素材字段永不上纸面：即便显式位置写着 trail。
    assert field_placement.effective_placement("single_line", "trail", True) == "hidden"
    assert field_placement.effective_placement("multi_line", None, True) == "hidden"


def test_normalize_default_placement_accepts_six_drawers_and_rejects_others():
    for placement in field_placement.PLACEMENT_ORDER:
        assert field_placement.normalize_default_placement("single_line", placement) == placement
    assert field_placement.normalize_default_placement("single_line", None) is None
    assert field_placement.normalize_default_placement("single_line", "  ") is None
    with pytest.raises(field_placement.ValidationError):
        field_placement.normalize_default_placement("single_line", "sidebar")


def test_field_definition_gives_converter_effective_metadata():
    """转换器拿到的是"有效位置"，不必再实现一遍 D6 默认规则。"""
    plain = field_placement.field_definition(_row())
    assert plain == {
        "section_key": "educations",
        "field_id": "fld_placement0000001",
        "label": "导师姓名",
        "field_type": "single_line",
        "default_placement": "trail",
        "material_only": False,
    }
    multi = field_placement.field_definition(_row(field_type="multi_line"))
    assert multi["default_placement"] == "body"
    explicit = field_placement.field_definition(_row(default_placement="title"))
    assert explicit["default_placement"] == "title"
    material = field_placement.field_definition(_row(default_placement="trail", material_only=True))
    assert material["default_placement"] == "hidden"
    assert material["material_only"] is True


def test_custom_field_definitions_groups_active_fields_by_section(db_session):
    db_session.add_all(
        [
            _row(field_id="fld_placement0000001", section_key="educations", sort_order=0),
            _row(
                field_id="fld_placement0000002",
                section_key="educations",
                label="实验室",
                label_key="实验室",
                sort_order=1,
                field_type="multi_line",
            ),
            _row(
                field_id="fld_placement0000003",
                section_key="projects",
                label="仓库地址",
                label_key="仓库地址",
                material_only=True,
            ),
        ]
    )
    db_session.flush()

    grouped = field_placement.custom_field_definitions(db_session)

    assert [item["field_id"] for item in grouped["educations"]] == [
        "fld_placement0000001",
        "fld_placement0000002",
    ]
    assert grouped["educations"][1]["default_placement"] == "body"
    assert grouped["projects"][0]["default_placement"] == "hidden"
    assert grouped["projects"][0]["material_only"] is True


def test_consumed_field_spec_carries_effective_placement(db_session):
    """消费层（AI 生成 / 投影）与资料页共用同一份有效位置，转 v2 才能一致。"""
    rows = [
        _row(field_id="fld_placement0000001"),
        _row(
            field_id="fld_placement0000002",
            field_type="multi_line",
            label="补充说明",
            label_key="补充说明",
            sort_order=1,
        ),
        _row(
            field_id="fld_placement0000003",
            material_only=True,
            label="证件编号",
            label_key="证件编号",
            sort_order=2,
        ),
    ]
    specs = profile_reader._custom_specs(rows, frozenset(), start_order=3)
    by_id = {spec.field_id: spec for spec in specs}
    assert by_id["fld_placement0000001"].default_placement == "trail"
    assert by_id["fld_placement0000001"].material_only is False
    assert by_id["fld_placement0000002"].default_placement == "body"
    assert by_id["fld_placement0000003"].default_placement == "hidden"
    assert by_id["fld_placement0000003"].material_only is True

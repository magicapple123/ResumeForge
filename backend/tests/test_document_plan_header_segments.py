# SPDX-License-Identifier: Apache-2.0
"""planner：页眉的**标签段 / 值段**拆分（QW-6）。

拆段的目的只有一个——让「字段名」与「字段值」能各自调样式；代价是导出侧必须把它们
并回一整串（PDF / Word / Markdown 三处都按 `contact_field_texts` 合）。所以这里的断言
分两半：**段上有角色与路径**（能定位、能出 CSS），**文本一点没变**（金标不变）。
"""

from __future__ import annotations

from app.services.resume.document_plan import build_document_plan
from app.services.resume.document_plan_format import plain_text


def _header_plan(*items: dict):
    document = {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": list(items), "contact_breaks": []},
        "sections": [],
    }
    return build_document_plan(document).header


def _header_item(
    key: str, value: str, placement: str = "contact", *, item_id: str = "hd_00000001", **extra
) -> dict:
    return {
        "kind": "field",
        "id": item_id,
        "key": key,
        "value": value,
        "placement": placement,
        **extra,
    }


def test_contact_label_and_value_are_separate_segments_with_one_path() -> None:
    header = _header_plan(
        _header_item("phone", "13800000000", label_mode="show"),
        _header_item("github", "github.com/example", item_id="hd_00000002"),
    )
    line = header.contact_lines[0]
    assert [(seg.text, seg.role) for seg in line] == [
        ("电话：", "field_label"),
        ("13800000000", "meta"),
        ("GitHub：", "field_label"),
        ("github.com/example", "meta"),
    ]
    # 标签与值共用同一条路径：点标签、点值都定位到同一个字段（QW-6 验收 4）。
    assert [seg.path for seg in line] == [
        "header.hd_00000001",
        "header.hd_00000001",
        "header.hd_00000002",
        "header.hd_00000002",
    ]
    # 拆段不改变可见文本（导出金标的文本侧不许变）。
    assert plain_text(line) == "电话：13800000000GitHub：github.com/example"


def test_empty_contact_value_stays_a_single_segment() -> None:
    """空值字段整条不产出（"空字段零输出"的既有口径在拆段后不变）。"""
    header = _header_plan(_header_item("phone", "", label_mode="show"))
    assert header.contact_lines == []


def test_subtitle_label_segment_carries_the_field_path() -> None:
    header = _header_plan(_header_item("job_intent", "产品经理", placement="subtitle"))
    assert [(seg.text, seg.role, seg.path) for seg in header.subtitle] == [
        ("求职意向：", "field_label", "header.hd_00000001"),
        ("产品经理", "meta", "header.hd_00000001"),
    ]

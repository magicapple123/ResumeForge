# SPDX-License-Identifier: Apache-2.0
"""v1 -> v2 转换器：逐分区映射、文字不丢、自定义字段行、layout 迁移、幂等（计划 §7/§10.1）。"""

from __future__ import annotations

from app.schemas.resume_document import FieldItem
from app.services.resume.document_converter import (
    convert_content,
    ensure_document_version,
    ensure_document_version_with_report,
)
from tests.document_v1_oracle import historical_values


def _v1_content() -> dict:
    return {
        "name": "张三",
        "gender": "男",
        "job_intent": "产品经理",
        "phone": "13800000000",
        "email": "zhangsan@example.com",
        "github": "github.com/example",
        "summary": "五年产品经验。",
        "education": [
            {
                "id": "aBc12345",
                "school": "上海大学",
                "major": "市场营销",
                "degree": "本科",
                "start_date": "2017-09",
                "end_date": "2021-06",
                "gpa": "3.7/4.0",
                "courses": ["市场调研", "消费者行为学"],
                "achievements": ["国家奖学金", "优秀毕业生"],
                "study_form": "全日制",
            }
        ],
        "experience": [
            {
                "company": "示例科技",
                "role": "产品经理",
                "start_date": "2021-07",
                "end_date": "至今",
                "description": ["负责 A 产品", "主导 B 功能"],
                "team_size": "8 人",
                "experience_kind": "full_time",
            }
        ],
        "projects": [
            {
                "name": "示例项目",
                "role": "负责人",
                "start_date": "2022-01",
                "end_date": "2022-12",
                "tech_stack": ["Python", "React"],
                "description": ["项目描述"],
                "highlights": ["项目亮点"],
                "public_url": "https://example.com/p",
            }
        ],
        "skills": [{"name": "Python", "level": "熟练", "category": "编程"}],
        "languages": [{"name": "英语", "level": "CET-6", "score": "580"}],
        "custom_sections": [
            {
                "key": "custom:abc12345",
                "title": "志愿活动",
                "entries": [
                    {
                        "entry_id": "cDd12345",
                        "text": "社区服务",
                        "lines": [{"label": "角色", "value": "组织者"}],
                    }
                ],
            }
        ],
    }


def _items_by_key(document: dict, section_key: str) -> dict:
    section = next(section for section in document["sections"] if section["key"] == section_key)
    items = {}
    for entry in section["entries"]:
        for item in entry["items"]:
            items.setdefault(item.get("key", item["kind"]), item)
    return items


def test_conversion_places_fields_by_catalog_defaults() -> None:
    document, report = convert_content(_v1_content())
    education = _items_by_key(document.model_dump(exclude_none=True), "education")
    assert education["school"]["placement"] == "title"
    assert education["degree"]["placement"] == "meta"
    assert education["period"]["value"] == "2017-09|2021-06"
    assert education["period"]["format"] == "date_range"
    assert education["gpa"]["placement"] == "lead"
    assert education["courses"]["kind"] == "list"
    assert education["courses"]["placement"] == "lead"
    assert education["study_form"]["placement"] == "trail"
    assert report.fields_recognized > 0
    experience = _items_by_key(document.model_dump(exclude_none=True), "experience")
    assert experience["experience_kind"]["format"] == "enum"
    assert experience["team_size"]["placement"] == "trail"


def test_conversion_keeps_every_text_line() -> None:
    document = convert_content(_v1_content())[0]
    raw = document.model_dump(exclude_none=True)
    texts = [
        item["text"]
        for section in raw["sections"]
        for entry in section["entries"]
        for item in entry["items"]
        if item["kind"] == "text"
    ]
    assert "国家奖学金" in texts
    assert "优秀毕业生" in texts
    assert "负责 A 产品" in texts
    assert "主导 B 功能" in texts
    assert "项目描述" in texts
    assert "项目亮点" in texts
    assert "五年产品经验。" in texts


def test_header_conversion_scalars() -> None:
    document = convert_content(_v1_content())[0]
    header = {item.key: item for item in document.header.items}
    assert header["name"].placement == "name"
    assert header["gender"].placement == "name_meta"
    assert header["job_intent"].placement == "subtitle"
    assert header["phone"].placement == "contact"
    assert header["github"].placement == "contact"


def test_custom_field_hints_are_applied() -> None:
    content = _v1_content()
    content["education"][0]["achievements"] = [
        "国家奖学金",
        "导师：王教授",
        "研究方向说明：细分领域",
    ]
    hints = {
        "educations": [
            {
                "field_id": "field12345",
                "label": "导师",
                "field_type": "single_line",
                "default_placement": "trail",
                "material_only": False,
            },
            {
                "field_id": "field67890",
                "label": "研究方向说明",
                "field_type": "multi_line",
                "default_placement": "body",
                "material_only": False,
            },
            {
                "field_id": "field00001",
                "label": "私密项",
                "field_type": "single_line",
                "default_placement": "trail",
                "material_only": True,
            },
        ]
    }
    content["education"][0]["achievements"].append("私密项：仅素材")
    document, report = convert_content(content, custom_fields=hints)
    items = [item for entry in document.sections[0].entries for item in entry.items]
    by_label = {item.label: item for item in items if isinstance(item, FieldItem)}
    # §7.3：列表承载区里识别出的「标签：值」默认落 body（列表承载体正文，
    # backend-api 2026-10-30 口径）；多行字段仍 body paragraph，仅素材仍 hidden。
    assert by_label["导师"].placement == "trail"
    assert by_label["导师"].key == "custom:field12345"
    assert by_label["研究方向说明"].placement == "body"
    assert by_label["研究方向说明"].body_style == "paragraph"
    assert by_label["私密项"].placement == "hidden"
    assert report.custom_fields_recorded == 3


def test_field_layout_migration() -> None:
    config = {
        "section_order": ["summary", "education"],
        "contact_breaks": ["email"],
        "field_layout": {
            "education": {
                "columns": 2,
                "align": "flow",
                "gap": 2.0,
                "meta_position": "above",
                "order": ["study_form", "gpa"],
                "solo": ["study_form"],
                "hidden": ["research_direction"],
            },
            "entries": {"education": {"aBc12345": {"columns": 3}}},
        },
    }
    document = ensure_document_version(_v1_content(), format_config=config)
    assert document["sections"][0]["key"] == "summary"
    education = next(section for section in document["sections"] if section["key"] == "education")
    assert education["layout"]["columns"] == 2
    assert education["layout"]["align"] == "flow"
    assert education["layout"]["gap"] == 2.0
    assert education["entries"][0]["layout"]["columns"] == 3
    items = {item.get("key"): item for item in education["entries"][0]["items"]}
    # meta_position=above：原 trail 短字段改到 lead
    assert items["study_form"]["placement"] == "lead"
    assert items["study_form"]["solo"] is True
    assert document["header"]["contact_breaks"] == ["email"]


def test_conversion_is_idempotent_and_report_none_for_v2() -> None:
    v2 = ensure_document_version(_v1_content())
    v2_again, report = ensure_document_version_with_report(v2)
    assert report is None
    assert v2_again == v2
    assert ensure_document_version(v2_again) == v2


def test_hidden_points_are_preserved_not_leaked() -> None:
    content = {
        "education": [
            {
                "school": "上海大学",
                "achievements": ["公开要点", "隐藏要点"],
                "courses": ["公开课程", "隐藏课程"],
                "point_ids": {
                    "achievements": ["point0001", "point0002"],
                    "courses": ["point0003", "point0004"],
                },
                "hidden_points": ["point0002", "point0004"],
            }
        ]
    }
    document = ensure_document_version(content)
    entry = document["sections"][0]["entries"][0]
    texts = [item for item in entry["items"] if item["kind"] == "text"]
    assert [(item["text"], item["hidden"]) for item in texts] == [
        ("公开要点", False),
        ("隐藏要点", True),
    ]
    courses = [item for item in entry["items"] if item.get("key") == "courses"][0]
    assert courses["values"] == ["公开课程"]
    assert courses["hidden_values"] == ["隐藏课程"]
    # 分析视图（v2->v1）只服务分析算法，按“纸面上有什么”口径不含隐藏要点；
    # 数据本身在 v2 里完整保留（TextItem.hidden / hidden_values），不丢。
    legacy = historical_values(document)
    assert legacy.education[0].achievements == ["公开要点"]


def test_conversion_preserves_historical_key_values() -> None:
    v2 = ensure_document_version(_v1_content())
    legacy = historical_values(v2)
    assert legacy.name == "张三"
    assert legacy.education[0].school == "上海大学"
    assert legacy.education[0].gpa == "3.7/4.0"
    assert legacy.education[0].courses == ["市场调研", "消费者行为学"]
    assert legacy.education[0].achievements[:2] == ["国家奖学金", "优秀毕业生"]
    assert legacy.skills[0].name == "Python"
    assert legacy.languages[0].certificate == ""
    assert legacy.custom_sections[0].title == "志愿活动"
    assert legacy.custom_sections[0].entries[0].text == "社区服务"


def test_empty_sections_are_not_serialized() -> None:
    document = ensure_document_version({"name": "李四", "education": []})
    assert document["sections"] == []
    assert len(document["header"]["items"]) == 1


def test_conversion_is_deterministic() -> None:
    """同一份 v1 内容两次转换必须得到逐字节相同的 v2 文档（id 稳定）。

    W02「内容没变就不 bump revision」与「两次渲染 HTML 相同」都依赖这一条；随机 id 会让
    内容指纹每次变化，历史/缓存/黄金基线全部失准。
    """
    assert ensure_document_version(_v1_content()) == ensure_document_version(_v1_content())

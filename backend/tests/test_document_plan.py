# SPDX-License-Identifier: Apache-2.0
"""planner：head 三布局 / lead-trail 装箱 / inline / text / header 换行 / 路径契约（计划 §5/§10.1）。

路径契约（2026-10-31 Q27）的粒度是 **item**：同一 item 的多个值段（列表的每个值、
作者的每个名字）共享同一 path；标签、分隔符、括号不是字段本体，path 为空。
"""

from __future__ import annotations

from collections import Counter

import pytest
from app.services.resume.document_converter import ensure_document_version
from app.services.resume.document_plan import build_document_plan, plan_to_text
from app.services.resume.document_plan_format import plain_text


def _document(**overrides) -> dict:
    content = {
        "name": "张三",
        "gender": "男",
        "job_intent": "产品经理",
        "phone": "13800000000",
        "email": "a@example.com",
        "github": "github.com/example",
        "education": [
            {
                "school": "上海大学",
                "major": "市场营销",
                "degree": "本科",
                "start_date": "2017-09",
                "end_date": "2021-06",
                "gpa": "3.7/4.0",
                "courses": ["市场调研", "消费者行为学"],
                "study_form": "全日制",
                "degree_type": "统招",
                "achievements": ["国家奖学金"],
            }
        ],
        "skills": [
            {"name": "Python", "level": "熟练", "category": "编程"},
            {"name": "英语", "level": "CET-6"},
        ],
        "summary": "个人总结段落。",
    }
    content.update(overrides)
    document = ensure_document_version(content)
    return document


def _entry_plan(plan):
    return next(section for section in plan.sections if section.key == "education").entries[0]


def test_head_split_layout_segments() -> None:
    plan = build_document_plan(_document())
    entry = _entry_plan(plan)
    assert entry.head.layout == "split"
    assert plain_text(entry.head.title) == "上海大学 · 市场营销"
    assert plain_text(entry.head.meta) == "本科 · 2017-09 - 2021-06"


def test_head_layout_override() -> None:
    document = _document()
    document["sections"][0]["entries"][0]["layout"] = {"head": "meta_first"}
    plan = build_document_plan(document)
    entry = _entry_plan(plan)
    assert entry.head.layout == "meta_first"
    assert plain_text(entry.head.title).startswith("上海大学")


def test_lead_rows_columns_and_solo() -> None:
    document = _document()
    document["sections"][0]["layout"]["columns"] = 2
    # gpa/courses 在 lead：两列应装成一行
    plan = build_document_plan(document)
    entry_plan = _entry_plan(plan)
    assert len(entry_plan.lead_rows) == 1
    assert len(entry_plan.lead_rows[0]) == 2
    assert plain_text(entry_plan.lead_rows[0][0].segments) == "绩点/排名：3.7/4.0"


def test_solo_takes_own_row() -> None:
    document = _document()
    document["sections"][0]["layout"]["columns"] = 2
    for item in document["sections"][0]["entries"][0]["items"]:
        if item.get("key") == "gpa":
            item["solo"] = True
    plan = build_document_plan(document)
    entry_plan = _entry_plan(plan)
    assert [len(row) for row in entry_plan.lead_rows] == [1, 1]


def test_trail_rows_flow_has_separators() -> None:
    document = _document()
    document["sections"][0]["layout"]["align"] = "flow"
    plan = build_document_plan(document)
    entry_plan = _entry_plan(plan)
    assert entry_plan.trail_rows
    texts = [plain_text(row[0].segments) for row in entry_plan.trail_rows]
    assert any("学习形式：全日制" in text for text in texts)
    assert entry_plan.layout.align == "flow"


def test_body_blocks_keep_order_and_style() -> None:
    plan = build_document_plan(_document())
    entry = _entry_plan(plan)
    body_texts = [plain_text(block.segments) for block in entry.body]
    assert body_texts == ["国家奖学金"]
    assert entry.body[0].kind == "bullet"


def test_inline_rows_and_row_separator() -> None:
    plan = build_document_plan(_document())
    skills = next(section for section in plan.sections if section.key == "skills")
    assert skills.kind == "inline"
    assert len(skills.rows) == 2
    # HTML 改成一行一个 <li> 后不再需要「；」，但 Word/Markdown 是连续文本渲染器，
    # 仍由 planner 给条目分隔符（渲染器不写语言文案）。
    assert skills.row_separator == "；"
    first_row = "".join(plain_text(cell.segments) for cell in skills.rows[0])
    assert "Python" in first_row
    assert "（熟练）" in first_row
    assert "名称：" not in first_row


def test_inline_rows_put_body_before_trail() -> None:
    """Q26：converter 按字段目录产出 item（分类 trail 在最前），planner 要把 body 提到前面。"""
    document = {
        "version": 2,
        "language": "zh-CN",
        "sections": [
            {
                "key": "skills",
                "kind": "inline",
                "entries": [
                    {
                        "id": "ob_skl000001",
                        "items": [
                            {
                                "kind": "field",
                                "id": "it_skl000001",
                                "key": "category",
                                "value": "编程语言",
                                "placement": "trail",
                            },
                            {
                                "kind": "field",
                                "id": "it_skl000002",
                                "key": "name",
                                "value": "Python",
                                "placement": "body",
                                "show_label": False,
                            },
                            {
                                "kind": "field",
                                "id": "it_skl000003",
                                "key": "level",
                                "value": "熟练",
                                "placement": "body",
                                "wrap": "paren",
                                "show_label": False,
                            },
                        ],
                    }
                ],
            }
        ],
    }
    plan = build_document_plan(document)
    row = next(section for section in plan.sections if section.key == "skills").rows[0]
    texts = [plain_text(cell.segments) for cell in row]
    assert texts[0] == "Python"
    assert "熟练" in texts[1]
    # 分类（灰字）排最后，且保留「技能分类：」前缀。
    assert texts[2] == "技能分类：编程语言"


def test_summary_text_section() -> None:
    plan = build_document_plan(_document())
    summary = next(section for section in plan.sections if section.key == "summary")
    assert summary.kind == "text"
    assert plain_text(summary.entries[0].body[0].segments) == "个人总结段落。"


def test_header_contact_breaks_and_photo() -> None:
    content = {
        "name": "张三",
        "phone": "13800000000",
        "email": "a@example.com",
        "github": "github.com/example",
        "photo": (
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
            "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
    }
    document = ensure_document_version(content, format_config={"contact_breaks": ["github"]})
    plan = build_document_plan(document)
    assert plain_text(plan.header.name) == "张三"
    assert len(plan.header.contact_lines) == 2
    assert "GitHub：github.com/example" in plain_text(plan.header.contact_lines[1])
    assert plan.header.photo is not None


def test_hidden_items_and_entries_are_skipped() -> None:
    document = _document()
    entry = document["sections"][0]["entries"][0]
    entry["items"][4]["placement"] = "hidden"  # study_form
    document["sections"][0]["entries"].append(
        {
            "id": "ob_zzzzzzzz",
            "hidden": True,
            "items": [{"kind": "field", "key": "gpa", "value": "不可见", "placement": "lead"}],
        }
    )
    plan = build_document_plan(document)
    entry_plan = _entry_plan(plan)
    all_text = " ".join(plain_text(cell.segments) for row in entry_plan.trail_rows for cell in row)
    assert "学习形式" not in all_text
    assert len(entry_plan.trail_rows) >= 1


def _collect_plan_paths(plan) -> list[str]:
    paths: list[str] = []

    def collect(segments):
        for segment in segments:
            if segment.path:
                paths.append(segment.path)

    collect(plan.header.name)
    for line in plan.header.contact_lines:
        collect(line)
    for section in plan.sections:
        for entry in section.entries:
            collect(entry.head.title)
            collect(entry.head.meta)
            for row in entry.lead_rows + entry.trail_rows:
                for cell in row:
                    collect(cell.segments)
            for block in entry.body:
                collect(block.segments)
        for row in section.rows:
            for cell in row:
                collect(cell.segments)
    return paths


def test_paths_are_item_scoped_and_only_multi_value_items_repeat() -> None:
    """路径粒度是 item：值段可以重复同一路径，但重复只来自多值字段（列表/作者）。"""
    document = _document()
    plan = build_document_plan(document)
    paths = _collect_plan_paths(plan)
    assert paths
    assert all(path.startswith(("education.", "header.", "skills.", "summary.")) for path in paths)
    # 每个路径的最后一段必须是文档里真实存在的 item / header item id。
    item_ids = {
        item["id"]
        for section in document["sections"]
        for entry in section["entries"]
        for item in entry["items"]
    }
    item_ids.update(item["id"] for item in document["header"]["items"])
    assert all(path.rsplit(".", 1)[-1] in item_ids for path in paths)
    # 同一条路径出现多次 = 同一 item 的多个值段；只有列表/作者是这种多值 item。
    kinds = {
        item["id"]: item["kind"]
        for section in document["sections"]
        for entry in section["entries"]
        for item in entry["items"]
    }
    repeated = {path for path, count in Counter(paths).items() if count > 1}
    assert repeated  # 教育经历的 courses 列表有两个值
    assert all(kinds[path.rsplit(".", 1)[-1]] in {"list", "authors"} for path in repeated)


def test_list_and_author_values_carry_the_item_path() -> None:
    """Q27：列表值 / 作者名的每个值段都带 item path，点纸面上任一值都能定位回该 item。"""
    document = {
        "version": 2,
        "language": "zh-CN",
        "sections": [
            {
                "key": "education",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_edu000001",
                        "items": [
                            {
                                "kind": "list",
                                "id": "it_edu000001",
                                "key": "courses",
                                "values": ["市场调研", "消费者行为"],
                                "placement": "lead",
                                "join": "comma",
                            }
                        ],
                    }
                ],
            },
            {
                "key": "publications",
                "kind": "entries",
                "entries": [
                    {
                        "id": "ob_pub000001",
                        "items": [
                            {
                                "kind": "authors",
                                "id": "it_pub000001",
                                "key": "authors",
                                "authors": [
                                    {"name": "张示例", "is_self": True},
                                    {"name": "李示例", "corresponding": True},
                                ],
                                "placement": "trail",
                            }
                        ],
                    }
                ],
            },
        ],
    }
    plan = build_document_plan(document)
    education = next(section for section in plan.sections if section.key == "education")
    courses_cell = education.entries[0].lead_rows[0][0]
    course_path = "education.ob_edu000001.it_edu000001"
    values = [seg for seg in courses_cell.segments if seg.text in {"市场调研", "消费者行为"}]
    assert [seg.path for seg in values] == [course_path, course_path]
    # 逗号分隔符不是字段本体：不带 path。
    separators = [seg for seg in courses_cell.segments if seg.text == "、"]
    assert separators and all(seg.path == "" for seg in separators)

    publications = next(section for section in plan.sections if section.key == "publications")
    authors_cell = publications.entries[0].trail_rows[0][0]
    author_path = "publications.ob_pub000001.it_pub000001"
    names = [seg for seg in authors_cell.segments if seg.text in {"张示例", "李示例"}]
    assert [seg.path for seg in names] == [author_path, author_path]
    # 通讯作者的星号与顿号分隔符是装饰：不带 path。
    decorations = [seg for seg in authors_cell.segments if seg.text in {"*", "、"}]
    assert decorations and all(seg.path == "" for seg in decorations)


def test_plan_to_text_contains_all_values() -> None:
    plan = build_document_plan(_document())
    lines = plan_to_text(plan)
    joined = " ".join(lines)
    for expected in (
        "张三",
        "上海大学",
        "市场营销",
        "3.7/4.0",
        "国家奖学金",
        "Python",
        "个人总结段落。",
    ):
        assert expected in joined


def test_planner_rejects_v1_content() -> None:
    with pytest.raises(ValueError):
        build_document_plan({"name": "张三"})

# SPDX-License-Identifier: Apache-2.0
"""页眉联系方式唯一实现的纯函数契约（`resume_contact`）。

字段顺序 / 展示文案 / 强制换行不再由 HTML、PDF、Word 各写一份：三处都消费这里的
`contact_items` / `contact_groups`。本文件把"字段表只有一份"这件事钉成回归——
将来谁在某个渲染器里再手写一份字段清单，就会与这里的顺序/文案对不上。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent
from app.services.resume.resume_contact import (
    CONTACT_FIELDS,
    WORD_SEPARATOR,
    contact_entries,
    contact_groups,
    contact_items,
    contact_lines,
    validate_contact_breaks,
)
from app.services.resume.resume_labels import field_labels

LABELS = field_labels("zh-CN")
EN_LABELS = field_labels("en-US")

RESUME = ResumeContent(
    name="张三",
    phone="13800001234",
    email="zhangsan@example.com",
    city="杭州",
    birth_year="1998",
    github="https://github.com/zhangsan",
    personal_website="https://zhangsan.dev",
)


def test_contact_field_order_is_frozen():
    """字段顺序是跨链路契约（HTML / PDF / Word 都按它排），改动必须同步三处测试。"""
    assert CONTACT_FIELDS == (
        "phone",
        "email",
        "city",
        "birth_year",
        "github",
        "personal_website",
    )


def test_contact_entries_keep_order_and_skip_empty_fields():
    """按固定顺序取值；空字段不产生条目（不留空 span / 多余分隔符）。"""
    resume = ResumeContent(name="张三", phone="138", city="杭州", personal_website="x.dev")
    assert contact_entries(resume, LABELS) == [
        ("phone", "138"),
        ("city", "杭州"),
        ("personal_website", "个人主页：x.dev"),
    ]


def test_contact_entries_use_the_paper_language_for_labels():
    """网址类字段的标签走语言包（中文「个人主页」/ 英文 Website），不是硬编码。"""
    labels = dict(contact_entries(RESUME, EN_LABELS))
    assert labels["github"] == "GitHub：https://github.com/zhangsan"
    assert labels["personal_website"] == "Website：https://zhangsan.dev"
    assert (
        dict(contact_entries(RESUME, LABELS))["personal_website"]
        == "个人主页：https://zhangsan.dev"
    )


def test_contact_items_put_break_before_only_where_configured():
    """break_before 只落在被配置的字段上，第一个可见字段永远不加（前面换行无意义）。"""
    items = contact_items(RESUME, LABELS, ["phone", "personal_website"])
    assert [item["key"] for item in items] == list(CONTACT_FIELDS)
    assert items[0]["break_before"] is False, "第一个字段之前不该有强制换行"
    assert [item["break_before"] for item in items[1:]] == [False, False, False, False, True]

    default_items = contact_items(RESUME, LABELS)
    assert all(item["break_before"] is False for item in default_items)


def test_contact_groups_split_on_forced_breaks_only():
    """组与组之间强制换行，组内字段可以自动装行；展示文本与 contact_items 一致。"""
    items = contact_items(RESUME, LABELS, ["github"])
    groups = contact_groups(items)
    assert groups == [
        ["13800001234", "zhangsan@example.com", "杭州", "1998"],
        ["GitHub：https://github.com/zhangsan", "个人主页：https://zhangsan.dev"],
    ]


def test_contact_lines_join_each_group_with_the_word_separator():
    """Word 用的行文本：组内字段用全角空格（Word 的断行点）连起来。"""
    items = contact_items(RESUME, LABELS, ["personal_website"])
    lines = contact_lines(items, WORD_SEPARATOR)
    assert len(lines) == 2
    assert lines[0].startswith("13800001234")
    assert lines[1] == "个人主页：https://zhangsan.dev"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, []),
        ("", []),
        ([], []),
        (["bogus"], []),
        (["github", "bogus", "github"], ["github"]),
        (("website",), []),
        (["email", "github"], ["email", "github"]),
        # 按字段顺序归一，而不是按用户输入顺序：字段顺序是固定的。
        (["personal_website", "phone"], ["phone", "personal_website"]),
    ],
)
def test_validate_contact_breaks_whitelists_and_normalizes(raw, expected):
    """脏输入一律白名单化：未知键丢弃、去重、按字段顺序输出（绝不 422 / 500）。"""
    assert validate_contact_breaks(raw) == expected

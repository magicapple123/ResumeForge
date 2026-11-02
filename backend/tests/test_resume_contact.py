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
    pack_contact_lines,
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
    """Word 用的行文本：组内字段用**两个半角空格**连起来（#9 起不再用全角空格）。"""
    items = contact_items(RESUME, LABELS, ["personal_website"])
    lines = contact_lines(items, WORD_SEPARATOR)
    assert len(lines) == 2
    assert lines[0].startswith("13800001234")
    assert lines[1] == "个人主页：https://zhangsan.dev"
    # 全角空格会在 Word「显示编辑标记」时变成 □□，2026-11 #9 已改成半角。
    assert "\u3000" not in lines[0]


# ===== 装行纯函数（2026-11 #9：PDF 与 Word 共用）========================


def _measure_by_char(text: str) -> float:
    """每字符 1 个宽度单位：让装行结果与具体字体无关、可期望。"""
    return float(len(text))


def test_pack_contact_lines_breaks_inside_a_group_by_width():
    """组内按宽度装行：5 个字段、每行 10 个单位时切成多行。"""
    groups = [["1234567890", "abcdefghij", "张三", "1998"]]
    packed = pack_contact_lines(groups, 22, _measure_by_char, "  ")
    assert packed == [["1234567890", "abcdefghij"], ["张三", "1998"]]


def test_pack_contact_lines_never_merges_across_groups():
    """跨组是用户显式要求的强制换行：装行只能在组内做，绝不能合并。"""
    groups = [["13800001234"], ["GitHub：https://github.com/zhangsan"]]
    packed = pack_contact_lines(groups, 1000, _measure_by_char, "  ")
    assert packed == [["13800001234"], ["GitHub：https://github.com/zhangsan"]]


def test_pack_contact_lines_keeps_an_overlong_field_on_its_own_line():
    """单个字段比整行还宽时独占一行并如实溢出，不从中间劈开。"""
    overlong = "https://example.com/" + "x" * 200
    groups = [["13800001234", overlong, "杭州"]]
    packed = pack_contact_lines(groups, 40, _measure_by_char, "  ")
    assert [overlong] in packed
    assert all("".join(line) != "" for line in packed)


def test_pack_contact_lines_without_a_measure_falls_back_to_one_line_per_group():
    """拿不到字体度量时退回"整组一行、交给下游自己换行"（不阻塞导出）。"""
    groups = [["13800001234", "zhangsan@example.com"], ["杭州"]]
    assert pack_contact_lines(groups, 10, None, "  ") == groups
    assert pack_contact_lines(groups, 0, _measure_by_char, "  ") == groups


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

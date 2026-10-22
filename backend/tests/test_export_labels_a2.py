# SPDX-License-Identifier: Apache-2.0
"""A2（字段前缀 / 列表分隔符 / 等级与性别括号）的验收断言。

从 ``test_export_labels.py`` 拆出来的原因只有一个：仓库 500 行测试文件预算
（``tests/test_file_size_budget.py``）。断言与样本仍与 A1 共用
``export_label_samples``，所以"同一次渲染、标题与前缀两处断言"的口径没有变——
拆的只是文件边界，不是验证口径。
"""

from __future__ import annotations

import re

import pytest
from app.schemas.resume import ResumeContent
from app.services.exporter import render_html
from app.services.resume.resume_labels import field_labels
from tests.export_label_samples import _plain, _products, needs_font

# ===== 9. A2：字段前缀 / 分隔符 / 等级括号 =====
#
# 这一节是本批（A2）新增的。批 2 只统一了七个分区标题，产物里仍会印出
# `EDUCATION` + `绩点/排名：3.8` 这种"一半中文"的东西——用户一眼就看得出没做完。

# 每个字段前缀"真的会印在哪些链路里"。这不是 A2 引入的差异，而是各格式页头/正文的既有
# 结构不同——写清楚比"全都断言一遍然后发现三处本来就是对的"更省事：
#   * `gpa` / `courses` / `tech_stack` 在正文分区里，五条链路都有；
#   * `intent` 只有三条：Markdown 的 H1 把求职意向拼在姓名后面（`# 姓名 · 求职意向`），
#     本来就没有"前缀 + 冒号"的形态；
#   * `github` / `website` 只有 PDF 与 HTML：Word 的页头从不拼这两个字段，Markdown 的
#     联系方式行也一直只有电话/邮箱/城市/出生年。
PREFIX_CHAINS: dict[str, tuple[str, ...]] = {
    "gpa": ("pdf", "docx", "html", "md", "txt"),
    "courses": ("pdf", "docx", "html", "md", "txt"),
    "tech_stack": ("pdf", "docx", "html", "md", "txt"),
    "intent": ("pdf", "docx", "html"),
    "github": ("pdf", "html"),
    "website": ("pdf", "html"),
}


@needs_font
@pytest.mark.parametrize("language", ["zh-CN", "en-US"])
def test_field_prefixes_are_the_same_in_every_chain(language: str):
    """同一个语言下，凡是要印这个前缀的链路，印出来的词必须**逐字相同**。

    逐条断言而不是只断英文：只断"英文前缀在场"的话，一个"中英混排"的实现也会通过。
    """
    labels = field_labels(language)
    products = {fmt: _plain(text) for fmt, text in _products(language).items()}

    for key, chains in PREFIX_CHAINS.items():
        expected = _plain(labels[key])
        missing = [fmt for fmt in chains if expected not in products[fmt]]
        assert not missing, f"{language}：前缀 {labels[key]!r} 没出现在 {missing}"


def _separator_sample() -> ResumeContent:
    """只用来验分隔符与括号的小样本：两个课程、两个技术栈、一个带等级的技能、一个性别。"""
    return ResumeContent(
        name="林致远",
        gender="男",
        summary="十年经验。",
        education=[
            {
                "school": "星辰",
                "major": "计算机",
                "degree": "本科",
                "courses": ["数据结构", "操作系统"],
            }
        ],
        projects=[{"name": "网关", "tech_stack": ["Python", "MySQL"]}],
        skills=[{"name": "Python", "level": "Expert"}],
    )


def _without_tags(source: str) -> str:
    """去掉 HTML 标签但**不插空格**：分隔符落在两个 `<span>` 之间时，标签会把它劈开。

    `_html_text`（剥标签时补空格）适合"字有没有出现"，不适合"拼接形态长什么样"。
    """
    return re.sub(r"<[^>]+>", "", source)


@needs_font
def test_en_uses_halfwidth_separators_and_level_brackets():
    """`en-US`：列表分隔符是 `", "`、等级/性别括号是半角，且**不出现**中文顿号。"""
    products = _products("en-US", _separator_sample())

    for fmt, text in products.items():
        compact = _plain(text)
        assert "、" not in compact, f"{fmt} 里还有中文顿号分隔符"
        assert "数据结构,操作系统" in compact, f"{fmt} 的课程没用 `, ` 拼接"
        assert "Python,MySQL" in compact, f"{fmt} 的技术栈没用 `, ` 拼接"
        assert "Python(Expert)" in compact, f"{fmt} 的等级不是半角括号"

    # `", "` 的**尾随空格**必须真的存在（不是只把顿号删掉）。PDF 抽文本不保证留空格，
    # 所以这条只对三个文本类产物断言；HTML 的分隔符夹在两个 `<span>` 之间，而
    # `_products()` 里的 html 已经"剥标签并补空格"过，所以这里重新取一次原始 HTML 再剥。
    for fmt in ("md", "txt", "docx"):
        assert "数据结构, 操作系统" in products[fmt], f"{fmt} 丢了 `, ` 的尾随空格"
    raw_html = render_html(_separator_sample(), language="en-US")
    assert "数据结构, 操作系统" in _without_tags(raw_html)

    # 性别括号（只出现在 Markdown 链路）跟着语言换成半角 + 前导空格。
    assert "林致远 (男)" in products["md"]


@needs_font
def test_zh_keeps_the_fullwidth_separator_and_brackets():
    """`zh-CN` 侧一个字符都不许变——这是"默认零回归"在 A2 上的正面证据。

    注意断言的是**成品文案**（`Python（Expert）` / `数据结构、操作系统`），不是"没有英文"：
    中文简历里本来就可能有英文技能名，用"不含英文"来验会误伤。
    """
    products = _products("zh-CN", _separator_sample())
    rendered = {fmt: _plain(text) for fmt, text in products.items()}

    for fmt, compact in rendered.items():
        assert "数据结构、操作系统" in compact, f"{fmt} 的课程分隔符变了"
        assert "Python、MySQL" in compact, f"{fmt} 的技术栈分隔符变了"
        assert "Python（Expert）" in compact, f"{fmt} 的等级括号变了"

    assert "林致远（男）" in products["md"]

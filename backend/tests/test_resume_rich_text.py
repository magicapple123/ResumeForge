# SPDX-License-Identifier: Apache-2.0
"""字符级加粗标记（``**``）的解析：切分、剥离、HTML 收口、编辑器切换。

这些用例的价值在于**边界**：标记解析错一个字符，用户的简历就会多出一对星号，或者
一段本不该加粗的文字被加粗——两种都不是"报错"，而是静默的产物损坏。所以这里把
空串、未闭合、``****``、跨换行、HTML 实体、中文标点、幂等、toggle 边界全部钉住。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_rich_text import (
    MARKER,
    apply_rich_html,
    has_bold,
    is_bold,
    parse_runs,
    strip_markers,
    toggle_bold,
)

# ===== parse_runs：切分 =====


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", []),
        ("纯文本", [("纯文本", False)]),
        ("**加粗**", [("加粗", True)]),
        ("前**中**后", [("前", False), ("中", True), ("后", False)]),
        # 两段加粗：中间那截是普通文字。
        ("a**b**c**d**e", [("a", False), ("b", True), ("c", False), ("d", True), ("e", False)]),
        # 段首、段尾。
        ("**头**身子", [("头", True), ("身子", False)]),
        ("身子**尾**", [("身子", False), ("尾", True)]),
        # 未闭合：** 按字面保留，不吞、不改写。
        ("a**b", [("a**b", False)]),
        ("**只有开头", [("**只有开头", False)]),
        ("a**b**c**", [("a", False), ("b", True), ("c**", False)]),
        # 空标记：成对但中间什么都没有 → 不产出空区间。
        ("****", []),
        ("a****b", [("a", False), ("b", False)]),
        # 跨换行照常配对（一个字段内的正文可以有多行）。
        ("第一行\n**第二行**", [("第一行\n", False), ("第二行", True)]),
        # 中文标点与数字。
        ("**负责**：接口，性能…提升 30%", [("负责", True), ("：接口，性能…提升 30%", False)]),
        # HTML 实体原样保留（转义已经在上游做过）。
        ("a&amp;b**c**", [("a&amp;b", False), ("c", True)]),
        # 只有一个星号：不是标记。
        ("a*b", [("a*b", False)]),
        # 连续四段加粗（相邻空对不会把它们粘在一起）。
        ("**a****b**", [("a", True), ("b", True)]),
    ],
)
def test_parse_runs(text, expected):
    assert parse_runs(text) == expected


def test_parse_runs_is_idempotent_and_preserves_visible_text():
    text = "前**中**后**未闭合"
    assert parse_runs(text) == parse_runs(text)
    visible = "".join(segment for segment, _ in parse_runs(text))
    assert visible == "前中后**未闭合"


# ===== strip_markers：可见文本 =====


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", ""),
        ("无标记", "无标记"),
        ("**加粗**", "加粗"),
        ("前**中**后", "前中后"),
        # 未配对的星号必须原样留下：那是用户真想印出来的字符。
        ("a**b", "a**b"),
        ("a**b**c**", "ab" + "c**"),
        ("****", ""),
        ("**一**二**三**", "一二三"),
        ("**多行\n加粗**", "多行\n加粗"),
        ("a*b", "a*b"),
    ],
)
def test_strip_markers(text, expected):
    assert strip_markers(text) == expected


@pytest.mark.parametrize("text", ["", "无标记", "**加粗**", "a**b**c**", "****", "a**b"])
def test_strip_markers_is_idempotent(text):
    once = strip_markers(text)
    assert strip_markers(once) == once


# ===== has_bold：PDF 是否要开 markdown =====


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", False),
        ("普通正文", False),
        ("未配对的 ** 星号", False),
        # 日期区间里的 `--` 会让 fpdf2 的 markdown 模式误解，所以只有成对 `**` 才算数。
        ("2020--2023 在某公司", False),
        ("**加粗**", True),
        ("前**中**后", True),
    ],
)
def test_has_bold(text, expected):
    assert has_bold(text) is expected


# ===== apply_rich_html：HTML 收口 =====


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("<p>**粗**</p>", "<p><strong>粗</strong></p>"),
        ("<p>前**中**后</p>", "<p>前<strong>中</strong>后</p>"),
        # 未配对不产生标签，也不吞星号。
        ("<p>a**b</p>", "<p>a**b</p>"),
        # 属性值里的 `**` 不许动。
        ('<p class="a**b**c">正文</p>', '<p class="a**b**c">正文</p>'),
        # `<style>` / `<script>` 的内容不是可见正文。
        (
            "<style>p::after{content:'**x**'}</style><p>**粗**</p>",
            "<style>p::after{content:'**x**'}</style><p><strong>粗</strong></p>",
        ),
        ("<script>var a='**x**'</script>", "<script>var a='**x**'</script>"),
        # 注释同样跳过（不仅仅是"看起来像注释"）。
        ("<!-- **注释** --><p>**粗**</p>", "<!-- **注释** --><p><strong>粗</strong></p>"),
        # 标记不跨标签：天然不会把已有 <strong> 再包一层。
        ("<strong>**粗**</strong>", "<strong><strong>粗</strong></strong>"),
        # 跨标签的一对 `**` 各自落单 → 按字面保留（宁可留星号，也不要跨标签乱包）。
        ("<p>**前</p><p>后**</p>", "<p>**前</p><p>后**</p>"),
        # 没有标记时原样返回（含大小写与空白）。
        ("<p>没有标记</p>", "<p>没有标记</p>"),
    ],
)
def test_apply_rich_html(html, expected):
    assert apply_rich_html(html) == expected


def test_apply_rich_html_handles_cdata_and_unclosed_script():
    assert apply_rich_html("<![CDATA[ **x** ]]>") == "<![CDATA[ **x** ]]>"
    # `<script>` 没闭合就把余下全文都当脚本内容，不再替换。
    assert apply_rich_html("<script>**x**") == "<script>**x**"


# ===== is_bold / toggle_bold：编辑器 =====


@pytest.mark.parametrize(
    ("text", "start", "end", "expected"),
    [
        ("abcdef", 0, 3, False),
        ("**abc**def", 2, 5, True),
        ("**abc**def", 0, 9, False),  # 选区跨过粗体与普通文字 → 不是"全粗"
        ("**abc**", 0, 9, True),
        ("abcdef", 3, 3, False),  # 空选区
    ],
)
def test_is_bold(text, start, end, expected):
    assert is_bold(text, start, end) == expected


def test_is_bold_offsets_are_source_offsets():
    text = "**abc**"
    # 源串里 "a" 在偏移 2；直观的"第 0 个可见字符"不是源偏移。
    assert is_bold(text, 2, 3) is True
    assert is_bold(text, 0, 1) is False


@pytest.mark.parametrize(
    ("text", "start", "end", "expected"),
    [
        ("abcdef", 1, 3, "a**bc**def"),
        ("abcdef", 0, 6, "**abcdef**"),
        # 已全粗 → 取消。
        ("**abc**", 0, 9, "abc"),
        ("**abc**", 2, 5, "abc"),
        # 选区落在粗体内部 → 扩展到标记边界后取消（不留半对）。
        ("**ab**cd", 1, 3, "abcd"),
        # 部分粗 → 选区内整段加粗，相邻区间合并，不产出 `**a****b**`。
        # 注意偏移是**源串**偏移：`c` 在 6，所以选区 [2,6) 不含它。
        ("**a**bc", 2, 6, "**ab**c"),
        # 空选区 / 空串不动。
        ("abc", 2, 2, "abc"),
        ("", 0, 0, ""),
        # 越界偏移按夹紧处理。
        ("abc", -5, 99, "**abc**"),
    ],
)
def test_toggle_bold(text, start, end, expected):
    assert toggle_bold(text, start, end) == expected


@pytest.mark.parametrize("text", ["abcdef", "**abc**", "a**b**c", "**ab**cd", "a**b**c**"])
def test_toggle_bold_never_changes_visible_text(text):
    for start, end in ((1, 3), (0, len(text)), (2, 4)):
        toggled = toggle_bold(text, start, end)
        assert strip_markers(toggled) == strip_markers(text), (text, start, end)


def test_toggle_bold_is_reversible_for_visible_text():
    first = toggle_bold("abcdef", 1, 3)
    assert first == "a**bc**def"
    # 同偏移再点一次：可见文本不变（前端每次都会用新串重新算偏移，这里只钉"不改字"）。
    assert strip_markers(toggle_bold(first, 1, 3)) == "abcdef"
    # 用**新串**的偏移（标记占了 4 个字符）再点一次才是"取消加粗"。
    assert toggle_bold(first, 3, 5) == "abcdef"


def test_marker_constant_is_two_asterisks():
    assert MARKER == "**"

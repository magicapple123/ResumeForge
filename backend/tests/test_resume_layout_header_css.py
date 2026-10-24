# SPDX-License-Identifier: Apache-2.0
"""模板 CSS ↔ 注册表：页头对齐、照片侧、四边页边距（P0-8 的三个新键）。

**为什么要单独一个文件**：`test_resume_layout_templates.py` 已经 474 行、贴着
`test_file_size_budget` 的 500 行顶线（测试文件同样在扫描范围内），所以在那里追加
反而会把它推过线。本文件承接同一个口径（期望值从注册表读、拿模板 CSS 反推后比对，
不在这里另抄一份取值），只覆盖本次新增的三条声明：

* ``header_align``      ← 模板 `.header` 的 `text-align`（elegant = center，其余 left）；
* ``header_photo_side`` ← 模板 `.header` 的 `flex-direction`（`row-reverse` ⇒ 照片在左）；
* ``padding_sides_mm``  ← `body` 的 `padding` 两值简写（`16mm 18mm` ⇒ 左右 18mm）。

这三条此前 PDF 一条都没读：于是"优雅模板在草稿里姓名居中、照片在左，导出的 PDF 姓名靠左、
照片在右"，页边距则四边相等（左右各差 2mm）。模板改了声明而注册表没跟上，这里立刻变红。

helper 从 `test_resume_layout_templates.py` 单向导入（兄弟文件复用的既有约定）。
"""

from __future__ import annotations

import re

import pytest
from app.services.resume.resume_template_catalog import RESUME_TEMPLATES
from app.services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS
from app.services.resume.resume_templates import TEMPLATES_DIR
from test_resume_layout_templates import _selector_block


def _header_align(header: str) -> str:
    """由 `.header` 的 `text-align` 反推对齐（没写 = 继承左对齐）。"""
    return "center" if "text-align: center" in header else "left"


def _header_photo_side(header: str) -> str:
    """由 `.header` 的 `flex-direction` 反推照片侧。

    草稿的 DOM 顺序是 `[文字块, 照片]`（`_resume_sections.j2`），所以默认 `row` ⇒ 照片在
    **右**；`row-reverse` 把两者对调 ⇒ 照片在**左**。这是"照片在哪一侧"在 CSS 里的唯一出处，
    PDF 侧不再自己猜。
    """
    return "left" if "flex-direction: row-reverse" in header else "right"


def _body_padding_sides(css: str) -> tuple[float, float] | None:
    """由 `body { padding: ... }` 反推左右边距；单值简写返回 ``None``（= 四边相等）。

    只认 `padding: <n>mm`（四边相等）与 `padding: <n>mm <n>mm`（上下 / 左右）两种写法——
    8 个模板用的就是这两种。三值/四值简写会在这里显式失败，而不是被悄悄当成某一边。
    """
    match = re.search(r"\bpadding:\s*([\d.]+)mm(?:\s+([\d.]+)mm)?\s*;", css)
    assert match, "模板里没找到 body 的 padding 简写"
    left = match.group(2)
    if left is None:
        return None
    return float(left), float(left)


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_header_align_matches_the_template_css(template):
    """`header_align` 必须与模板 `.header` 的 `text-align` 一致。

    这一项就是"优雅模板姓名居中"的开关：注册表写 center 而模板没写（或反之），PDF 与草稿
    立刻一个居中一个靠左——正是用户截图里那个差异。
    """
    spec = RESUME_TEMPLATES[template]
    css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
    defaults = TEMPLATE_LAYOUT_DEFAULTS[template]
    assert defaults["header_align"] == _header_align(_selector_block(css, ".header")), template


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_header_photo_side_matches_the_template_css(template):
    """`header_photo_side` 必须与模板 `.header` 的 `flex-direction` 一致。"""
    spec = RESUME_TEMPLATES[template]
    css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
    defaults = TEMPLATE_LAYOUT_DEFAULTS[template]
    assert defaults["header_photo_side"] == _header_photo_side(_selector_block(css, ".header")), (
        template
    )


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_padding_sides_match_the_template_css(template):
    """`padding_sides_mm` 必须等于模板 `padding` 简写里的左右值（单值简写 ⇒ 不声明）。

    注册表里**不写**这个键与"写成等于 `padding_mm` 的一对数"在渲染上等价，所以两种都接受；
    唯一不允许的是"CSS 是单值、注册表却声明了别的值"——那会让 PDF 的正文宽度与草稿不符。
    """
    spec = RESUME_TEMPLATES[template]
    css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
    defaults = TEMPLATE_LAYOUT_DEFAULTS[template]
    expected = _body_padding_sides(css)
    declared = defaults.get("padding_sides_mm")
    if expected is None:
        padding_mm = float(defaults["padding_mm"])
        assert declared is None or declared == (padding_mm, padding_mm), template
        return
    assert declared == expected, f"{template}：注册表 {declared} vs 模板 {expected}"


def test_padding_mm_still_carries_the_vertical_value():
    """`padding_mm` 保留原语义 = 模板 `padding` 简写的**第一个**数（上下）。

    它仍被页边距滑杆的默认值与 `GET /templates` 的 `template_layouts` 读，所以本批
    **不能**把它改成左右值或删掉——否则两值简写模板的滑杆读数会从 16 跳到 18。
    """
    for template, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        match = re.search(r"\bpadding:\s*([\d.]+)mm", css)
        assert match, template
        assert float(match.group(1)) == TEMPLATE_LAYOUT_DEFAULTS[template]["padding_mm"], template

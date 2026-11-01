# SPDX-License-Identifier: Apache-2.0
"""R-34A：模板目录的「角色基准」必须带**真实**缩进 / 段后，不是 0。

背景：前端的「缩进」滑杆在未覆盖时读 `templateDefaults`；这个键缺席时它退回中性值 0，
于是用户在"经典（缩进 1.43 字）"上看到的是"缩进 0"——滑杆一动就从 0 开始，纸面立刻
比原来紧一大截。所以这里的判据是"读得到模板里那个数"，不是"字段存在"。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from app.services.resume.resume_style_schema import template_role_defaults
from app.services.resume.resume_template_catalog import (
    RESUME_TEMPLATES,
    TEMPLATES_DIR,
    VISIBLE_TEMPLATE_NAMES,
)

# 模板 CSS 里 `ul { padding-left: calc(var(--fs) * X) }` 的 X（与上面三处同源）。
_LIST_INDENT = re.compile(r"ul\s*\{\s*padding-left:\s*calc\(\s*var\(--fs\)\s*\*\s*([0-9.]+)\s*\)")


def _css_indent(template: str) -> float:
    path = TEMPLATES_DIR / RESUME_TEMPLATES[template]["file"]
    match = _LIST_INDENT.search(Path(path).read_text(encoding="utf-8"))
    assert match, f"{template} 模板里找不到 ul 的 padding-left 系数"
    return float(match.group(1))


@pytest.mark.parametrize("template", VISIBLE_TEMPLATE_NAMES)
def test_body_indent_matches_template_css(template):
    """解出来的缩进必须**等于模板 CSS 里那个数**（抄错或模板改了没跟都会红）。"""
    defaults = template_role_defaults(template)
    assert defaults["body"]["indent"] == pytest.approx(_css_indent(template), abs=1e-6)


def test_known_templates_keep_their_documented_values():
    """三套模板的缩进写成常量：这是"面板基准"对外的承诺值。"""
    assert template_role_defaults("classic")["body"]["indent"] == pytest.approx(1.43)
    assert template_role_defaults("compact")["body"]["indent"] == pytest.approx(1.3)
    assert template_role_defaults("scholar")["body"]["indent"] == pytest.approx(1.28)


@pytest.mark.parametrize("template", VISIBLE_TEMPLATE_NAMES)
def test_section_title_space_after_is_populated(template):
    """块标题与正文之间的留白有模板来源，不该是 0。"""
    defaults = template_role_defaults(template)
    assert defaults["section_title"]["space_after"] > 0


def test_no_grounded_prop_is_invented():
    """没有 CSS 来源的属性**不要写**：缺键 = 面板显示中性值，比编一个 0 更诚实。

    `space_before` 是唯一一条：模板用 `.section` 的下外边距表达板块间距，没有段前概念。
    """
    for template in VISIBLE_TEMPLATE_NAMES:
        defaults = template_role_defaults(template)
        assert "space_before" not in defaults["section_title"]
        assert "space_before" not in defaults["entry_title"]

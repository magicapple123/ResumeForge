# SPDX-License-Identifier: Apache-2.0
"""三个"乘在模板基准上"的系数的 CSS 产出：两位小数、复位后静默、颜色变量名对齐。

从 `test_export_format_config.py` 拆出（2026-10-23）：那个文件在补 trio 参数后已到
485 行，再放这一组会破 500 行预算（`test_file_size_budget.py` 零豁免）。

三条性质都是"只在出错时可见"的一类：

1. 变量的值走 ``f"{value:g}"``——两位小数原样输出，前端 ``scaleProbeCss`` 的 ``formatG``
   必须复刻同一条，否则用户松手那一下会看到字号跳一格；
2. 改回 1（= 点「恢复默认」）与删键**等价**：一个字符都不产出，默认参数产物逐字节不变；
3. 四个颜色键的 CSS 变量名在前端还有第二份（目录接口只下发 ``label``），后端改名就会
   让"选了颜色预览没反应、松手后才变色"。
"""

import re

import pytest
from app.services.resume.resume_template_format import (
    FORMAT_FIELDS,
    SCALE_CSS_VARS,
    format_css,
)
from app.services.resume.resume_templates import RESUME_TEMPLATES, TEMPLATES_DIR


@pytest.mark.parametrize(
    ("key", "value"),
    [
        # 两位小数是滑杆最常落到的形态（姓名/小节标题 0.02 一档、条目间距 0.05 一档）。
        ("name_scale", 1.12),
        ("section_title_scale", 0.88),
        ("entry_gap", 1.35),
    ],
)
def test_scale_css_vars_render_two_decimals_verbatim(key: str, value: float):
    """变量的值走 ``f"{value:g}"``：两位小数原样输出，不带尾零、不补位。"""
    assert format_css({key: value}) == f":root {{ {SCALE_CSS_VARS[key]}: {value:g}; }}"


def test_scale_keys_do_not_leak_into_css_when_reset_to_default():
    """把值改回 1（= 用户点了「恢复默认」）与删键等价：一个字符都不产出。"""
    assert format_css({"name_scale": 1, "section_title_scale": 1.0, "entry_gap": 1}) == ""
    assert format_css({"name_scale": 1.12, "line_height": 1.7}) != format_css({"line_height": 1.7})
    assert "--name-scale" not in format_css({"line_height": 1.7})


def test_color_fields_use_the_css_variables_the_frontend_probe_writes():
    """四个颜色键的 CSS 变量名与前端 ``COLOR_CSS_VARS`` 逐字一致。

    取色是离散动作，前端不防抖：它把 ``:root { --accent: … }`` 直接注入预览 iframe
    （零网络往返）。而变量名在前端是**第二份**（目录接口只下发 ``label``，不下发 ``css``），
    后端一旦改名，用户就会看到"选了颜色预览没反应、松手后才变色"。这里钉住这份映射。
    """
    colors = {field["key"]: field["css"] for field in FORMAT_FIELDS if field["type"] == "color"}
    assert colors == {
        "accent": "--accent",
        "text_color": "--text",
        "muted_color": "--muted",
        "line_color": "--line",
    }
    # 产出的 `:root` 声明也要与前端 `colorProbeCss` 同形（同一串字符）。
    css = format_css({"accent": "#123456", "muted_color": "#654321"})
    assert css == ":root { --accent: #123456; --muted: #654321; }"


# ===== 消费侧：8 套模板的钩子 =====
#
# `test_resume_layout_templates.py` 的正则把尾部系数写成**可选**（不这样写，存量基准断言
# 会一片红），代价是"某个模板漏改一行"在那里看不出来——那正好是"这套模板静默忽略新参数"
# 的形态。这里补上"钩子必须存在"，与那组用例形成"值有没有漂 / 钩子有没有接"两条互补守卫。

_SCALE_HOOKS: dict[str, str] = {
    ".header .name": "--name-scale",
    ".section-title": "--section-title-scale",
    ".entry": "--entry-gap",
}


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_every_template_consumes_the_three_scale_variables(name):
    """8 套模板各自的三个钩子都在，且回退值都是 1（不传时与今天完全等价）。"""
    spec = RESUME_TEMPLATES[name]
    css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")

    for selector, css_var in _SCALE_HOOKS.items():
        block = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
        assert block, f"{spec['file']} 里没找到 {selector}"
        assert f"var({css_var}, 1)" in block.group(1), (
            f"{spec['file']} 的 {selector} 少了 {css_var}"
        )

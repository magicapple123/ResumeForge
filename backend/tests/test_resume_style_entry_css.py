# SPDX-License-Identifier: Apache-2.0
"""W07-EP：对象级覆盖在 HTML 里必须同时作用于对象内部角色元素（与 PDF / Word 对等）。

## 背景

PDF（pdf_exporter.style_blocks）与 Word（docx_sections）应用对象覆盖的方式是
role_style(role, object_id)：对象层逐角色合并进该角色的基准，于是条目名称 / 元信息 /
要点各自按自己的模板基准比例放大、改色、加粗。HTML 侧原先只写对象根节点规则，模板里的
.entry-head .title 等选择器 specificity 更高（同为 0,2,0 时看源码顺序），条目名称收不到
覆盖——用户看到"草稿/HTML 没变、精确预览/导出变了"。

## 本文件钉住的四条性质

1. 无对象覆盖时 entry_style_css 仍为空串、render_html 产物与不带覆盖时逐字节相同；
2. 文字外观属性（字号 / 颜色 / 字重 / 斜体 / 行高）出现在后代角色规则里，字号按角色自己的
   模板基准比例展开（与 template_role_defaults 同源，不硬编码 1.0）；
3. 空间属性（段距 / 缩进 / 项目符号 / 对齐 / 日期位置 / 字距）只落在对象根，不在子元素上重复；
4. 真实 render_html 产物里规则存在且注入在模板 CSS 之后（同权重时靠源码顺序，不用
   !important）。

浏览器计算样式（Chrome 探针）属人工核对，不进 CI：pytest 环境没有浏览器。
"""

from __future__ import annotations

import re

import pytest
from app.schemas.resume import ResumeContent
from app.services.exporter import render_html
from app.services.resume.resume_style import entry_style_css, resolve_style, role_style_css
from app.services.resume.resume_style_schema import template_role_defaults

ENTRY_ID = "exp_12345678"
OTHER_ID = "prj_87654321"
TEMPLATES = (
    "classic",
    "modern",
    "compact",
    "minimal",
    "elegant",
    "technical",
    "split",
    "editorial",
    "scholar",
)

# 空间属性：只允许出现在对象根规则里（重复写到子元素上会把段距/缩进放大好几倍）。
_SPATIAL_TOKENS = (
    "margin-top",
    "margin-bottom",
    "padding-left",
    "list-style-type",
    "text-align",
    "justify-content",
    "letter-spacing",
)


def _style(objects: dict, template: str = "classic"):
    return resolve_style(
        template=template,
        format_config={"objects": {"version": 1, **objects}},
    )


def _rules(css: str) -> list[tuple[str, str]]:
    """拆成 (selector, declarations)；规则行格式固定为"两空格缩进 + 单行规则"。"""
    found: list[tuple[str, str]] = []
    for line in css.splitlines():
        match = re.match(r"^\s+(.+?) \{ (.+) \}$", line)
        if match:
            found.append((match.group(1), match.group(2)))
    return found


def _shared_rule(css: str, object_selector: str) -> str:
    """取"多角色共享"的那条规则（选择器列表含三个 data-role 选项 + 文字外观声明）。"""
    for selector, declarations in _rules(css):
        if object_selector not in selector:
            continue
        if selector.count("[data-role=") >= 3:
            return declarations
    raise AssertionError(f"no shared rule for {object_selector} in:\n{css}")


def _resume() -> ResumeContent:
    """最小真实简历：一条教育 + 一条经历（对象 id 与模板 data-object-id 对齐）。"""
    return ResumeContent.model_validate(
        {
            "photo": "",
            "name": "测试",
            "gender": "",
            "birth_year": "",
            "phone": "",
            "email": "",
            "city": "",
            "personal_website": "",
            "github": "",
            "job_intent": "工程师",
            "summary": "一段总结",
            "education": [],
            "experience": [
                {
                    "id": ENTRY_ID,
                    "company": "甲公司",
                    "role": "工程师",
                    "start_date": "2020-01",
                    "end_date": "2021-01",
                    "description": ["做了一件事"],
                }
            ],
            "campus_experience": [],
            "projects": [],
            "skills": [],
            "awards": [],
        }
    )


# ===== 1. 默认路径零变化 =====


def test_no_object_override_produces_no_css():
    assert entry_style_css(resolve_style(template="classic", format_config=None)) == ""
    assert (
        entry_style_css(
            resolve_style(template="classic", format_config={"objects": {"version": 1}})
        )
        == ""
    )


def test_render_html_is_unchanged_when_object_domain_is_empty():
    resume = _resume()

    def normalize(html: str) -> str:
        # 每次渲染的 CSP nonce 都是随机的：比较产物时先归一化它，只比"排出来的内容"。
        html = re.sub(r'nonce="[0-9a-f]{32}"', 'nonce="X"', html)
        return re.sub(r"nonce-[0-9a-f]{32}", "nonce-X", html)

    default_html = normalize(render_html(resume, template="classic"))
    assert "[data-object-id=" not in default_html  # 默认产物里没有任何对象覆盖 CSS
    empty_domain = normalize(
        render_html(resume, template="classic", format_config={"objects": {"version": 1}})
    )
    assert empty_domain == default_html


# ===== 2. 文字外观属性 → 内部角色元素（字号按角色自己的基准比例） =====


def test_text_overrides_reach_inner_roles_with_classic_base_ratios():
    css = entry_style_css(
        _style(
            {
                ENTRY_ID: {
                    "font_scale": 1.4,
                    "bold": True,
                    "color": "#123c69",
                    "italic": True,
                    "line_height": 1.5,
                }
            }
        )
    )
    # classic 的模板基准：entry_title 1.07 / body 1 / meta 0.93（与模板 CSS 同值）。
    assert (
        f'  [data-object-id="{ENTRY_ID}"] [data-role="entry_title"] '
        "{ font-size: calc(var(--fs) * 1.4 * 1.07); }"
    ) in css
    assert (
        f'  [data-object-id="{ENTRY_ID}"] [data-role="body"] '
        "{ font-size: calc(var(--fs) * 1.4 * 1); }"
    ) in css
    assert (
        f'  [data-object-id="{ENTRY_ID}"] [data-role="meta"] '
        "{ font-size: calc(var(--fs) * 1.4 * 0.93); }"
    ) in css
    shared = _shared_rule(css, f'[data-object-id="{ENTRY_ID}"]')
    assert "color: #123c69;" in shared
    assert "font-weight: 700;" in shared
    assert "font-style: italic;" in shared
    assert "line-height: 1.5;" in shared


def test_font_weight_and_italic_are_forwarded_as_concrete_values():
    css = entry_style_css(_style({ENTRY_ID: {"bold": False, "italic": False}}))
    shared = _shared_rule(css, f'[data-object-id="{ENTRY_ID}"]')
    assert "font-weight: 400;" in shared
    assert "font-style: normal;" in shared
    assert "font-size" not in css


@pytest.mark.parametrize("template", TEMPLATES)
def test_each_template_expands_font_scale_with_its_own_role_ratios(template: str):
    css = entry_style_css(_style({ENTRY_ID: {"font_scale": 1.25}}, template=template))
    ratios = {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults(template).items()
    }
    for role in ("entry_title", "body", "meta"):
        line = next(
            (
                candidate
                for candidate in css.splitlines()
                if f'[data-role="{role}"]' in candidate and "font-size" in candidate
            ),
            None,
        )
        assert line is not None, (template, role)
        assert f"calc(var(--fs) * 1.25 * {ratios[role]:g})" in line, (template, role)


# ===== 3. 空间属性只落在对象根 =====


def test_spatial_props_stay_on_the_object_root_only():
    css = entry_style_css(
        _style(
            {
                ENTRY_ID: {
                    "font_scale": 1.2,
                    "space_before": 0.3,
                    "space_after": 0.2,
                    "indent": 0.5,
                    "bullet": "dash",
                    "align": "center",
                    "meta_align": "inline",
                    "letter_spacing": 0.02,
                }
            }
        )
    )
    root = next(
        declarations
        for selector, declarations in _rules(css)
        if selector == f'[data-object-id="{ENTRY_ID}"]'
    )
    for expected in (
        "margin-top: calc(var(--fs) * 0.3);",
        "margin-bottom: calc(var(--fs) * 0.2);",
        "padding-left: calc(var(--fs) * 0.5);",
        "list-style-type: '–';",
        "text-align: center;",
        "justify-content: flex-start;",
        "letter-spacing: calc(var(--fs) * 0.02);",
    ):
        assert expected in root
    for selector, declarations in _rules(css):
        if "[data-role=" not in selector:
            continue
        for token in _SPATIAL_TOKENS:
            assert token not in declarations, (selector, token)


def test_spatial_only_override_keeps_a_single_root_rule():
    """既有用户只设过段前距：产物必须仍是一条根规则（不新增后代规则）。"""
    css = entry_style_css(_style({ENTRY_ID: {"space_before": 0.6}}))
    assert "[data-role=" not in css
    assert css.startswith(f'  [data-object-id="{ENTRY_ID}"] {{ margin-top: calc(var(--fs) * 0.6);')


def test_color_only_override_does_not_invent_a_font_size():
    css = entry_style_css(_style({ENTRY_ID: {"color": "#123c69"}}))
    assert "font-size" not in css


# ===== 4. 真实 render_html 产物 =====


def test_render_html_injects_descendant_rules_after_the_template_css():
    styled = render_html(
        _resume(),
        template="classic",
        format_config={"objects": {"version": 1, ENTRY_ID: {"font_scale": 1.4, "bold": True}}},
    )
    selector = f'[data-object-id="{ENTRY_ID}"] [data-role="entry_title"]'
    assert selector in styled
    # 字号按条目名的模板基准 1.07 展开（不是裸系数），与 PDF/Word 逐角色合并一致。
    assert "font-size: calc(var(--fs) * 1.4 * 1.07);" in styled
    # 同权重（0,2,0）时靠源码顺序生效：对象规则必须在模板自带 .entry-head .title 之后。
    assert styled.index(".entry-head .title") < styled.index(selector)
    object_rule_line = next(line for line in styled.splitlines() if selector in line)
    assert "!important" not in object_rule_line


def test_multiple_objects_are_sorted_and_isolated():
    css = entry_style_css(_style({OTHER_ID: {"font_scale": 1.1}, ENTRY_ID: {"font_scale": 1.4}}))
    assert css.index(f'[data-object-id="{ENTRY_ID}"]') < css.index(f'[data-object-id="{OTHER_ID}"]')
    assert f'[data-object-id="{ENTRY_ID}"] [data-role="entry_title"]' in css
    assert f'[data-object-id="{OTHER_ID}"] [data-role="entry_title"]' in css
    for line in css.splitlines():
        if ENTRY_ID in line and "font-size" in line:
            assert OTHER_ID not in line


# ===== 5. 既有角色规则不受本改动影响 =====


def test_role_css_output_is_unchanged_by_the_shared_declaration_helper():
    style = resolve_style(
        template="classic",
        format_config={
            "roles": {
                "version": 1,
                "body": {"font_scale": 1.2, "line_height": 1.55, "indent": 1.6, "bullet": "dash"},
                "section_title": {"color": "#123c69", "space_after": 0.8},
            }
        },
    )
    css = role_style_css(style)
    assert len(css.splitlines()) == 2  # 一个角色一行
    assert '[data-role="body"] {' in css
    assert '[data-role="section_title"] {' in css
    assert "font-size: calc(var(--fs) * 1.2 * 1);" in css
    assert "margin-bottom: calc(var(--fs) * 0.8);" in css

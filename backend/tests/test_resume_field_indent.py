# SPDX-License-Identifier: Apache-2.0
"""DF-8：字段级「缩进 / 项目符号」在 HTML 草稿里必须真的动。

事故形态：面板给字段弹「缩进 8×」，PDF / Word 都变了，草稿纹丝不动——因为字段分支只把
文字属性写到 ``[data-resume-path]`` 上，而 ``padding-left`` 写在行内 span 上既推不动
``li`` 的 ``outside`` marker，也不改变块的左缘。

四条断言分别钉住：
1. 缩进落在**承载该字段的块**（``li`` / ``p``）上，且是"整块位移"（正文 + 符号的基准不变）；
2. 项目符号只改这一行（同 ``ul`` 里的兄弟要点不受影响），所以写在 ``li`` 而不是 ``ul``；
3. 字段作用域的属性清单里没有 ``meta_align``（没有条目头 flex 容器 = 没有落点）；
4. **守卫**：面板可调的每个属性，至少在一个出口产出非空声明——这是本缺陷的根因防护。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_style import entry_style_css, resolve_style
from app.services.resume.resume_style_schema import (
    FIELD_EXCLUDED_PROPS,
    FIELD_ROLE_PROPS,
    ROLES,
    validate_object_roles_domain,
)

ENTRY = "ob_entry0001"
PATH = f"projects.{ENTRY}.ob_field0001"
SIBLING = f"projects.{ENTRY}.ob_field0002"


def _css(role: str, payload: dict, *, path: str = PATH, template: str = "classic") -> str:
    return entry_style_css(
        resolve_style(
            template=template,
            format_config={"object_roles": {f"{path}:{role}": payload}},
        )
    )


#: 面板里每个可调属性的"一个合法取值"与它必须产出的声明前缀。
SAMPLE_VALUES: dict[str, object] = {
    "font_scale": 1.2,
    "color": "#ff0000",
    "bold": True,
    "space_before": 0.4,
    "space_after": 0.3,
    "line_height": 1.6,
    "indent": 0.8,
    "bullet": "dash",
    "align": "right",
    "meta_align": "right",
    "letter_spacing": 0.05,
}
EXPECTED_DECLARATION: dict[str, str] = {
    "font_scale": "font-size: calc(var(--fs) * 1.2 * ",
    "color": "color: #ff0000;",
    "bold": "font-weight: 700;",
    "space_before": "margin-top:",
    "space_after": "margin-bottom:",
    "line_height": "line-height: 1.6;",
    "indent": "padding-left:",
    "bullet": "list-style-type:",
    "align": "text-align: right;",
    "meta_align": "justify-content:",
    "letter_spacing": "letter-spacing: calc(var(--fs) * 0.05);",
}


def test_indent_targets_the_block_that_carries_the_field() -> None:
    """缩进写在 li / p 上：草稿里"整块右移"，不是只把 span 的文字推出去。"""
    css = _css("body", {"indent": 8.0})
    # classic 模板 ul 的 padding-left 是 calc(var(--fs) * 1.43)：li 写差值 8 - 1.43。
    assert f'  li[data-resume-path="{PATH}"] {{ padding-left: calc(var(--fs) * 6.57); }}' in css
    assert f'  p[data-resume-path="{PATH}"] {{ padding-left: calc(var(--fs) * 8); }}' in css
    # 行内 span 上不出现缩进（那是旧写法：只推文字、marker 留在原处）。
    assert (
        f'  [data-resume-path="{PATH}"]:not([data-resume-path] [data-resume-path]) {{ padding-left'
        not in css
    )
    assert "display: inline-block" not in css


def test_indent_below_the_list_baseline_moves_left_with_the_pdf() -> None:
    """缩进小于模板基准时**不夹到 0**：PDF 批量路径把 indent 当绝对行首偏移。

    ``draw_bullets``（``pdf_exporter/style_blocks.py``）写的是
    ``text_left = frame_left + gap_mm(style.indent)``，没有 max 下限。草稿若夹成 0，
    滑杆 0—1.43 这一整段就又回到"拖了没反应"（DF-8 的症状本身）。差值走负 margin，
    让承载块整体左移到与 PDF 同一个正文左缘。
    """
    css = _css("body", {"indent": 0.5})
    # classic 的 ul 基准 1.43：0.5 - 1.43 = -0.93。
    assert f'li[data-resume-path="{PATH}"] {{ margin-left: calc(var(--fs) * -0.93); }}' in css
    assert f'li[data-resume-path="{PATH}"] {{ padding-left: calc(var(--fs) * 0)' not in css


def test_bullet_changes_only_the_one_row_inside_a_shared_ul() -> None:
    """同一条目相邻要点共用一个 ul：写在 li 上只换这一行，兄弟行与 ul 规则都不动。"""
    css = entry_style_css(
        resolve_style(
            template="classic",
            format_config={
                "object_roles": {
                    f"{PATH}:body": {"bullet": "dash"},
                    f"{SIBLING}:body": {"color": "#0000ff"},
                }
            },
        )
    )
    assert f"  li[data-resume-path=\"{PATH}\"] {{ list-style-type: '–'; }}" in css
    assert "  ul {" not in css
    assert "ul:has" not in css
    assert f'li[data-resume-path="{SIBLING}"] {{ list-style-type' not in css


def test_two_field_paths_never_share_a_block_rule() -> None:
    """多路径的确定性：每条规则按**路径字面量**精确匹配承载块，互不串台。

    计划层保证一个正文块只有一个路径（``document_plan_rows._body_blocks``：块的 ``path``
    与段内 ``Inline.path`` 同源），模板也把该路径写在块自己身上
    （``_resume_document.j2``：``<li data-resume-path>`` / ``<p class="body-paragraph"
    data-resume-path>``）。所以这里**不需要** ``:has()``：

    * ``ul:has([data-resume-path=X])`` 会在同一条目的相邻要点共用一个 ``ul`` 时把整段
      符号都改掉（见上一条用例）；
    * ``li:has(span[data-resume-path=X])`` 的命中取决于"块里是否**含有**这个路径"，
      一旦某个块内出现第二段文字就失去确定性，得再规定"取最大值还是只认第一个"。

    选择器里只有"标签 + 自身路径"，命中集恒定是 0 或 1 个块 → 结果确定。同一份输入
    两次生成字节相同，顺序按排序后的 key（``order`` 而不是字典插入序）。
    """
    config = {
        "version": 1,
        "object_roles": {
            f"{PATH}:body": {"indent": 8.0},
            f"{SIBLING}:body": {"indent": 2.0},
        },
    }
    first = entry_style_css(resolve_style(template="classic", format_config=config))
    assert f'li[data-resume-path="{PATH}"] {{ padding-left: calc(var(--fs) * 6.57); }}' in first
    assert f'li[data-resume-path="{SIBLING}"] {{ padding-left: calc(var(--fs) * 0.57); }}' in first
    assert ":has(" not in first
    # 确定性：同样的输入 → 同样的字节；规则顺序就是 key 的排序序（PATH < SIBLING）。
    assert first == entry_style_css(resolve_style(template="classic", format_config=config))
    assert first.index(f'"{PATH}"') < first.index(f'"{SIBLING}"')
    # 反过来给 key 也不能换顺序（dict 插入序不影响输出）。
    flipped = {"version": 1, "object_roles": dict(reversed(list(config["object_roles"].items())))}
    assert entry_style_css(resolve_style(template="classic", format_config=flipped)) == first


def test_indent_zero_lands_flush_with_the_pdf_margin() -> None:
    """indent = 0（滑杆最左）也必须动：li 用负 margin 抵消 ul 的基准，正文落到页边距。"""
    css = _css("body", {"indent": 0.0})
    assert f'li[data-resume-path="{PATH}"] {{ margin-left: calc(var(--fs) * -1.43); }}' in css
    # 段落块本来就是绝对值，0 = 不写缩进。
    assert f'p[data-resume-path="{PATH}"] {{  }}' not in css


def test_paragraph_field_indent_and_bullet_share_the_same_rule_shape() -> None:
    """段落字段（body_style=paragraph）只有 p 块；li 规则存在但命中不到，不产生副作用。"""
    css = _css("body", {"indent": 2.0, "bullet": "none"})
    assert f'p[data-resume-path="{PATH}"] {{ padding-left: calc(var(--fs) * 2); }}' in css
    assert f'li[data-resume-path="{PATH}"] {{ list-style-type: none; padding-left' in css


def test_field_scope_has_no_meta_align_at_all() -> None:
    """字段层没有条目头容器：面板不给、校验也不收（否则会存进一个三出口都不读的键）。"""
    assert "meta_align" not in FIELD_ROLE_PROPS["meta"]
    assert FIELD_EXCLUDED_PROPS == ("meta_align",)
    assert validate_object_roles_domain(
        {f"{PATH}:meta": {"meta_align": "right", "color": "#ff0000"}}
    ) == {"version": 1, f"{PATH}:meta": {"color": "#ff0000"}}
    # 对象层（条目头）照旧允许，行为不变。
    assert validate_object_roles_domain({f"{ENTRY}:meta": {"meta_align": "right"}}) == {
        "version": 1,
        f"{ENTRY}:meta": {"meta_align": "right"},
    }


def test_object_and_role_level_spatial_rules_are_unchanged() -> None:
    """条目层 / 角色层仍写 ul 与 .entry-head（DF-8 只改字段分支）。"""
    css = entry_style_css(
        resolve_style(
            template="classic",
            format_config={
                "objects": {ENTRY: {"indent": 1.5, "bullet": "dash"}},
                "object_roles": {f"{ENTRY}:meta": {"meta_align": "right"}},
            },
        )
    )
    assert f"  [data-object-id=\"{ENTRY}\"] ul {{ list-style-type: '–'; }}" in css
    assert f'  [data-object-id="{ENTRY}"] ul, [data-object-id="{ENTRY}"] .body-paragraph' in css
    assert f'  [data-object-id="{ENTRY}"] .entry-head {{ justify-content: space-between; }}' in css


@pytest.mark.parametrize(
    ("role", "prop"), [(role, prop) for role in ROLES for prop in FIELD_ROLE_PROPS[role]]
)
def test_every_field_panel_prop_produces_a_declaration(role: str, prop: str) -> None:
    """**守卫（DF-8 根因防护）**：字段作用域里能调的每个属性，至少产出非空声明。

    反证方式：把 ``_field_block_rules`` 从字段分支里删掉，``indent`` / ``bullet`` 两行
    立刻 red（它们只走块规则）；把 ``meta_align`` 放回 ``FIELD_ROLE_PROPS`` 也同样 red
    （它没有任何出口）。面板行清单由同一份 ``FIELD_ROLE_PROPS`` 投影，所以
    "面板可调 ⊆ 有落点"是这条用例的不动点。
    """
    css = _css(role, {prop: SAMPLE_VALUES[prop]})
    assert css.strip(), f"{role}:{prop} 没有任何 CSS 产出"
    assert EXPECTED_DECLARATION[prop] in css, f"{role}:{prop} 缺少 {EXPECTED_DECLARATION[prop]}"

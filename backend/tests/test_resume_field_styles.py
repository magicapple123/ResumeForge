# SPDX-License-Identifier: Apache-2.0
"""字段级样式的数据层：路径要过白名单（防选择器注入）、只影响目标字段、删字段时清理。

三条断言对应三种事故：路径没校验 → CSS 注入；覆盖漏到兄弟字段 → "只改了一个字段整条都变"；
删掉的字段还留着样式 → 下次同 id 复用时继承到不该有的外观。
"""

from app.services.resume.resume_render_overrides import prune_overrides
from app.services.resume.resume_style import entry_style_css, resolve_style
from app.services.resume.resume_style_schema import validate_object_roles_domain

ENTRY = "ob_entry0001"
PATH = f"projects.{ENTRY}.ob_field0001"
OTHER = f"projects.{ENTRY}.ob_field0002"


def test_field_path_is_validated_without_accepting_css_injection():
    assert validate_object_roles_domain(
        {f"{PATH}:body": {"color": "#ff0000", "space_before": 0.4}}
    ) == {"version": 1, f"{PATH}:body": {"color": "#ff0000", "space_before": 0.4}}
    for invalid in ("projects.x.y", f'{PATH}"]', f"{PATH}:extra"):
        assert validate_object_roles_domain({f"{invalid}:body": {"color": "#ff0000"}}) is None


def test_field_is_more_specific_than_entry_but_other_fields_keep_inheriting():
    style = resolve_style(
        template="classic",
        format_config={
            "roles": {"body": {"color": "#111111", "font_scale": 1.1}},
            "objects": {ENTRY: {"bold": True, "space_after": 0.2}},
            "object_roles": {
                f"{ENTRY}:body": {"color": "#222222"},
                f"{PATH}:body": {"color": "#ff0000", "space_before": 0.4},
            },
        },
    )
    first = style.effective("body", object_id=PATH)
    other = style.effective("body", object_id=OTHER)
    assert (first.color, first.bold, first.font_scale, first.space_before) == (
        "#ff0000",
        True,
        1.1,
        0.4,
    )
    assert (other.color, other.bold, other.space_after, other.space_before) == (
        "#222222",
        True,
        0.2,
        None,
    )


def test_html_targets_field_path_and_its_own_paragraph_spacing():
    style = resolve_style(
        template="classic",
        format_config={
            "object_roles": {
                f"{PATH}:body": {"color": "#ff0000", "space_before": 0.4},
            }
        },
    )
    css = entry_style_css(style)
    assert f'[data-resume-path="{PATH}"]' in css
    assert f'[data-object-id="{PATH}"]' not in css
    assert "#ff0000" in css
    assert "margin-top:" in css


def test_save_keeps_existing_field_and_prunes_removed_field():
    content = {
        "version": 2,
        "sections": [
            {
                "key": "projects",
                "entries": [
                    {
                        "id": ENTRY,
                        "items": [{"id": "ob_field0001", "kind": "field", "value": "Scope"}],
                    }
                ],
            }
        ],
    }
    config = {
        "object_roles": {
            "version": 1,
            f"{PATH}:body": {"color": "#ff0000"},
            f"{OTHER}:body": {"color": "#0000ff"},
        }
    }
    pruned = prune_overrides(content, config)
    assert pruned["object_roles"] == {"version": 1, f"{PATH}:body": {"color": "#ff0000"}}
    assert prune_overrides(content, pruned) is None


# ===== QW-6：页眉字段（`header.{item_id}`）也能逐字段调参 =====

HEADER = "header.hd_00000001"
HEADER_CONTENT = {
    "version": 2,
    "header": {
        "items": [
            {
                "kind": "field",
                "id": "hd_00000001",
                "key": "phone",
                "value": "13800000000",
                "placement": "contact",
                "label_mode": "show",
            }
        ]
    },
    "sections": [],
}


def test_header_path_is_accepted_without_widening_the_three_segment_rule():
    """页眉路径进白名单，但**两段的非 header 路径**仍然被拒（不放宽段数）。"""
    assert validate_object_roles_domain({f"{HEADER}:field_label": {"bold": True}}) == {
        "version": 1,
        f"{HEADER}:field_label": {"bold": True},
    }
    for invalid in ("projects.ob_entry0001", "headerx.hd_00000001", "header.short"):
        assert validate_object_roles_domain({f"{invalid}:meta": {"color": "#ff0000"}}) is None


def test_header_field_style_survives_save_and_is_pruned_when_field_is_removed():
    """`content_field_paths` 收口：header 字段在 → 样式保留；删掉字段 → 样式被清。"""
    config = {"object_roles": {"version": 1, f"{HEADER}:meta": {"color": "#ff0000"}}}
    assert prune_overrides(HEADER_CONTENT, config) is None
    without_header = {**HEADER_CONTENT, "header": {"items": []}}
    pruned = prune_overrides(without_header, config) or {}
    assert f"{HEADER}:meta" not in (pruned.get("object_roles") or {})


def test_header_label_and_value_get_separate_css_rules():
    """标签段只命中 field_label 段，值段不落在标签段上（反之亦然）。"""
    style = resolve_style(
        template="classic",
        format_config={
            "object_roles": {
                f"{HEADER}:field_label": {"color": "#ff0000"},
                f"{HEADER}:meta": {"font_scale": 1.2},
            }
        },
    )
    css = entry_style_css(style)
    assert f'[data-resume-path="{HEADER}"][data-role="field_label"] {{ color: #ff0000; }}' in css
    assert f'[data-resume-path="{HEADER}"]:not([data-resume-path] [data-resume-path]):not([data-role="field_label"])' in css

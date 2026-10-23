# SPDX-License-Identifier: Apache-2.0
"""四向页边距与照片系数：优先级矩阵、白名单、CSS 三种形态。

这一批参数有三个"错了也看不出来"的失败面，所以三条各钉一组：

1. **优先级**判错一格，存量简历的页边距就集体漂移（用户不会来报，只会觉得"排版变了"）；
2. **白名单**判反（夹紧而不是丢弃），手工请求能构造出越界值进 CSS/渲染；
3. **CSS 形态**判错（四边相等时也写四值），"默认参数下产物逐字节不变"直接不成立，
   而黄金基线只比提取文本，抓不到样式表里的这处漂移——所以必须在这里逐字断言。

前端对偶在 ``frontend/src/utils/pageMargins.test.ts``（两端各钉一次）。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_layout_overrides import (
    DEFAULT_PHOTO_SCALE,
    EXTRA_FORMAT_KEYS,
    PAGE_MARGIN_KEYS,
    PAGE_MARGIN_MAX,
    PAGE_MARGIN_MIN,
    PAGE_MARGIN_SIDES,
    PAGE_MARGIN_STEP,
    PAGE_PADDING_KEY,
    PHOTO_SCALE_KEY,
    PHOTO_SCALE_MAX,
    PHOTO_SCALE_MIN,
    PHOTO_SCALE_STEP,
    SCALE_KEYS,
    clamp_page_margin,
    clamp_photo_scale,
    extra_bounds,
    page_padding_rule,
    photo_scale_css_value,
    resolve_page_margins,
    resolve_photo_scale,
)
from app.services.resume.resume_template_format import (
    FORMAT_FIELDS,
    format_css,
    format_field_options,
    page_padding_bounds,
    validated_format_config,
)

# ===== 键名与区间的单一来源守卫 =====


def test_margin_bounds_match_the_page_padding_field():
    """四条支路与 ``page_padding`` 共用同一区间，两处定义必须相等。

    区间现在写在两个地方：``FORMAT_FIELDS["page_padding"]``（喂格式模板编辑器）与
    ``resume_layout_overrides``（喂解析与前端常量）。它们一旦漂移，前端滑杆能拖到后端
    丢弃的值——用户看到"松手后跳回去"，而这在日志里什么都不留。
    """
    low, high = page_padding_bounds()
    assert (low, high) == (PAGE_MARGIN_MIN, PAGE_MARGIN_MAX)
    assert (
        float(next(field for field in FORMAT_FIELDS if field["key"] == PAGE_PADDING_KEY)["step"])
        == PAGE_MARGIN_STEP
    )


def test_extra_keys_are_the_sides_the_photo_scale_and_the_three_scales():
    """``EXTRA_FORMAT_KEYS`` 的**完整**清单：多一个少一个都要在这里显形。

    三个系数（``name_scale`` / ``section_title_scale`` / ``entry_gap``）与 ``photo_scale``
    同属"乘在模板基准上"的可调系数，走同一条白名单路径；它们**不进** ``FORMAT_FIELDS``
    （见下一个用例），所以这张表是它们唯一的登记处。
    """
    assert set(EXTRA_FORMAT_KEYS) == {
        "page_padding_top",
        "page_padding_right",
        "page_padding_bottom",
        "page_padding_left",
        PHOTO_SCALE_KEY,
        *SCALE_KEYS,
    }
    assert {"name_scale", "section_title_scale", "entry_gap"} == SCALE_KEYS
    assert PAGE_MARGIN_SIDES == ("top", "right", "bottom", "left")


def test_extra_keys_stay_out_of_the_format_field_table():
    """**第二个硬决定**：这四个边距键与 ``photo_scale`` 不进 ``FORMAT_FIELDS``。

    进了表，``format_field_options()`` 会给「自制格式模板」编辑器凭空多出 5 条滑杆，
    并且每个导入的格式模板都会被算成"缺 page_padding_top"。
    """
    keys = set(EXTRA_FORMAT_KEYS)
    assert keys.isdisjoint({field["key"] for field in FORMAT_FIELDS})
    assert keys.isdisjoint({item["key"] for item in format_field_options()})


# ===== 优先级矩阵（设计 §8.1）=====


@pytest.mark.parametrize(
    ("config", "template_mm", "legacy", "expected"),
    [
        ({}, 14.0, None, (14, 14, 14, 14)),  # ① 全默认
        ({"page_padding": 10}, 14.0, None, (10, 10, 10, 10)),  # ① 旧数据
        (
            {"page_padding": 12, "page_padding_top": 8},
            14.0,
            None,
            (8, 12, 12, 12),
        ),  # ② 支路覆盖"总"
        (
            {
                "page_padding_top": 8,
                "page_padding_right": 9,
                "page_padding_bottom": 10,
                "page_padding_left": 11,
            },
            14.0,
            None,
            (8, 9, 10, 11),
        ),  # ④ 只有四条支路
        ({"page_padding_top": 8}, 14.0, None, (14, 14, 14, 14)),  # ③ 支路不全 → 作废
        (
            {"page_padding": 12, "page_padding_top": 8},
            14.0,
            26,
            (8, 12, 12, 12),
        ),  # ④ 旧 margin_mm 不参与
        ({}, 14.0, 40, (26, 26, 26, 26)),  # ④ legacy 夹到上限（既有行为）
        ({}, 14.0, -3, (0, 0, 0, 0)),  # ④ legacy 夹到下限（2026-10-22：下限放到 0）
        ({}, 14.0, 4, (4, 4, 4, 4)),  # ④ 下限是 0，4mm 原样生效
    ],
)
def test_page_margin_priority(config, template_mm, legacy, expected):
    """``(上, 右, 下, 左)`` 的解析口径——PDF / Word / 自动一页全部读这一份。"""
    assert resolve_page_margins(config, template_mm, legacy) == pytest.approx(expected)


def test_partial_sides_without_a_master_are_discarded_as_a_group():
    """支路不足四条、又没有"总"时**整组作废**（等于"没设过"）。

    这条是 HTML 与 PDF 不出分歧的唯一保证：HTML 不知道模板默认值，只能"整组忽略"；
    PDF 若按"给了几条算几条"来解析，同一份配置就会得到两种版式。
    """
    assert resolve_page_margins({"page_padding_left": 9}, 14.0) == (14, 14, 14, 14)
    assert page_padding_rule({"page_padding_left": 9}) is None


def test_resolve_page_margins_tolerates_malformed_input():
    """畸形配置表现为"这个键没设过"，而不是让整份简历渲染不出来。"""
    assert resolve_page_margins(None, 14.0) == (14, 14, 14, 14)
    assert resolve_page_margins({"page_padding": "abc"}, 14.0) == (14, 14, 14, 14)
    assert resolve_page_margins({"page_padding_top": None}, 14.0) == (14, 14, 14, 14)


def test_sides_win_over_the_legacy_margin_mm():
    """旧客户端的 ``margin_mm`` 只是"总"的回落值，支路照样能覆盖它。"""
    assert resolve_page_margins(
        {
            "page_padding_top": 8,
            "page_padding_right": 8,
            "page_padding_bottom": 8,
            "page_padding_left": 8,
        },
        14.0,
        20,
    ) == (8, 8, 8, 8)


# ===== CSS 三种形态（设计 §8.2，逐字）=====


def test_empty_config_produces_no_css_at_all():
    """什么都没设 → 空串：模板 CSS 是唯一权威（这是"默认产物逐字节不变"的开关）。"""
    assert format_css({}) == ""
    assert format_css(None) == ""


def test_uniform_margins_keep_the_single_value_form():
    """四边相等时仍是**单值形态**，与今天逐字一致（既有 8 条断言正靠它）。"""
    assert format_css({"page_padding": 14}) == "body { padding: 14mm !important; }"


def test_asymmetric_margins_emit_the_four_value_shorthand():
    """四边不等时按 CSS 简写顺序（上右下左）写四值，且**只有一条** padding 规则。"""
    css = format_css({"page_padding": 14, "page_padding_top": 8, "page_padding_bottom": 12})
    assert "body { padding: 8mm 14mm 12mm 14mm !important; }" in css
    # 两条独立规则会互相覆盖（后出现的赢），所以必须合成一条。
    assert css.count("body { padding:") == 1


def test_four_explicit_sides_without_a_master_render_as_four_values():
    css = format_css(
        {
            "page_padding_top": 8,
            "page_padding_right": 9,
            "page_padding_bottom": 10,
            "page_padding_left": 11,
        }
    )
    assert css == "body { padding: 8mm 9mm 10mm 11mm !important; }"


def test_page_padding_rule_returns_none_when_nothing_is_set():
    assert page_padding_rule(None) is None
    assert page_padding_rule({}) is None
    assert page_padding_rule({PHOTO_SCALE_KEY: 1.5}) is None


def test_padding_rule_is_not_duplicated_by_the_generic_field_loop():
    """``page_padding`` 在 ``FORMAT_FIELDS`` 里仍有 ``css_rule``（前端探针读它），
    但它**不能**再被通用循环产出一条——那样四边形态就永远生效不了。"""
    css = format_css({"page_padding": 9, "line_height": 1.7})
    assert css.count("padding:") == 1
    assert "body { line-height: 1.7 !important; }" in css


# ===== 照片系数 =====


def test_photo_scale_defaults_to_one_and_is_invisible_in_css():
    assert resolve_photo_scale({}) == DEFAULT_PHOTO_SCALE
    assert resolve_photo_scale(None) == 1.0
    assert photo_scale_css_value({}) is None
    assert photo_scale_css_value({PHOTO_SCALE_KEY: 1.0}) is None
    assert "--photo-scale" not in format_css({})


def test_photo_scale_beyond_one_writes_the_root_variable():
    assert photo_scale_css_value({PHOTO_SCALE_KEY: 1.15}) == "1.15"
    assert "--photo-scale: 1.15;" in format_css({PHOTO_SCALE_KEY: 1.15})
    # 与其它 `:root` 变量同处一块，不额外开一个 <style>。
    assert format_css({PHOTO_SCALE_KEY: 1.5}).startswith(":root { --photo-scale: 1.5; }")


def test_photo_scale_clamps_defensively():
    """解析层对**未过白名单**的输入也收口（正常路径由 ``validated_format_config`` 丢弃）。"""
    assert resolve_photo_scale({PHOTO_SCALE_KEY: 3.0}) == PHOTO_SCALE_MAX
    assert resolve_photo_scale({PHOTO_SCALE_KEY: 0.1}) == PHOTO_SCALE_MIN
    assert resolve_photo_scale({PHOTO_SCALE_KEY: "abc"}) == DEFAULT_PHOTO_SCALE


def test_clamp_helpers_match_the_interval_constants():
    """前端滑杆依赖这两个区间；后端只在兜底路径用，但**必须**是同一套边界。"""
    assert clamp_page_margin(-1) == PAGE_MARGIN_MIN
    assert clamp_page_margin(99) == PAGE_MARGIN_MAX
    assert clamp_page_margin(14.05) == 14.05
    assert clamp_photo_scale(0.1) == PHOTO_SCALE_MIN
    assert clamp_photo_scale(9) == PHOTO_SCALE_MAX
    assert clamp_photo_scale(1.02) == 1.02


def test_photo_scale_step_divides_the_interval():
    """步长必须能整除区间，否则滑杆两端会出现走不到的余量。"""
    span = PHOTO_SCALE_MAX - PHOTO_SCALE_MIN
    assert abs(span / PHOTO_SCALE_STEP - round(span / PHOTO_SCALE_STEP)) < 1e-9
    margin_span = PAGE_MARGIN_MAX - PAGE_MARGIN_MIN
    assert abs(margin_span / PAGE_MARGIN_STEP - round(margin_span / PAGE_MARGIN_STEP)) < 1e-9


# ===== 白名单：越界**丢弃**（不夹紧）=====


def test_validated_format_config_drops_out_of_range_extras():
    """与 ``page_padding`` 及 ``test_format_config_is_whitelisted`` 同一条契约：
    非法输入不进入 CSS/渲染。**不对称是故意的**——夹紧会让那条测试的哲学崩掉，
    可用性由前端滑杆的 clamp 兜住。
    """
    assert validated_format_config({"page_padding_top": 30}) == {}
    assert validated_format_config({"page_padding_left": -0.1}) == {}
    assert validated_format_config({PHOTO_SCALE_KEY: 2.0}) == {}
    assert validated_format_config({PHOTO_SCALE_KEY: 0.2}) == {}
    assert validated_format_config({"page_padding_right": "abc"}) == {}
    assert validated_format_config({"page_padding_bottom": None}) == {}


def test_validated_format_config_keeps_in_range_extras():
    assert validated_format_config({"page_padding_top": 8}) == {"page_padding_top": 8.0}
    assert validated_format_config({PHOTO_SCALE_KEY: 1.4}) == {PHOTO_SCALE_KEY: 1.4}
    assert validated_format_config({PHOTO_SCALE_KEY: 1.15}) == {PHOTO_SCALE_KEY: 1.15}
    # 端点包含在内（滑杆能拖到两端）。
    assert validated_format_config({"page_padding_left": 26}) == {"page_padding_left": 26.0}
    assert validated_format_config({PHOTO_SCALE_KEY: 0.6}) == {PHOTO_SCALE_KEY: 0.6}


def test_extra_bounds_covers_both_families():
    assert extra_bounds("page_padding_top") == (PAGE_MARGIN_MIN, PAGE_MARGIN_MAX)
    assert extra_bounds(PHOTO_SCALE_KEY) == (PHOTO_SCALE_MIN, PHOTO_SCALE_MAX)


def test_unknown_extra_key_falls_back_to_the_margin_interval():
    """白名单是"过滤"环节，不该成为崩溃点：未知键给一个合法区间，不抛异常。"""
    assert extra_bounds("page_padding_sideways") == (PAGE_MARGIN_MIN, PAGE_MARGIN_MAX)


def test_all_margin_keys_are_reachable_by_key_name():
    """键名拼装只有一个出处；写死字符串的调用方（前端、API 文档）靠这条对齐。"""
    assert {side: f"page_padding_{side}" for side in PAGE_MARGIN_SIDES} == PAGE_MARGIN_KEYS

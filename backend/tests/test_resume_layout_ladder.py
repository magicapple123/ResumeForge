# SPDX-License-Identifier: Apache-2.0
"""「自动一页」的字号下限与收紧阶梯规则。

拆分自 test_resume_layout.py——先动间距还是先动字号、每档只紧不松、用户手调过的值
不许反弹、字号探针只出现在字号档——这些阶梯规则单独成文件。
"""

from app.services.resume.resume_layout import (
    MIN_FONT_PX,
    build_fit_ladder,
    fit_room_report,
    font_adjust_floor,
)


def test_font_floor_is_governed_by_absolute_pixels_not_ratio():
    """标准档乘 0.88 还有 12.3px，小字号档乘 0.88 就只剩 10.6px 了。"""
    base_px = {"small": 12.0, "standard": 14.0, "large": 15.5}
    for name, size in base_px.items():
        floor = font_adjust_floor(name)
        assert size * floor >= MIN_FONT_PX - 1e-9, name
    # 小字号档本身就等于下限，系数只能是 1——不允许再缩。
    assert font_adjust_floor("small") == 1.0
    # 其余档位受**自动一页自己的** 0.88 下限约束（比像素下限更严）。
    # 注意这是 `AUTO_FIT_MIN_ADJUST`，不是格式字段的 min——字段 min 已为无级字号滑块
    # 放宽到 0.35，自动一页仍不许把字缩到那种程度。
    assert font_adjust_floor("standard") == 0.88
    assert font_adjust_floor("large") == 0.88


def test_font_floor_never_exceeds_one():
    for scale in ("small", "standard", "large", "不存在的档位"):
        assert font_adjust_floor(scale) <= 1.0


# ===== 收紧阶梯 =====


def test_ladder_order_is_padding_then_gap_then_line_height_then_font():
    """越靠前的旋钮对可读性的影响越小，所以先动它们。"""
    keys = [item.key for item in build_fit_ladder("minimal", "standard", {})]
    # 去掉连续重复后，顺序必须是这四类
    deduped = [key for index, key in enumerate(keys) if index == 0 or key != keys[index - 1]]
    assert deduped == ["padding", "section_gap", "line_height", "font_scale_adjust"]


def test_ladder_is_cumulative_and_only_ever_tightens():
    ladder = build_fit_ladder("classic", "standard", {})
    assert ladder, "经典模板默认 14mm 页边距，应当还有收紧余地"
    # 第一档只动页边距
    assert ladder[0].config["page_padding"] < 14
    # 之后每一档都建立在前一档之上：前面的旋钮一个都不能丢，重叠的键只会更紧、不会反弹。
    # 相邻两档配对比较：两序列长度恒差 1，strict=False 是语义的一部分。
    for previous, current in zip(ladder, ladder[1:], strict=False):
        assert set(previous.config) <= set(current.config)
        for key, value in previous.config.items():
            assert current.config[key] <= value, f"{key} 反弹了"
    # 末档：四个旋钮都到下限量
    last = ladder[-1].config
    assert last["page_padding"] == 12
    assert last["section_gap"] == 0.8
    assert last["line_height"] == 1.4
    assert last["font_scale_adjust"] == 0.88


def test_ladder_never_loosens_a_value_the_user_tightened():
    """用户已经把行高调到 1.3 了，自动一页不该把它放大回 1.4。"""
    ladder = build_fit_ladder("classic", "standard", {"line_height": 1.3})
    assert ladder
    for item in ladder:
        assert "line_height" not in item.config


def test_ladder_skips_knobs_already_at_the_floor():
    ladder = build_fit_ladder(
        "compact", "standard", {"page_padding": 12, "section_gap": 0.8, "line_height": 1.4}
    )
    keys = {item.key for item in ladder}
    assert keys == {"font_scale_adjust"}


def test_ladder_keeps_the_users_colours():
    """自动一页只该动版式，不该顺手把人选的强调色丢掉。"""
    ladder = build_fit_ladder("classic", "standard", {"accent": "#166534", "line_height": 1.6})
    assert ladder
    for item in ladder:
        assert item.config["accent"] == "#166534"


def test_ladder_is_empty_when_everything_is_at_the_floor():
    ladder = build_fit_ladder(
        "compact",
        "small",  # 小字号档的系数下限是 1
        {"page_padding": 12, "section_gap": 0.8, "line_height": 1.4},
    )
    assert ladder == []


def test_ladder_css_starts_from_the_shared_builder_then_adds_the_font_probe():
    """阶梯里的 css = 渲染同款 CSS + 一段只给探针用的字号覆盖。

    前半段必须复用 `format_css`（否则量出来的版式和真正渲染的不是一回事）；
    后半段只补字号——因为字号系数在渲染时是预乘进 `base_px` 的，没有 CSS 变量可覆盖。
    """
    from app.services.resume.resume_templates import format_css

    ladder = build_fit_ladder("classic", "standard", {})
    last = ladder[-1]
    assert last.css.startswith(format_css(last.config))
    # 末档字号收到 0.88 → 标准档 14px × 0.88 = 12.32px，写成绝对的 --fs。
    assert "--fs: 12.32px;" in last.css


def test_font_probe_only_appears_on_the_font_rung():
    """前几档不该带字号覆盖：量的时候要如实反映"只收了间距/行高"的效果。"""
    ladder = build_fit_ladder("classic", "standard", {})
    for item in ladder:
        if item.key == "font_scale_adjust":
            assert "--fs:" in item.css
        else:
            assert "--fs:" not in item.css


def test_room_report_explains_the_font_floor():
    room = fit_room_report("minimal", "standard", {})
    assert room["has_room"] is True
    assert room["font_floor_px"] == MIN_FONT_PX
    assert "9pt" in room["font_floor_note"] or "12px" in room["font_floor_note"]

    tight = fit_room_report(
        "compact", "small", {"page_padding": 12, "section_gap": 0.8, "line_height": 1.4}
    )
    assert tight["has_room"] is False
    assert "不会再缩小字号" in tight["font_floor_note"]


# ===== 四向页边距下的阶梯（2026-10-22）=====
#
# 阶梯每档写的是"总" `page_padding`，而四边可以各自不同。两条性质必须同时成立：
# 1. 候选配置里**不许**残留分边支路——留着它们，"总"会被覆盖，第一档就是"按了没反应"；
# 2. 任何一边都不许被放大——`_effective_layout` 取四边**最小值**起步，这是"只紧不松"的保证。


def test_ladder_drops_the_side_branches_and_only_ever_tightens():
    """有分边支路时，每档都从四边**最小值**再往紧收，且候选配置里没有支路。"""
    ladder = build_fit_ladder(
        "classic",
        "standard",
        {
            "page_padding": 14,
            "page_padding_top": 14,
            "page_padding_right": 13,
            "page_padding_bottom": 13,
            "page_padding_left": 13,
        },
    )
    assert ladder, "13mm 仍有收紧余地（下限 12mm）"
    for item in ladder:
        assert not [key for key in item.config if key.startswith("page_padding_")], (
            "支路留在候选配置里会让写入的 page_padding 失效"
        )
        assert item.config["page_padding"] <= 13, "页边距反弹了（比当前最小值还大）"
    # 第一档是「13 → 12」，不是「14 → 12」（后者会让右/下/左先被放大一档）。
    assert ladder[0].config["page_padding"] == 12


def test_ladder_skips_the_margin_rung_when_one_side_is_below_the_floor():
    """「上 20 / 其余 10」：最小值 10 已在 ‹12mm› 之下，页边距档直接跳过。

    若拿"上"（20）当当前值，第一档会把其余三边从 10 **放大**到 12——正是"只紧不松"
    契约禁止的反弹。宁可什么都不做，让用户自己决定要不要对称。
    """
    ladder = build_fit_ladder(
        "classic",
        "standard",
        {
            "page_padding_top": 20,
            "page_padding_right": 10,
            "page_padding_bottom": 10,
            "page_padding_left": 10,
        },
    )
    assert "padding" not in {item.key for item in ladder}
    assert all("page_padding" not in item.config for item in ladder)


def test_ladder_keeps_the_users_photo_scale():
    """自动一页**绝不动**照片大小（设计 §6.1：照片不自动缩小）。

    把 `photo_scale` 从阶梯里抹掉，等于点一次「自动一页」就把用户调好的 150% 悄悄重置
    回 100%——那是比"调了没变"更糟的一类失败：用户不会发现，只会觉得"照片怎么又小了"。
    """
    ladder = build_fit_ladder("classic", "standard", {"photo_scale": 1.5})
    assert ladder
    for item in ladder:
        assert item.config["photo_scale"] == 1.5


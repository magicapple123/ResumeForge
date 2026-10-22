# SPDX-License-Identifier: Apache-2.0
"""模板 CSS 与 ``TEMPLATE_LAYOUT_DEFAULTS`` 注册表的漂移守卫。

拆分自 test_resume_layout.py——页边距/行高/间距、字号层级比例、标题形状与配色、
``--fs`` 全派生：注册表与模板文件一旦漂移（PDF 与预览分叉）立刻变红。
全部 CSS 解析 helper（_selector_block / _fs_scale / _section_title_* / _normalize_hex /
_RATIO_SELECTORS / _COLOR_KEYS）随用例收在本文件。
"""

import re

import pytest
from app.services.resume.resume_templates import (
    FONT_SCALES,
    RESUME_TEMPLATES,
    TEMPLATE_LAYOUT_DEFAULTS,
    TEMPLATES_DIR,
)

# ===== 与模板文件的漂移守卫 =====


# 各层级字号比例在模板 CSS 里的选择器。键名与 `TEMPLATE_LAYOUT_DEFAULTS` 的 `*_ratio` 一一对应。
# 直出 PDF 的字号层级就是靠这组比例与预览对齐的（`pdf_exporter.resolve_layout` 从注册表读），
# 所以模板改了比例而注册表没跟上，就应该在这里被逮住。
_RATIO_SELECTORS: dict[str, str] = {
    "name_ratio": ".header .name",
    # 姓名旁的性别等附加信息：预览里是独立的 `.name-extra` 小号灰字，各模板比例不同
    # （classic/modern 1.0、compact/minimal/elegant 0.93、technical 0.95）。PDF 与 Word
    # 的性别字号都从注册表读这把比例，不核对就会退回"性别跟姓名一样大"的老 bug。
    "name_extra_ratio": ".name-extra",
    "intent_ratio": ".header .intent",
    "contact_ratio": ".header .contact",
    "section_title_ratio": ".section-title",
    "entry_title_ratio": ".entry-head .title",
    # 条目头右侧副行与条目下副行是**两个**选择器：多数模板比例相同，technical 却是 0.86/0.9。
    # 两个都要核对，否则只改其中一个（比如把 `.sub` 从 0.9 改成 0.86）会悄悄漂移而过。
    "entry_meta_ratio": ".entry-head .meta",
    "entry_sub_ratio": ".entry .sub",
    "tag_font_ratio": ".skill-list li",
}


def _selector_font_size_ratio(css: str, selector: str) -> float:
    """读出某条选择器的 `font-size` 是 `--fs` 的多少倍（`var(--fs)` 记作 1.0）。"""
    block = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert block, f"模板里没找到选择器 {selector}"
    declarations = block.group(1)
    scaled = re.search(r"font-size:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", declarations)
    if scaled:
        return float(scaled.group(1))
    assert re.search(r"font-size:\s*var\(--fs\)", declarations), (
        f"{selector} 的字号既不是 calc(var(--fs)*N) 也不是 var(--fs)"
    )
    return 1.0


def test_template_layout_defaults_match_the_template_files():
    """`TEMPLATE_LAYOUT_DEFAULTS` 上的数字必须与模板 CSS 一致。

    自动一页靠它们判断「当前值是多少、还能往紧收多少」。抄错会让它收紧一个用户根本
    没设过的值，或者该收没收——而这两件事在界面上都看不出来，只会表现为"按了没反应"。

    **字号层级比例（`*_ratio`）也在这里核对**：直出 PDF 不再自带第二份系数，改从注册表读这组
    比例；若注册表与模板 CSS 漂移（哪怕是"只改了注册表"），PDF 与预览的字号层级又会分叉——
    这条守卫让那种漂移直接变红。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        defaults = TEMPLATE_LAYOUT_DEFAULTS[name]

        padding = re.search(r"padding:\s*([\d.]+)mm", css)
        assert padding, f"{spec['file']} 里没找到页边距"
        assert float(padding.group(1)) == defaults["padding_mm"], name

        line_height = re.search(r"line-height:\s*([\d.]+)", css)
        assert line_height, f"{spec['file']} 里没找到行高"
        assert float(line_height.group(1)) == defaults["line_height"], name

        gap = re.search(
            r"\.section\s*\{\s*margin-bottom:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", css
        )
        assert gap, f"{spec['file']} 里没找到区块间距"
        assert float(gap.group(1)) == defaults["section_gap"], name

        for key, selector in _RATIO_SELECTORS.items():
            ratio = _selector_font_size_ratio(css, selector)
            assert ratio == defaults[key], (
                f"{name} 的 {key}（{selector}）：注册表 {defaults[key]} vs 模板 {ratio}"
            )


# 模板配色在 `TEMPLATE_LAYOUT_DEFAULTS` 里的键，值对应模板 `:root` 里的同名 CSS 变量
# （去掉 `--` 前缀）。直出 PDF 的强调色从这读（`pdf_exporter` 不再自带 `_TEMPLATE_COLORS`），
# 所以模板改了颜色而注册表没跟上，PDF 配色就会与预览悄悄分叉。
_COLOR_KEYS = ("accent", "text", "muted", "line")


def _selector_block(css: str, selector: str) -> str:
    """取某条选择器 `{ ... }` 里的声明文本（不跨选择器）。"""
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert match, f"模板里没找到选择器 {selector}"
    return match.group(1)


def _fs_scale(declarations: str, prop: str) -> float | None:
    """读出某条声明里的 `calc(var(--fs) * N)` 里的 N；没有该属性返回 None。

    尾部允许带一个 ``* var(--photo-scale, 1)``（照片的宽高各乘一次系数）。回退值 ``1``
    让"没设过照片大小"与今天完全等价，所以**取到的 N 仍是模板原尺寸**——这一点不能松，
    否则"照片默认尺寸"的漂移守卫就失效了。
    """
    match = re.search(
        re.escape(prop)
        + r":\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)(?:\s*\*\s*var\(--photo-scale,\s*1\))?\)",
        declarations,
    )
    return float(match.group(1)) if match else None


def _section_title_style(declarations: str) -> str:
    """由 `.section-title` 的声明反推它的形状（与各模板 CSS 一一对应）。"""
    if "border-left:" in declarations:
        return "left_bar"
    if "display: inline-block" in declarations and "background: var(--accent);" in declarations:
        return "accent_box"
    if "background: var(--accent-soft)" in declarations:
        return "soft_box"
    if "border-bottom:" in declarations:
        return "underline"
    return "plain"


def _section_title_text(declarations: str) -> str:
    """由 `.section-title` 的 `color` 反推标题文字色（无 color 则继承正文色）。"""
    match = re.search(r"(?<!-)\bcolor:\s*(#[0-9a-fA-F]{3,6}|var\(--[a-z-]+\))", declarations)
    if not match:
        return "body"
    token = match.group(1)
    if token == "var(--accent)":
        return "accent"
    if token == "var(--muted)":
        return "muted"
    if token.startswith("#") and _normalize_hex(token) == "ffffff":
        return "white"
    return "body"


def _section_title_padding(declarations: str) -> tuple[float, float]:
    """由 `.section-title` 反推（纵向内边距, 横向内边距），单位是 × 字号。"""
    shorthand = re.search(
        r"padding:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)\s+calc\(var\(--fs\)\s*\*\s*([\d.]+)\)",
        declarations,
    )
    if shorthand:
        return float(shorthand.group(1)), float(shorthand.group(2))
    pad_y = _fs_scale(declarations, "padding-bottom")
    pad_x = _fs_scale(declarations, "padding-left")
    return (pad_y or 0.0), (pad_x or 0.0)


def test_template_vertical_gaps_and_title_style_match_the_template_files():
    """垂直间距、区块标题形状/配色/内边距、照片尺寸都必须与模板 CSS 一致。

    这些此前**只存在于模板 CSS**、`TEMPLATE_LAYOUT_DEFAULTS` 里没有、PDF 侧也完全没画，
    正是"直出 PDF 比预览被压扁"的根因。既然现在 PDF 从注册表读它们，注册表就不能与模板
    漂移——否则又是一次"两边各写各的"。与字号比例守卫同理，期望值来自注册表、拿模板 CSS 比对。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        defaults = TEMPLATE_LAYOUT_DEFAULTS[name]

        header = _selector_block(css, ".header")
        assert _fs_scale(header, "margin-bottom") == defaults["header_gap"], name
        # 页头内部的两段段前留白。**这两项在 PDF 里漏画过**：画完姓名就直接画意向与联系方式，
        # 于是 PDF 页头比预览矮 3.1mm、整份内容跟着少 12mm。现在它们进注册表、被
        # `resolve_layout` 读走、由 `_draw_resume` 用 `ln` 画出来——这条守卫让"注册表有、
        # 模板改了没跟上"或"注册表漏了这两项"都直接变红。
        assert (
            _fs_scale(_selector_block(css, ".header .intent"), "margin-top")
            == defaults["intent_gap"]
        ), name
        assert (
            _fs_scale(_selector_block(css, ".header .contact"), "margin-top")
            == defaults["contact_gap"]
        ), name
        # 页头装饰：底边线（宽度/颜色）、padding-bottom，以及 modern 的浅底色块。
        header_border = re.search(r"border-bottom:\s*([\d.]+)px\s+solid\s+var\(--accent\)", header)
        assert (float(header_border.group(1)) if header_border else 0.0) == defaults[
            "header_border_width"
        ], name
        assert ("accent" if header_border else "none") == defaults["header_border_color"], name
        assert (_fs_scale(header, "padding-bottom") or 0.0) == defaults["header_pad_bottom"], name
        assert (
            "soft_accent" if "background: var(--accent-soft)" in header else "none"
        ) == defaults["header_bg"], name
        header_padding = re.search(
            r"padding:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)\s+calc\(var\(--fs\)\s*\*\s*([\d.]+)\)",
            header,
        )
        assert (float(header_padding.group(1)) if header_padding else 0.0) == defaults[
            "header_pad_y"
        ], name
        assert (float(header_padding.group(2)) if header_padding else 0.0) == defaults[
            "header_pad_x"
        ], name
        assert (_fs_scale(header, "border-radius") or 0.0) == defaults["header_radius"], name

        entry = _selector_block(css, ".entry")
        assert _fs_scale(entry, "margin-bottom") == defaults["entry_gap"], name

        sub = _selector_block(css, ".entry .sub")
        sub_margin = re.search(
            r"margin:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)\s+0\s+calc\(var\(--fs\)\s*\*\s*([\d.]+)\)",
            sub,
        )
        assert sub_margin, f"{spec['file']} 里 `.entry .sub` 不是 `AR 0 BR` 形式"
        assert float(sub_margin.group(1)) == defaults["sub_gap_top"], name
        assert float(sub_margin.group(2)) == defaults["sub_gap_bottom"], name

        # 列表项：模板里是裸 `li { margin-bottom: ... }`（`.skill-list li` / `li::marker` 不算）。
        li_block = re.search(r"(?:^|\n)\s*li\s*\{([^}]*)\}", css)
        assert li_block, f"{spec['file']} 里没找到裸 li 选择器"
        assert _fs_scale(li_block.group(1), "margin-bottom") == defaults["li_gap"], name

        title = _selector_block(css, ".section-title")
        assert _fs_scale(title, "margin-bottom") == defaults["section_title_gap"], name
        assert _section_title_style(title) == defaults["section_title_style"], name
        assert _section_title_text(title) == defaults["section_title_text"], name
        assert ("center" if "text-align: center" in title else "left") == defaults[
            "section_title_align"
        ], name
        pad_y, pad_x = _section_title_padding(title)
        assert pad_y == defaults["section_title_pad_y"], name
        assert pad_x == defaults["section_title_pad_x"], name

        photo = _selector_block(css, ".profile-photo")
        assert _fs_scale(photo, "width") == defaults["photo_width_ratio"], name
        assert _fs_scale(photo, "height") == defaults["photo_height_ratio"], name


def _normalize_hex(value: str) -> str:
    """把十六进制颜色归一成 6 位小写（`#abc` 展开成 `#aabbcc`，忽略大小写）。"""
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    return text.lower()


def test_template_colors_match_the_template_files():
    """`TEMPLATE_LAYOUT_DEFAULTS` 上的颜色必须与模板 CSS 的 `:root` 变量一致。

    期望值从注册表读、拿模板 CSS 比对，不在这里再抄一份颜色常量——抄一份就等于又写了一遍
    "跟自己比"。这条与上面的版式守卫一起，保证 `pdf_exporter` 读注册表拿到的强调色与预览
    是**同一份定义**：此前 PDF 自带 `_TEMPLATE_COLORS`，模板改 `--accent` 它不会跟着变。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
        for key in _COLOR_KEYS:
            var = f"--{key}"
            match = re.search(re.escape(var) + r"\s*:\s*(#[0-9a-fA-F]{3,6})", css)
            assert match, f"{spec['file']} 里没找到 {var}"
            assert _normalize_hex(match.group(1)) == _normalize_hex(str(defaults[key])), (
                f"{name} 的 {var}：注册表 {defaults[key]} vs 模板 {match.group(1)}"
            )


def test_every_template_has_layout_defaults():
    assert set(TEMPLATE_LAYOUT_DEFAULTS) == set(RESUME_TEMPLATES)


def test_every_template_sizes_everything_from_the_fs_variable():
    """所有尺寸都必须由 `--fs` 派生，否则整份简历无法按档位整体缩放。

    「自动一页」最细的一档就是改这一个变量：模板里若混着写死的 px，那一档就会只缩一部分
    文字，版面看起来"没收紧多少"——而用户完全看不出原因。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        # `--fs` 就是滑杆上的那个像素值，**字面量**、外面不许再挂任何系数
        # （2026-10-21 用户要求"参数即呈现"：`calc(... * var(--fit-scale, 1))` 已整体删除）。
        assert "--fs: {{ base_px }}px;" in css, name
        # 正文与标题的主要尺寸都要走 calc(var(--fs) * N)。
        assert "font-size: var(--fs);" in css, name
        assert "calc(var(--fs) *" in css, name


# ===== 技能标签的形状（8 个模板共 5 种形态）=====
#
# **为什么要有这组守卫**：PDF 曾把 8 个模板的技能标签统一画成一种形状——"带底色的圆角框 +
# 强调色文字"，比例写死 0.71 / 0.57 / 0.4。于是 classic（硬编码浅灰底、4px 圆角）、modern /
# split（描边胶囊）、technical（左侧色条）、compact（无框 + 「·」分隔）、minimal（纯文字）、
# editorial / elegant（无框 / 浅底）七个模板的标签，导出的 PDF 长得**和预览不一样**。现在
# 形状由注册表的 `tag_*` 键驱动，这组守卫把它与模板 CSS 钉在一起：模板改了标签样式而注册表
# 没跟上，PDF 与预览就又开始分叉。

# 技能标签在注册表里的键（`accent_soft` 单独核对，它不是标签专属的键）。
_TAG_KEYS = (
    "tag_style",
    "tag_bg",
    "tag_fg",
    "tag_border_px",
    "tag_radius",
    "tag_pad_x",
    "tag_gap_x",
    "tag_gap_y",
)


def _root_hex(css: str, var: str) -> str | None:
    """取 `:root` 里某个颜色变量的十六进制值（3 位会展开成 6 位）；没有则返回 None。"""
    match = re.search(re.escape(var) + r"\s*:\s*(#[0-9a-fA-F]{3,6})", css)
    return _normalize_hex(match.group(1)) if match else None


def _tag_style(declarations: str, css: str) -> str:
    """由 `.skill-list li` 的声明反推标签形态（与 5 种画法一一对应）。"""
    if "border-left:" in declarations:
        return "left_bar"
    if re.search(r"\bborder:", declarations):
        return "outline"
    if re.search(r"\bbackground:", declarations):
        return "fill"
    if re.search(r'\.skill-list li::after\s*\{[^}]*content:\s*"·"', css):
        return "dot"
    return "plain"


def _tag_bg(declarations: str, css: str) -> str:
    """标签底色：CSS `background` 的值；`var(--accent-soft)` 按模板 `:root` 展开成真实十六进制。"""
    match = re.search(r"(?<!-)\bbackground:\s*(#[0-9a-fA-F]{3,6}|var\(--[a-z-]+\))", declarations)
    if not match:
        return "none"
    token = match.group(1)
    if token.startswith("var("):
        resolved = _root_hex(css, token[len("var(") : -1])
        assert resolved, f"模板里用了 {token} 但 `:root` 没定义它"
        return resolved
    return _normalize_hex(token)


def _tag_fg(declarations: str) -> str:
    """标签字色：`var(--accent)` → accent、`var(--text)` → body、没写 color → 继承正文（body）。"""
    match = re.search(r"(?<!-)\bcolor:\s*(var\(--[a-z-]+\))", declarations)
    if not match:
        return "body"
    token = match.group(1)
    if token == "var(--accent)":
        return "accent"
    if token == "var(--muted)":
        return "muted"
    return "body"


def _tag_border_px(declarations: str) -> float:
    """边框宽度（px）：描边模板是 `border`，左侧色条模板是 `border-left`。"""
    match = re.search(r"\bborder(?:-left)?:\s*([\d.]+)px", declarations)
    return float(match.group(1)) if match else 0.0


def _tag_radius(declarations: str, tag_font_ratio: float) -> float | str:
    """圆角：CSS 是**固定 px**（`999px` 记作胶囊哨兵），注册表统一用"× 标签字号"。

    `999px` 是浏览器里"圆到短边一半"的通用写法，PDF 侧画成 `height / 2`，所以用 `"pill"`
    哨兵表达；其余的固定 px 按**标准字号档**的标签字号换算成比例——这是唯一一处"px → 比例"
    的换算，换成 small/large 档会有 ±0.5px 的视觉误差，可接受。
    """
    match = re.search(r"\bborder-radius:\s*([\d.]+)px", declarations)
    if not match:
        return 0.0
    radius_px = float(match.group(1))
    if radius_px >= 99:
        return "pill"
    tag_px = tag_font_ratio * float(FONT_SCALES["standard"]["base_px"])
    return radius_px / tag_px


def _tag_padding_x(declarations: str) -> float:
    """左右内边距（× 标签字号）：CSS 简写 `padding: 0 <X>`，纵向为 0。"""
    match = re.search(r"\bpadding:\s*0\s+calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", declarations)
    return float(match.group(1)) if match else 0.0


def _tag_margins(declarations: str) -> tuple[float, float]:
    """`margin: 0 <右> <下> 0` → (横向间距, 纵向间距)，单位是 × 标签字号。"""
    match = re.search(
        r"\bmargin:\s*0\s+calc\(var\(--fs\)\s*\*\s*([\d.]+)\)\s+"
        r"calc\(var\(--fs\)\s*\*\s*([\d.]+)\)\s+0",
        declarations,
    )
    assert match, "`.skill-list li` 的 margin 不是 `0 <右> <下> 0` 形式"
    return float(match.group(1)), float(match.group(2))


def test_template_tag_shapes_match_the_template_files():
    """技能标签的形态、底色、字色、边框、圆角与三个间距都必须与模板 CSS 一致。

    期望值从注册表读、拿模板 CSS 反推后比对（不在这里再抄一份取值），理由同上面几条：
    抄一份就等于又写了一遍"跟自己比"。PDF 曾经把 8 个模板的标签统一画成一种形状，这组
    守卫是那次返工留下的刻度——模板改了 `.skill-list li` 而注册表没跟上，立刻变红。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
        declarations = _selector_block(css, ".skill-list li")

        for key in _TAG_KEYS:
            assert key in defaults, f"{name} 的注册表缺 {key}"

        assert _tag_style(declarations, css) == defaults["tag_style"], name
        assert _tag_bg(declarations, css) == (
            "none" if defaults["tag_bg"] == "none" else _normalize_hex(str(defaults["tag_bg"]))
        ), name
        assert _tag_fg(declarations) == defaults["tag_fg"], name
        assert _tag_border_px(declarations) == defaults["tag_border_px"], name

        radius = _tag_radius(declarations, float(defaults["tag_font_ratio"]))
        if isinstance(defaults["tag_radius"], str):
            assert radius == defaults["tag_radius"], name
        else:
            assert radius == pytest.approx(float(defaults["tag_radius"]), abs=5e-3), name

        assert _tag_padding_x(declarations) == defaults["tag_pad_x"], name
        gap_x, gap_y = _tag_margins(declarations)
        assert gap_x == defaults["tag_gap_x"], name
        assert gap_y == defaults["tag_gap_y"], name

        # `--accent-soft`：页头底色块与部分模板的标签底色都用它。CSS 没定义这个变量的模板
        # （classic / compact / editorial）在注册表里写 `"none"`，PDF 侧回落到
        # `soft_accent(accent)`——"有没有这个键"本身就是需要守住的事实。
        resolved_soft = _root_hex(css, "--accent-soft")
        if resolved_soft is None:
            assert defaults["accent_soft"] == "none", name
        else:
            assert resolved_soft == _normalize_hex(str(defaults["accent_soft"])), name

        # compact 的「·」分隔符是标签形态的一部分（`tag_style="dot"`），连同"最后一项不加"
        # 的 `:last-child` 重置一起核对——只删掉 `:last-child` 那条，每个标签后面都会拖一个点。
        if defaults["tag_style"] == "dot":
            after = _selector_block(css, ".skill-list li::after")
            assert 'content: "·"' in after, name
            assert "color: var(--line)" in after, name
            last = _selector_block(css, ".skill-list li:last-child::after")
            assert 'content: ""' in last, name


def test_template_list_indent_matches_the_template_files():
    """列表缩进 `ul { padding-left: calc(var(--fs) * N) }` 的 N 必须进注册表。

    PDF 侧此前把列表缩进写死成 3.0mm、与字号无关，而 8 个模板的真实值是 1.25（split）~
    1.43（classic / modern / editorial）。1.6~2.3mm 的行宽差在窄栏里会直接改变折行行数——
    实测 split 两栏比草稿矮 9.2mm、单栏 A_default 矮 3.0mm，主要就是这一项。这条守卫让
    "模板改了 `ul` 的 padding-left 而注册表没跟上"立刻变红。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        block = _selector_block(css, "ul")
        assert _fs_scale(block, "padding-left") == TEMPLATE_LAYOUT_DEFAULTS[name]["li_indent"], name

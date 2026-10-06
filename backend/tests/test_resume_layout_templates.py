"""模板 CSS 与 ``TEMPLATE_LAYOUT_DEFAULTS`` 注册表的漂移守卫。

拆分自 test_resume_layout.py——页边距/行高/间距、字号层级比例、标题形状与配色、
``--fs`` 全派生：注册表与模板文件一旦漂移（PDF 与预览分叉）立刻变红。
全部 CSS 解析 helper（_selector_block / _fs_scale / _section_title_* / _normalize_hex /
_RATIO_SELECTORS / _COLOR_KEYS）随用例收在本文件。
"""
import re

from app.services.resume.resume_templates import (
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

        gap = re.search(r"\.section\s*\{\s*margin-bottom:\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", css)
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
    """读出某条声明里的 `calc(var(--fs) * N)` 里的 N；没有该属性返回 None。"""
    match = re.search(
        re.escape(prop) + r":\s*calc\(var\(--fs\)\s*\*\s*([\d.]+)\)", declarations
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

    自动一页最细的一档就是改这一个变量：模板里若混着写死的 px，那一档就会只缩一部分
    文字，版面看起来"没收紧多少"——而用户完全看不出原因。
    """
    for name, spec in RESUME_TEMPLATES.items():
        css = (TEMPLATES_DIR / spec["file"]).read_text(encoding="utf-8")
        # `--fs` 除了档位基准值，还挂着一个**版式自适应**系数：自适应靠它把整份版式真实变矮，
        # 而不是加一层只改视觉的 transform（后者会让预览与打印的页数对不上）。
        assert "--fs: calc({{ base_px }}px * var(--fit-scale, 1));" in css, name
        # 正文与标题的主要尺寸都要走 calc(var(--fs) * N)。
        assert "font-size: var(--fs);" in css, name
        assert "calc(var(--fs) *" in css, name

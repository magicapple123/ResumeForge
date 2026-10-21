# SPDX-License-Identifier: Apache-2.0
"""模板配色 → PDF 颜色的解析守卫（正文 / 辅助文字 / 强调色 / 强调色浅底 / 分隔线）。

**为什么单独立一组用例**：PDF 的颜色此前是 `layout.py` 里的两个模块常量
（`_BODY_TEXT` / `_MUTED_TEXT`），对所有模板一个值——模板 `:root` 的 `--text` / `--muted`
与用户在「格式模板」里设的「正文颜色 / 辅助文字颜色」**对导出的 PDF 完全不生效**。
三份不同模板导出的 PDF，正文色一模一样。现在颜色统一走
"格式模板覆盖 → 模板 `:root` → 兜底常量"三段解析，这组用例把三段各自钉住：
只删掉任意一段（比如把 `resolve_text` 退回返回常量），对应断言立刻变红。

期望值一律从注册表 `TEMPLATE_LAYOUT_DEFAULTS` 读（它本身又被
`test_resume_layout_templates.py` 拿模板 CSS 逐条核对过），不在这里再抄一份颜色。
"""

import pytest
from app.services.pdf_exporter import (
    _BODY_TEXT,
    _MUTED_TEXT,
    resolve_accent,
    resolve_accent_soft,
    resolve_line,
    resolve_muted,
    resolve_text,
    soft_accent,
)
from app.services.resume.resume_templates import (
    RESUME_TEMPLATES,
    TEMPLATE_LAYOUT_DEFAULTS,
)
from test_pdf_exporter import _hex_to_rgb

# 兜底常量（`resolve_*` 的最后一段）。这里**必须**引用同一份常量而不是抄字面量：
# 抄一份就等于又写了一遍"跟自己比"，常量改了测试也不会红。
_FALLBACK_ACCENT = (22, 54, 92)
_FALLBACK_LINE = (217, 222, 231)


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_colors_default_to_the_template_registry(name):
    """没有任何覆盖时，四个颜色都必须等于模板自己 `:root` 的变量值。

    这条是"模板配色对 PDF 生效"的最小证据：minimal 的 `--text` 是 `#17181a`、technical 是
    `#1c2430`、modern 是 `#24303f`——旧实现下它们全都会解析成 classic 的 `#1f2937`。
    """
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]

    assert resolve_text(name, {}) == _hex_to_rgb(defaults["text"])
    assert resolve_muted(name, {}) == _hex_to_rgb(defaults["muted"])
    assert resolve_accent(name, {}) == _hex_to_rgb(defaults["accent"])
    assert resolve_line(name, {}) == _hex_to_rgb(defaults["line"])


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_accent_soft_prefers_the_template_variable_and_falls_back_when_absent(name):
    """强调色浅底：模板写了 `--accent-soft` 就用它的**真实十六进制**，没有才现场调淡。

    split 的 accent `#6b4f2a` 现场调淡约得 `#edeae5`，而模板写死的是 `#f3eee6`——页头底色块
    与预览有色差就是它；modern 的标签底色同理。这条同时守住"没有这个变量的模板
    （classic / compact / editorial，注册表里写 `"none"`）走 `soft_accent` 兜底"。
    """
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
    if defaults["accent_soft"] == "none":
        expected = soft_accent(_hex_to_rgb(defaults["accent"]))
    else:
        expected = _hex_to_rgb(defaults["accent_soft"])

    assert resolve_accent_soft(name, {}) == expected


def test_format_config_overrides_win_over_the_template():
    """用户在「格式模板」里设过的颜色必须盖过模板默认值（旧实现下 PDF 完全忽略它们）。"""
    overrides = {
        "text_color": "#112233",
        "muted_color": "#445566",
        "accent": "#778899",
        "line_color": "#aabbcc",
    }

    assert resolve_text("minimal", overrides) == (0x11, 0x22, 0x33)
    assert resolve_muted("technical", overrides) == (0x44, 0x55, 0x66)
    assert resolve_accent("modern", overrides) == (0x77, 0x88, 0x99)
    assert resolve_line("modern", overrides) == (0xAA, 0xBB, 0xCC)


def test_accent_soft_is_not_driven_by_the_accent_override():
    """`--accent-soft` 在 CSS 里是**写死的变量**，不随 `--accent` 变——PDF 必须照做。

    两半都要成立：模板写死了 `--accent-soft` 时改 accent 不影响它（否则 PDF 的页头底色
    会比预览更"跟着强调色走"）；模板没有这个变量时（classic）才由 accent 调淡算出来。
    """
    assert resolve_accent_soft("modern", {"accent": "#ff0000"}) == _hex_to_rgb("#e6f4f1")
    assert resolve_accent_soft("split", {"accent": "#ff0000"}) == _hex_to_rgb("#f3eee6")
    assert resolve_accent_soft("classic", {"accent": "#000000"}) == soft_accent((0, 0, 0))


def test_unknown_template_falls_back_to_the_module_constants():
    """未知模板名不能炸：回落兜底常量，且与 `layout` 里那份常量是同一组值。"""
    assert resolve_text("nope", {}) == _BODY_TEXT
    assert resolve_muted("nope", {}) == _MUTED_TEXT
    assert resolve_accent("nope", {}) == _FALLBACK_ACCENT
    assert resolve_line("nope", {}) == _FALLBACK_LINE
    assert resolve_accent_soft("nope", {}) == soft_accent(_FALLBACK_ACCENT)


def test_invalid_override_falls_through_to_the_template_value():
    """写坏的十六进制色不能把正文变黑：解析失败就退回模板值，而不是给一个随机颜色。"""
    assert resolve_text("minimal", {"text_color": "#12"}) == _hex_to_rgb(
        TEMPLATE_LAYOUT_DEFAULTS["minimal"]["text"]
    )

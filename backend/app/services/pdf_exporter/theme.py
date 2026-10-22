# SPDX-License-Identifier: Apache-2.0
"""颜色解析（正文 / 辅助文字 / 强调色 / 强调色浅底 / 分隔线）。

统一口径：**版式覆盖 → 模板 `:root` 默认值 → 兜底常量**。三段的唯一来源分别是
`resume_templates.validated_format_config`、`resume_templates.template_layout_defaults`
与 `layout` 里的兜底常量——本模块不再存任何一份自己的色板。
"""
from __future__ import annotations

from .layout import _BODY_TEXT, _MUTED_TEXT


def _hex_to_rgb(value: str) -> tuple[int, int, int] | None:
    """把版式里的十六进制颜色转成 RGB；不合法时返回 None。"""
    text = (value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    if len(text) != 6:
        return None
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return None


def _resolve_template_color(
    template: str,
    format_config: dict | None,
    *,
    override_key: str,
    default_key: str,
    fallback: tuple[int, int, int],
) -> tuple[int, int, int]:
    """从"版式覆盖 → 模板默认值 → 兜底"里取一个颜色（强调色 / 分隔线共用）。

    颜色唯一来源是 `resume_templates.template_layout_defaults`（共享知识第 10 条）；
    PDF 与 Word 都从这里取同一份颜色，禁止任何渲染器再存一份 `_TEMPLATE_COLORS`。
    """
    from ..resume.resume_templates import (
        template_layout_defaults,
        template_spec,
        validated_format_config,
    )

    spec = template_spec(template)
    overrides = validated_format_config(format_config)
    return (
        _hex_to_rgb(str(overrides.get(override_key) or ""))
        or _hex_to_rgb(str(template_layout_defaults(spec["name"])[default_key]))
        or fallback
    )


def resolve_accent(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的强调色：版式覆盖优先，其次模板默认，最后兜底深蓝。"""
    return _resolve_template_color(
        template, format_config, override_key="accent", default_key="accent", fallback=(22, 54, 92)
    )


def resolve_line(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的分隔线颜色（区块标题的下划线等）：覆盖优先，其次模板 `--line`，最后浅灰。"""
    return _resolve_template_color(
        template, format_config, override_key="line_color", default_key="line", fallback=(217, 222, 231)
    )


def resolve_text(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的正文颜色：`format_config.text_color` → 模板 `--text` → 兜底深灰。

    此前 PDF 把正文色写死在 `layout._BODY_TEXT`，模板 `:root` 的 `--text` 与用户设的
    「正文颜色」**对导出完全不生效**——minimal 的 `#17181a` 与 technical 的 `#1c2430`
    导出来都是 classic 的 `#1f2937`，三份 PDF 的正文色一模一样。
    """
    return _resolve_template_color(
        template, format_config, override_key="text_color", default_key="text", fallback=_BODY_TEXT
    )


def resolve_muted(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的辅助文字颜色（求职意向 / 联系方式 / 条目副行 / 性别）：覆盖 → `--muted` → 兜底灰。"""
    return _resolve_template_color(
        template, format_config, override_key="muted_color", default_key="muted", fallback=_MUTED_TEXT
    )


def resolve_accent_soft(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的"强调色浅底"（页头底色块、soft_box 区块标题、部分模板的标签底色）。

    优先读注册表的 `accent_soft`——那是模板 `:root` 里 `--accent-soft` 的**真实十六进制**。
    此前 PDF 用 `soft_accent(accent)` 现场调淡，与模板写死的值有色差（split 的 accent
    `#6b4f2a` 调淡约得 `#edeae5`，模板是 `#f3eee6`），modern 的标签底色同理。

    `--accent-soft` **没有用户覆盖项**（`FORMAT_FIELDS` 里没有这一项），所以只有
    "模板默认值"与"兜底"两段。注册表里写成 `"none"` 的模板（classic / compact / editorial）
    在 CSS 里确实没有这个变量，此时回落到 `soft_accent(accent)`——自定义模板缺这个键时
    走的也是这条兜底。
    """
    from ..resume.resume_templates import template_layout_defaults, template_spec
    from .skill_tags import soft_accent

    spec = template_spec(template)
    defaults = template_layout_defaults(spec["name"])
    resolved = _hex_to_rgb(str(defaults.get("accent_soft") or ""))
    if resolved is not None:
        return resolved
    return soft_accent(resolve_accent(spec["name"], format_config))


__all__ = [
    "resolve_accent",
    "resolve_accent_soft",
    "resolve_line",
    "resolve_muted",
    "resolve_text",
]

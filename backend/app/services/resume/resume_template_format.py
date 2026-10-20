# SPDX-License-Identifier: Apache-2.0
"""格式模板字段、校验与 CSS 覆盖。"""

from __future__ import annotations

import re

from .resume_sections import normalized_section_order

# ===== 每份简历选字体（项 14）=====
#
# **不是** ``FORMAT_FIELDS`` 的一项：那张表是「格式模板编辑器」的字段清单，每一项都会被
# 渲染成一个输入控件（数字/颜色）。字体是一个"从已上传字体里挑一个"的枚举，塞进去会让
# 编辑器长出一个"字体 = 18"的数字框（D26）。
#
# 但它**必须**和格式配置存在同一个抽屉里（`format_config`）：它同样是"这份简历怎么排"
# 的一部分，跟着简历走、跟着导出走。所以只在 `validated_format_config` 里单独放行。
FONT_KEY = "font"
# 显式"这份简历不使用自定义字体"：与"没设过（跟随全局当前字体）"是**两种**语义，
# 所以要用一个哨兵值把前者表达出来——删键等于后者。
SYSTEM_FONT = "__system__"

FORMAT_FIELDS: tuple[dict, ...] = (
    {"key": "accent", "label": "强调色", "type": "color", "css": "--accent"},
    {"key": "text_color", "label": "正文颜色", "type": "color", "css": "--text"},
    {"key": "muted_color", "label": "辅助文字颜色", "type": "color", "css": "--muted"},
    {"key": "line_color", "label": "分隔线颜色", "type": "color", "css": "--line"},
    {
        "key": "font_scale_adjust",
        "label": "字号系数",
        "type": "number",
        # 下限 0.35：无级字号滑块允许小到 5px（最小档 11px 时系数 5/11≈0.455），
        # 所以字段范围必须能装下它，否则用户拖到 5px 会被 `validated_format_config`
        # 静默丢弃——存下来却不是他调的那个字号，是最难被发现的一类失败。
        # **自动一页仍然只到 0.88**（见 `resume_fit.AUTO_FIT_MIN_ADJUST`），
        # 放宽字段范围不等于让自动一页把字缩到看不清。
        "min": 0.35,
        "max": 1.16,
        "step": 0.02,
        "description": "在所选字号档位上再乘一个系数",
    },
    {
        "key": "line_height",
        "label": "行高",
        "type": "number",
        "min": 1.2,
        "max": 2.2,
        "step": 0.05,
        "css_rule": "body { line-height: %s !important; }",
    },
    {
        "key": "page_padding",
        "label": "页边距（mm）",
        "type": "number",
        "min": 8,
        "max": 26,
        "step": 1,
        "css_rule": "body { padding: %smm !important; }",
    },
    {
        "key": "section_gap",
        "label": "区块间距",
        "type": "number",
        "min": 0.6,
        "max": 2.2,
        "step": 0.1,
        "css_rule": ".section { margin-bottom: calc(var(--fs) * %s) !important; }",
    },
)

FORMAT_FIELD_KEYS = tuple(field["key"] for field in FORMAT_FIELDS)
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _format_field(key: str) -> dict | None:
    return next((field for field in FORMAT_FIELDS if field["key"] == key), None)


def _validated_font_name(value: object) -> str | None:
    """校验"这份简历用哪个字体文件"，返回可用的字体名；不可用返回 ``None``。

    校验交给 ``user_fonts.font_path``——它已经做了"拒绝目录成分 + 后缀白名单 + 文件必须
    存在"三件事，这里再抄一份只会漂移。

    **取不到就静默丢弃**（返回 ``None``，调用方据此不写这个键）：字体文件被用户删掉之后，
    那份简历应当退回"跟随全局当前字体"，而不是整份打不开。这是本条唯一的失败策略——
    字体是显示细节，不该升级成打开简历的前置条件。
    """
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name:
        return None
    if name == SYSTEM_FONT:
        return name
    # 局部 import：`resume_template_format` 被模板/渲染链路广泛引用，模块级再拉一个
    # `user_fonts`（它要读配置目录）会把"只想拿字段表"的调用方也拖进文件系统。
    from ..user_fonts import FontError, font_path

    try:
        font_path(name)
    except FontError:
        return None
    return name


def validated_format_config(raw: dict | None) -> dict:
    """校验可写入 CSS 或版式渲染器的格式配置。"""
    if not isinstance(raw, dict):
        return {}
    result: dict = {}
    for key, value in raw.items():
        if str(key) == "section_order":
            if isinstance(value, (list, tuple)) and value:
                result["section_order"] = normalized_section_order(value)
            continue
        if str(key) == FONT_KEY:
            font_name = _validated_font_name(value)
            if font_name is not None:
                result[FONT_KEY] = font_name
            continue
        field = _format_field(str(key))
        if field is None or value in (None, ""):
            continue
        if field["type"] == "color":
            text = str(value).strip()
            if _HEX_COLOR_RE.fullmatch(text):
                result[field["key"]] = text.lower()
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if float(field.get("min", 0)) <= number <= float(field.get("max", 1)):
            result[field["key"]] = round(number, 3)
    return result


def format_css(config: dict | None) -> str:
    values = validated_format_config(config)
    if not values:
        return ""
    root_parts: list[str] = []
    extra_rules: list[str] = []
    for key, value in values.items():
        field = _format_field(key)
        if field is None:
            continue
        if field.get("css"):
            root_parts.append(f"{field['css']}: {value};")
        if field.get("css_rule"):
            extra_rules.append(field["css_rule"] % f"{value:g}")
    blocks: list[str] = []
    if root_parts:
        blocks.append(":root { " + " ".join(root_parts) + " }")
    blocks.extend(extra_rules)
    return "\n".join(blocks)


def format_field_options() -> list[dict]:
    return [
        {
            "key": field["key"],
            "label": field["label"],
            "type": field["type"],
            **(
                {"min": field["min"], "max": field["max"], "step": field.get("step", 0.1)}
                if field["type"] == "number"
                else {}
            ),
            "description": field.get("description", ""),
        }
        for field in FORMAT_FIELDS
    ]


def page_padding_bounds() -> tuple[float, float]:
    """``page_padding`` 字段的 ``(min, max)``，单位 mm。

    给"兼容字段"做回落时的 clamp 用：``ExportRequest.margin_mm`` 已经不再是独立旋钮，
    但旧客户端仍可能给出 4mm / 40mm（它自己那份历史范围）。收进这里的区间，而不是让
    一个越界值把正文排出页面。**范围只在本模块定义一次**，别处不要再抄一份 8 和 26。
    """
    field = _format_field("page_padding")
    if field is None:  # pragma: no cover - FORMAT_FIELDS 里必然有 page_padding
        raise RuntimeError("格式字段表缺少 page_padding，页边距范围无从取值")
    return float(field["min"]), float(field["max"])


__all__ = [
    "FONT_KEY",
    "FORMAT_FIELDS",
    "FORMAT_FIELD_KEYS",
    "SYSTEM_FONT",
    "_format_field",
    "_validated_font_name",
    "format_css",
    "format_field_options",
    "page_padding_bounds",
    "validated_format_config",
]

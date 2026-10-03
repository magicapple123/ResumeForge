"""格式模板字段、校验与 CSS 覆盖。"""

from __future__ import annotations

import re

from .resume_sections import normalized_section_order

FORMAT_FIELDS: tuple[dict, ...] = (
    {"key": "accent", "label": "强调色", "type": "color", "css": "--accent"},
    {"key": "text_color", "label": "正文颜色", "type": "color", "css": "--text"},
    {"key": "muted_color", "label": "辅助文字颜色", "type": "color", "css": "--muted"},
    {"key": "line_color", "label": "分隔线颜色", "type": "color", "css": "--line"},
    {
        "key": "font_scale_adjust",
        "label": "字号系数",
        "type": "number",
        "min": 0.88,
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


__all__ = [
    "FORMAT_FIELDS",
    "FORMAT_FIELD_KEYS",
    "_format_field",
    "format_css",
    "format_field_options",
    "validated_format_config",
]

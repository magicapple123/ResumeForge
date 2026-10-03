"""安全的可视化简历模板配置。

用户导入的参考简历不应该直接让模型生成可执行 HTML。这里把可调的视觉与版式
收敛成白名单配置，再由渲染器追加 CSS；旧的 style / format 模板仍然保持兼容，
配置为空时行为不变。
"""

from __future__ import annotations

import base64
import binascii
import io
import re
from typing import Any

from PIL import Image, UnidentifiedImageError

from .resume_sections import normalized_section_order
from .resume_template_format import validated_format_config
from ...services.attachments import image_signature_matches

MAX_STYLE_BADGES = 8
MAX_STYLE_CONFIG_CHARS = 4_000_000
MAX_STYLE_IMAGE_BYTES = 300_000
MAX_STYLE_IMAGE_PIXELS = 4_000_000
MAX_BADGE_LABEL_CHARS = 40
MAX_BADGE_ALT_CHARS = 120

_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_DATA_IMAGE_RE = re.compile(
    r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$", re.IGNORECASE
)

STYLE_FIELD_OPTIONS: tuple[dict[str, Any], ...] = (
    {"key": "font_family", "label": "字体风格", "type": "select", "options": [
        {"value": "sans", "label": "无衬线"},
        {"value": "serif", "label": "衬线"},
        {"value": "mono", "label": "等宽"},
    ]},
    {"key": "header_align", "label": "页头对齐", "type": "select", "options": [
        {"value": "left", "label": "左对齐"},
        {"value": "center", "label": "居中"},
        {"value": "right", "label": "右对齐"},
    ]},
    {"key": "header_layout", "label": "页头布局", "type": "select", "options": [
        {"value": "row", "label": "横向"},
        {"value": "stack", "label": "纵向"},
    ]},
    {"key": "column_count", "label": "正文栏数", "type": "number", "min": 1, "max": 2, "step": 1},
    {"key": "column_gap", "label": "分栏间距（mm）", "type": "number", "min": 4, "max": 32, "step": 1},
    {"key": "section_title_style", "label": "区块标题样式", "type": "select", "options": [
        {"value": "left_bar", "label": "左侧色条"},
        {"value": "soft_box", "label": "浅色块"},
        {"value": "underline", "label": "下划线"},
        {"value": "accent_box", "label": "强调色块"},
        {"value": "plain", "label": "纯文字"},
    ]},
    {"key": "section_title_align", "label": "区块标题对齐", "type": "select", "options": [
        {"value": "left", "label": "左对齐"},
        {"value": "center", "label": "居中"},
        {"value": "right", "label": "右对齐"},
    ]},
    {"key": "photo_shape", "label": "照片形状", "type": "select", "options": [
        {"value": "square", "label": "方形"},
        {"value": "rounded", "label": "圆角"},
        {"value": "circle", "label": "圆形"},
    ]},
    {"key": "photo_size", "label": "照片大小系数", "type": "number", "min": 4, "max": 10, "step": 0.1},
    {"key": "skill_style", "label": "技能标签样式", "type": "select", "options": [
        {"value": "pill", "label": "胶囊"},
        {"value": "outline", "label": "描边"},
        {"value": "plain", "label": "纯文字"},
    ]},
    {"key": "background_color", "label": "页面背景色", "type": "color"},
    {"key": "header_background", "label": "页头背景色", "type": "color"},
    {"key": "section_background", "label": "区块背景色", "type": "color"},
)

STYLE_FIELD_KEYS = tuple(field["key"] for field in STYLE_FIELD_OPTIONS)
_SELECT_VALUES = {
    field["key"]: {item["value"] for item in field.get("options", [])}
    for field in STYLE_FIELD_OPTIONS
}
_NUMBER_FIELDS = {
    field["key"]: (float(field["min"]), float(field["max"]))
    for field in STYLE_FIELD_OPTIONS
    if field["type"] == "number"
}


def _valid_color(value: Any) -> str | None:
    text = str(value or "").strip()
    return text.lower() if _HEX_COLOR_RE.fullmatch(text) else None


def _valid_badges(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    result: list[dict[str, str]] = []
    for item in raw[:MAX_STYLE_BADGES]:
        if not isinstance(item, dict):
            continue
        image = str(item.get("image") or "").strip()
        if image:
            match = _DATA_IMAGE_RE.fullmatch(image)
            if match is None:
                continue
            mime = match.group(1).lower()
            try:
                image_bytes = base64.b64decode(match.group(2), validate=True)
            except (binascii.Error, ValueError):
                continue
            if len(image_bytes) > MAX_STYLE_IMAGE_BYTES or not image_signature_matches(mime, image_bytes):
                continue
            try:
                with Image.open(io.BytesIO(image_bytes)) as decoded:
                    width, height = decoded.size
                    if width <= 0 or height <= 0 or width * height > MAX_STYLE_IMAGE_PIXELS:
                        continue
                    decoded.verify()
            except (OSError, SyntaxError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
                continue
        label = str(item.get("label") or "").strip()[:MAX_BADGE_LABEL_CHARS]
        alt = str(item.get("alt") or label or "模板装饰").strip()[:MAX_BADGE_ALT_CHARS]
        if image or label:
            result.append({"image": image, "label": label, "alt": alt})
    return result


def validated_style_config(raw: dict | None) -> dict[str, Any]:
    """归一化视觉配置；未知值会被丢弃，绝不把用户输入直接拼进 CSS。"""
    if not isinstance(raw, dict):
        return {}
    result: dict[str, Any] = validated_format_config(raw)
    for key in (
        "accent",
        "text_color",
        "muted_color",
        "line_color",
        "background_color",
        "header_background",
        "section_background",
    ):
        value = _valid_color(raw.get(key))
        if value:
            result[key] = value
    for key, choices in _SELECT_VALUES.items():
        value = str(raw.get(key) or "").strip()
        if value in choices:
            result[key] = value
    for key, (low, high) in _NUMBER_FIELDS.items():
        try:
            value = float(raw[key])
        except (KeyError, TypeError, ValueError):
            continue
        if low <= value <= high:
            result[key] = int(value) if value.is_integer() and key == "column_count" else round(value, 3)
    if "section_order" in raw and isinstance(raw["section_order"], (list, tuple)) and raw["section_order"]:
        result["section_order"] = normalized_section_order(raw["section_order"])
    badges = _valid_badges(raw.get("badges"))
    if badges:
        result["badges"] = badges
    return result


def style_field_options() -> list[dict[str, Any]]:
    return [dict(field) for field in STYLE_FIELD_OPTIONS]


def style_css(config: dict | None) -> str:
    """把视觉配置翻译成安全 CSS；格式配置稍后追加，因此可以覆盖这些默认值。"""
    values = validated_style_config(config)
    if not values:
        return ""
    rules: list[str] = []
    root: list[str] = []
    for key, css_name in (
        ("accent", "--accent"),
        ("text_color", "--text"),
        ("muted_color", "--muted"),
        ("line_color", "--line"),
        ("background_color", "--bg"),
        ("header_background", "--header-bg"),
        ("section_background", "--section-bg"),
    ):
        if key in values:
            root.append(f"{css_name}: {values[key]};")
    if root:
        rules.append(":root { " + " ".join(root) + " }")
    if values.get("font_family") == "serif":
        rules.append('body { font-family: Georgia, "Noto Serif CJK SC", serif !important; }')
    elif values.get("font_family") == "mono":
        rules.append('body { font-family: Consolas, "Noto Sans Mono CJK SC", monospace !important; }')
    elif values.get("font_family") == "sans":
        rules.append('body { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif !important; }')
    if values.get("header_align") in {"left", "center", "right"}:
        rules.append(f'.header-main {{ text-align: {values["header_align"]} !important; }}')
    if values.get("header_layout") == "stack":
        rules.append('.header { flex-direction: column !important; align-items: stretch !important; }')
        rules.append('.profile-photo { align-self: center; }')
    elif values.get("header_layout") == "row":
        rules.append('.header { flex-direction: row !important; align-items: flex-start !important; }')
    if "column_count" in values:
        if values.get("column_count") == 2:
            gap = values.get("column_gap", 12)
            rules.append(f'.resume-sections {{ display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: {gap:g}mm; align-items: start; }}')
            rules.append('.resume-sections > .section { min-width: 0; }')
        else:
            rules.append('.resume-sections { display: block; }')
    elif "column_gap" in values:
        rules.append(f'.resume-sections {{ column-gap: {values["column_gap"]:g}mm !important; }}')
    if "section_title_align" in values:
        rules.append(f'.section-title {{ text-align: {values["section_title_align"]} !important; }}')
    title_style = values.get("section_title_style")
    if title_style == "left_bar":
        rules.append('.section-title { background: transparent !important; border-left: 4px solid var(--accent) !important; border-bottom: 0 !important; display: block !important; color: var(--accent) !important; }')
    elif title_style == "soft_box":
        rules.append('.section-title { background: var(--accent-soft, #eef2f7) !important; border: 0 !important; display: block !important; color: var(--accent) !important; }')
    elif title_style == "underline":
        rules.append('.section-title { background: transparent !important; border: 0 !important; border-bottom: 1px solid var(--line) !important; display: block !important; color: var(--accent) !important; }')
    elif title_style == "accent_box":
        rules.append('.section-title { background: var(--accent) !important; border: 0 !important; display: inline-block !important; color: #fff !important; }')
    elif title_style == "plain":
        rules.append('.section-title { background: transparent !important; border: 0 !important; display: block !important; color: var(--text) !important; padding-left: 0 !important; }')
    if "photo_shape" in values:
        radius = {"square": "0", "rounded": "4px", "circle": "50%"}[values["photo_shape"]]
        rules.append(f'.profile-photo {{ border-radius: {radius} !important; }}')
    if "photo_size" in values:
        size = values["photo_size"]
        rules.append(f'.profile-photo {{ width: calc(var(--fs) * {size:g}) !important; height: calc(var(--fs) * {size:g}) !important; }}')
    skill_style = values.get("skill_style")
    if skill_style == "pill":
        rules.append('.skill-list li { border-radius: 999px !important; }')
    elif skill_style == "outline":
        rules.append('.skill-list li { background: transparent !important; border: 1px solid var(--accent) !important; color: var(--accent) !important; border-radius: 999px !important; }')
    elif skill_style == "plain":
        rules.append('.skill-list li { background: transparent !important; border: 0 !important; padding-left: 0 !important; padding-right: 0 !important; color: var(--text) !important; }')
    if "header_background" in values:
        rules.append('.header { background: var(--header-bg) !important; }')
    if "section_background" in values:
        rules.append('.section { background: var(--section-bg) !important; padding: calc(var(--fs) * .25) !important; border-radius: 4px; }')
    if values.get("badges"):
        rules.append('.template-badges { display: flex; flex-wrap: wrap; gap: calc(var(--fs) * .35); margin-top: calc(var(--fs) * .45); align-items: center; }')
        rules.append('.template-badge { display: inline-flex; align-items: center; gap: calc(var(--fs) * .2); color: var(--accent); font-size: calc(var(--fs) * .78); }')
        rules.append('.template-badge img { width: calc(var(--fs) * 1.5); height: calc(var(--fs) * 1.5); object-fit: contain; }')
    return "\n".join(rules)


__all__ = [
    "STYLE_FIELD_KEYS",
    "MAX_STYLE_CONFIG_CHARS",
    "MAX_STYLE_IMAGE_BYTES",
    "style_css",
    "style_field_options",
    "validated_style_config",
]

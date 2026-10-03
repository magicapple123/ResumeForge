"""离线模板市场预设与字号档位。"""

from __future__ import annotations

DEFAULT_FONT_SCALE = "standard"

TEMPLATE_MARKET_PRESETS: tuple[dict, ...] = (
    {
        "name": "internet",
        "label": "互联网",
        "category": "互联网",
        "description": "青绿强调色 + 紧凑版式，突出项目与技能，适合研发 / 产品 / 运营投递",
        "template": "modern",
        "format_name": "compact",
        "format_config": {},
        "font_scale": "standard",
        "page_limit": 1,
    },
    {
        "name": "soe",
        "label": "国企",
        "category": "国企",
        "description": "深蓝稳重配色、正文舒展，突出教育背景与荣誉，适合体制内与国企投递",
        "template": "classic",
        "format_name": "spacious",
        "format_config": {},
        "font_scale": "standard",
        "page_limit": 1,
    },
    {
        "name": "foreign",
        "label": "外企",
        "category": "外企",
        "description": "优雅留白 + 单色强调，适合文商科与英文岗位，突出经历与奖项",
        "template": "elegant",
        "format_name": "spacious",
        "format_config": {},
        "font_scale": "standard",
        "page_limit": 1,
    },
    {
        "name": "campus",
        "label": "应届生",
        "category": "应届生",
        "description": "精简紧凑、小字号，一页放下教育、校园经历与实习，适合校招海投",
        "template": "compact",
        "format_name": "compact",
        "format_config": {},
        "font_scale": "small",
        "page_limit": 1,
    },
)


def market_options() -> list[dict]:
    return [dict(item) for item in TEMPLATE_MARKET_PRESETS]


FORMAT_PRESETS: tuple[dict, ...] = (
    {
        "name": "standard",
        "label": "标准",
        "description": "不改动样式模板自身的版式",
        "config": {},
    },
    {
        "name": "compact",
        "label": "紧凑",
        "description": "行高与间距收紧、页边距变小，适合想压进一页",
        "config": {"line_height": 1.45, "page_padding": 11, "section_gap": 0.85},
    },
    {
        "name": "spacious",
        "label": "舒展",
        "description": "行高与留白放大，适合内容不多、想显得从容",
        "config": {"line_height": 2.0, "page_padding": 20, "section_gap": 1.8},
    },
    {
        "name": "mono_accent",
        "label": "单色强调",
        "description": "低调的深灰强调色，适合正式、保守的投递场景",
        "config": {"accent": "#374151", "line_color": "#d1d5db"},
    },
)


FONT_SCALES: dict[str, dict] = {
    "small": {
        "name": "small",
        "label": "小字号",
        "base_px": 11.0,
        "description": "字更小、信息密度更高，适合内容偏多",
    },
    "standard": {
        "name": "standard",
        "label": "标准字号",
        "base_px": 14.0,
        "description": "默认档位，兼顾可读性与篇幅",
    },
    "large": {
        "name": "large",
        "label": "大字号",
        "base_px": 18.0,
        "description": "字更大更醒目，适合内容较少",
    },
}


def font_scale_spec(name: str) -> dict:
    return FONT_SCALES.get((name or "").strip()) or FONT_SCALES[DEFAULT_FONT_SCALE]


def font_scale_options() -> list[dict]:
    return [
        {
            "name": item["name"],
            "label": item["label"],
            "description": item["description"],
            "base_px": item["base_px"],
        }
        for item in FONT_SCALES.values()
    ]


__all__ = [
    "DEFAULT_FONT_SCALE",
    "FONT_SCALES",
    "FORMAT_PRESETS",
    "TEMPLATE_MARKET_PRESETS",
    "font_scale_options",
    "font_scale_spec",
    "market_options",
]

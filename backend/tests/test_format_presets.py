# SPDX-License-Identifier: Apache-2.0
"""版式预设（FORMAT_PRESETS 的字段口径）。

预设是"套在模板上的参数覆盖"，前端拿 `GET /templates` 里的 `format_presets[].config`
直接驱动滑杆。这里钉住两条**用户可见**的性质：

1. 「紧凑 / 舒展」同时收放行高、页边距与字号——只改行高时滑杆会显示预设值，
   但字号停在原处，看起来像"没全生效"；
2. 每个预设的 config 键都在允许的格式化字段里，避免前端拿到不认识的键。
"""

from app.services.resume.resume_template_format import FORMAT_FIELDS
from app.services.resume.resume_template_market import FORMAT_PRESETS

ALLOWED = {field["key"] for field in FORMAT_FIELDS}


def _preset(name: str) -> dict:
    for item in FORMAT_PRESETS:
        if item["name"] == name:
            return item
    raise AssertionError(f"缺少版式预设：{name}")


def test_compact_and_spacious_also_adjust_font_scale():
    compact = _preset("compact")["config"]
    spacious = _preset("spacious")["config"]

    assert compact["line_height"] < 1.7 and compact["page_padding"] < 14
    assert compact["font_scale_adjust"] < 1

    assert spacious["line_height"] > 1.7 and spacious["page_padding"] > 14
    assert spacious["font_scale_adjust"] > 1


def test_preset_keys_are_known_format_fields():
    for preset in FORMAT_PRESETS:
        unknown = set(preset["config"]) - ALLOWED
        assert not unknown, f"{preset['name']} 含未知字段：{unknown}"

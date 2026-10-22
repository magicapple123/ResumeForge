# SPDX-License-Identifier: Apache-2.0
"""兼容入口：重导出简历模板领域各单一职责模块的公开接口。

**对外唯一入口**：`pdf_exporter` / `docx_exporter` / `export_pipeline` / 前端 API 都从这里
取模板与格式参数，不直接 import 各子模块——这样"四向页边距 + 照片系数"这批新键只在一处
出现在导出面上，将来换实现也不必再改一圈调用方。
"""

from .resume_layout_overrides import (
    DEFAULT_PHOTO_SCALE,
    EXTRA_FORMAT_KEYS,
    PAGE_MARGIN_KEYS,
    PAGE_MARGIN_MAX,
    PAGE_MARGIN_MIN,
    PAGE_MARGIN_SIDES,
    PAGE_MARGIN_STEP,
    PAGE_PADDING_KEY,
    PHOTO_SCALE_CSS_VAR,
    PHOTO_SCALE_KEY,
    PHOTO_SCALE_MAX,
    PHOTO_SCALE_MIN,
    PHOTO_SCALE_STEP,
    clamp_page_margin,
    clamp_photo_scale,
    extra_bounds,
    page_padding_rule,
    photo_scale_css_value,
    resolve_page_margins,
    resolve_photo_scale,
)
from .resume_template_catalog import (
    DEFAULT_PAGE_LIMIT,
    DEFAULT_TEMPLATE,
    RESUME_TEMPLATES,
    TEMPLATES_DIR,
    template_options,
    template_options_with_custom,
    template_spec,
)
from .resume_template_format import (
    FORMAT_FIELD_KEYS,
    FORMAT_FIELDS,
    _format_field,
    format_css,
    format_field_options,
    page_padding_bounds,
    validated_format_config,
)
from .resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS, template_layout_defaults
from .resume_template_market import (
    DEFAULT_FONT_SCALE,
    FONT_SCALES,
    FORMAT_PRESETS,
    TEMPLATE_MARKET_PRESETS,
    font_scale_options,
    font_scale_spec,
    market_options,
)

__all__ = [
    "DEFAULT_FONT_SCALE",
    "DEFAULT_PAGE_LIMIT",
    "DEFAULT_PHOTO_SCALE",
    "DEFAULT_TEMPLATE",
    "EXTRA_FORMAT_KEYS",
    "FONT_SCALES",
    "FORMAT_FIELDS",
    "FORMAT_FIELD_KEYS",
    "_format_field",
    "FORMAT_PRESETS",
    "PAGE_MARGIN_KEYS",
    "PAGE_MARGIN_MAX",
    "PAGE_MARGIN_MIN",
    "PAGE_MARGIN_SIDES",
    "PAGE_MARGIN_STEP",
    "PAGE_PADDING_KEY",
    "PHOTO_SCALE_CSS_VAR",
    "PHOTO_SCALE_KEY",
    "PHOTO_SCALE_MAX",
    "PHOTO_SCALE_MIN",
    "PHOTO_SCALE_STEP",
    "RESUME_TEMPLATES",
    "TEMPLATE_MARKET_PRESETS",
    "TEMPLATE_LAYOUT_DEFAULTS",
    "TEMPLATES_DIR",
    "clamp_page_margin",
    "clamp_photo_scale",
    "extra_bounds",
    "font_scale_options",
    "market_options",
    "font_scale_spec",
    "format_css",
    "format_field_options",
    "page_padding_bounds",
    "page_padding_rule",
    "photo_scale_css_value",
    "resolve_page_margins",
    "resolve_photo_scale",
    "template_options",
    "template_options_with_custom",
    "template_spec",
    "template_layout_defaults",
    "validated_format_config",
]

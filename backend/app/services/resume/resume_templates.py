"""兼容入口：重导出简历模板领域各单一职责模块的公开接口。"""

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
    "DEFAULT_TEMPLATE",
    "FONT_SCALES",
    "FORMAT_FIELDS",
    "FORMAT_FIELD_KEYS",
    "_format_field",
    "FORMAT_PRESETS",
    "RESUME_TEMPLATES",
    "TEMPLATE_MARKET_PRESETS",
    "TEMPLATE_LAYOUT_DEFAULTS",
    "TEMPLATES_DIR",
    "font_scale_options",
    "market_options",
    "font_scale_spec",
    "format_css",
    "format_field_options",
    "template_options",
    "template_options_with_custom",
    "template_spec",
    "template_layout_defaults",
    "validated_format_config",
]

"""颜色解析（强调色 / 分隔线：格式模板覆盖 → 模板默认值 → 兜底）。"""
from __future__ import annotations


def _hex_to_rgb(value: str) -> tuple[int, int, int] | None:
    """把格式模板里的十六进制颜色转成 RGB；不合法时返回 None。"""
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
    """从"格式模板覆盖 → 模板默认值 → 兜底"里取一个颜色（强调色 / 分隔线共用）。

    颜色唯一来源是 `resume_templates.template_layout_defaults`（共享知识第 10 条）；
    PDF 与 Word 都从这里取同一份颜色，禁止任何渲染器再存一份 `_TEMPLATE_COLORS`。
    """
    from ..resume.resume_templates import template_layout_defaults, template_spec, validated_format_config

    spec = template_spec(template)
    overrides = validated_format_config(format_config)
    return (
        _hex_to_rgb(str(overrides.get(override_key) or ""))
        or _hex_to_rgb(str(template_layout_defaults(spec["name"])[default_key]))
        or fallback
    )


def resolve_accent(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的强调色：格式模板覆盖优先，其次模板默认，最后兜底深蓝。"""
    return _resolve_template_color(
        template, format_config, override_key="accent", default_key="accent", fallback=(22, 54, 92)
    )


def resolve_line(template: str, format_config: dict | None) -> tuple[int, int, int]:
    """导出用的分隔线颜色（区块标题的下划线等）：覆盖优先，其次模板 `--line`，最后浅灰。"""
    return _resolve_template_color(
        template, format_config, override_key="line_color", default_key="line", fallback=(217, 222, 231)
    )

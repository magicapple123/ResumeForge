"""「自动一页」：生成逐档收紧的候选版式清单（职责④）。

从 ``resume_layout.py`` 拆出：与诊断段仅通过常量与 ``_round`` 耦合。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .resume_layout import (
    _FONT_STEP,
    _LINE_HEIGHT_STEP,
    _PADDING_STEP_MM,
    _SECTION_GAP_STEP,
    MIN_FONT_PX,
    MIN_LINE_HEIGHT,
    MIN_PADDING_MM,
    MIN_SECTION_GAP,
    _round,
)
from .resume_templates import font_scale_spec, format_css, template_layout_defaults

# ===== 自动一页 =====


def _effective_layout(template: str, format_config: dict | None) -> dict[str, float]:
    """把"模板默认值 + 用户已设的覆盖"合成一组当前生效的版式值。

    自动一页只会**在用户当前的基础上往紧收**，所以必须先知道当前是多少。
    """
    defaults = template_layout_defaults(template)
    config = format_config or {}
    padding = config.get("page_padding")
    line_height = config.get("line_height")
    section_gap = config.get("section_gap")
    font_adjust = config.get("font_scale_adjust")
    return {
        "page_padding": float(padding) if padding else float(defaults["padding_mm"]),
        "line_height": float(line_height) if line_height else float(defaults["line_height"]),
        "section_gap": float(section_gap) if section_gap else float(defaults["section_gap"]),
        # 没设过系数就等于 1（渲染时 base_px 不做任何缩放）。
        "font_scale_adjust": float(font_adjust) if font_adjust else 1.0,
    }


def font_adjust_floor(font_scale: str) -> float:
    """字号系数能小到多少：不低于 ``MIN_FONT_PX``，且不越过格式字段自身的下限。

    两种下限取更严的那个——档位大时是"12px"这条在管，档位小时是格式字段的 0.88 在管
    （小字号档 12px 已经等于下限，此时系数只能是 1）。
    """
    from .resume_templates import _format_field

    spec = font_scale_spec(font_scale)
    base_px = float(spec["base_px"])
    field = _format_field("font_scale_adjust") or {}
    field_min = float(field.get("min", 0.88))
    by_pixels = MIN_FONT_PX / base_px if base_px > 0 else 1.0
    return _round(max(field_min, min(1.0, by_pixels)), 3)


def _next_target(current: float, floor: float, step: float) -> float | None:
    """往紧收一档；已经到下限（或比下限还紧）就返回 None 表示这个旋钮没得收了。"""
    if current <= floor + 1e-9:
        return None
    return _round(max(floor, current - step), 3)


@dataclass
class FitCandidate:
    """一档候选版式：把它交给浏览器量一次，够放下就用它。"""

    key: str
    label: str
    # 这一档相对**原始**配置的完整覆盖（不是增量），直接存进简历的 format_config。
    config: dict[str, Any]
    # 量这一档时要注入预览的 CSS。**只用于测量**，不是最终渲染用的样式。
    css: str


def _font_scale_probe_css(font_scale: str, adjust: float) -> str:
    """把字号系数翻译成一段**只给预览探针用**的 CSS。

    字号系数在真正渲染时是由后端预先乘进 ``base_px`` 再交给模板的（见
    ``services/exporter.py``）——那是唯一对内置模板与用户自制模板都生效的路径，
    所以它**刻意没有** CSS 变量映射（有的话两者会叠乘）。

    但"自动一页"要在浏览器里逐档试，就必须让当前这一档真的作用到预览上。所以这里
    用**绝对像素**写一段等价样式覆盖 `--fs`：模板里所有尺寸都是
    `calc(var(--fs) * N)` 算出来的，改这一个变量就等于整份简历按这一档缩放。
    用绝对像素而不是再套一层变量，是因为探针注入的是最终样式，不该依赖任何尚未
    存在的变量。
    """
    base_px = float(font_scale_spec(font_scale)["base_px"])
    return f":root {{ --fs: {round(base_px * adjust, 2)}px; }}"


def build_fit_ladder(
    template: str, font_scale: str, format_config: dict | None
) -> list[FitCandidate]:
    """生成"自动一页"要依次尝试的版式清单。

    顺序是**页边距 → 区块间距 → 行高 → 字号**：越靠前的旋钮对可读性的影响越小。
    每一档都是相对原配置的**完整覆盖**，所以客户端试出哪一档就原样保存哪一档，
    不需要自己算增量。
    """
    current = _effective_layout(template, format_config)
    floor_adjust = font_adjust_floor(font_scale)
    # 保留用户已经调好的其它项（强调色、正文色等）——自动一页只该动版式，不该顺手
    # 把人选的颜色丢掉。四个版式旋钮先摘掉，下面由阶梯逐档重新写入。
    base = {
        key: value
        for key, value in (format_config or {}).items()
        if key not in {"page_padding", "line_height", "section_gap", "font_scale_adjust"}
    }

    ladder: list[FitCandidate] = []
    accumulated: dict[str, Any] = dict(base)

    def add(key: str, label: str, patch: dict[str, Any], probe_extra: str = "") -> None:
        accumulated.update(patch)
        config = dict(accumulated)
        css = format_css(config) + ("\n" + probe_extra if probe_extra else "")
        ladder.append(FitCandidate(key=key, label=label, config=config, css=css))

    padding = current["page_padding"]
    while True:
        target = _next_target(padding, MIN_PADDING_MM, _PADDING_STEP_MM)
        if target is None:
            break
        add("padding", f"页边距收到 {target:g}mm", {"page_padding": target})
        padding = target

    gap = current["section_gap"]
    while True:
        target = _next_target(gap, MIN_SECTION_GAP, _SECTION_GAP_STEP)
        if target is None:
            break
        add("section_gap", f"区块间距收到 {target:g}", {"section_gap": target})
        gap = target

    line_height = current["line_height"]
    while True:
        target = _next_target(line_height, MIN_LINE_HEIGHT, _LINE_HEIGHT_STEP)
        if target is None:
            break
        add("line_height", f"行高收到 {target:g}", {"line_height": target})
        line_height = target

    adjust = current["font_scale_adjust"]
    while True:
        target = _next_target(adjust, floor_adjust, _FONT_STEP)
        if target is None:
            break
        add(
            "font_scale_adjust",
            f"字号收到 {target:g} 倍",
            {"font_scale_adjust": target},
            # 字号在渲染时是预乘进 base_px 的，没有 CSS 变量可覆盖，所以探针要自己补一段。
            _font_scale_probe_css(font_scale, target),
        )
        adjust = target

    return ladder


def fit_room_report(template: str, font_scale: str, format_config: dict | None) -> dict[str, Any]:
    """还有没有可收紧的余地，以及下限说明。给界面用来决定要不要显示「自动一页」。"""
    ladder = build_fit_ladder(template, font_scale, format_config)
    adjust_floor = font_adjust_floor(font_scale)
    return {
        "has_room": bool(ladder),
        "steps": len(ladder),
        # 界面上要如实告诉用户字号最多缩到多少——不写清就等于让他按了才知道。
        "font_floor_px": MIN_FONT_PX,
        "font_adjust_floor": adjust_floor,
        "font_floor_note": (
            f"正文字号最多缩到 {MIN_FONT_PX:g}px（≈9pt），再小打印出来会吃力。"
            if adjust_floor < 1.0
            else "当前字号档位已经接近可读下限，自动一页不会再缩小字号。"
        ),
    }


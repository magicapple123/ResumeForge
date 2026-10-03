"""技能标签几何（形状比例 / 尺寸计算 / 调色 / 折行）。"""
from __future__ import annotations

from dataclasses import dataclass

from .layout import _PX_TO_MM, _PX_TO_PT

# 技能标签的**形状**比例（左右内边距 0.71×标签字号、标签间距 0.57×标签字号、圆角 0.4×）。
# 标签**字号**比例已随其它层级一起纳入 `resume_templates.TEMPLATE_LAYOUT_DEFAULTS`
# （`tag_font_ratio`，由 `ResumeLayout` 带进来），这里的三个是 PDF 统一采用的一种标签形状
# ——各模板的标签形状其实不同（modern 是胶囊、technical 是左侧色条、compact/minimal 刻意
# 无框），PDF 目前统一画成"带底色的圆角框"，与预览的形状差异属于**既有**、独立的遗留，
# 不在本次"字号层级结构化"的范围内。
_TAG_PADDING_RATIO = 0.71
_TAG_GAP_RATIO = 0.57
_TAG_RADIUS_RATIO = 0.4
# 标签底色 = 强调色调淡到接近白（模板里的 `--accent-soft` 就是这个思路，例如 #0f766e → #e6f4f1）。
_TAG_TINT_RATIO = 0.88


@dataclass(frozen=True)
class SkillTagMetrics:
    """技能标签的几何尺寸（毫米 / 磅）。"""

    font_pt: float
    height: float
    padding_x: float
    gap_x: float
    gap_y: float
    radius: float


def skill_tag_metrics(
    font_size: float, *, line_height: float, tag_ratio: float
) -> SkillTagMetrics:
    """由基准字号推出标签的整套尺寸（纯函数，便于逐条验证比例）。

    ``tag_ratio`` 是模板里 `.skill-list li` 的字号倍数（来自
    `TEMPLATE_LAYOUT_DEFAULTS` 的 `tag_font_ratio`）——**必须由调用方传入**，本模块不再
    保留一份只对 classic 成立的副本。``line_height`` 是模板的行高系数：标签高度 =
    标签字号的 ``line_height`` 倍，与预览里 `.skill-list li` 继承 body 行高同理。两者都
    来自 `ResumeLayout`。
    """
    tag_px = font_size * tag_ratio
    return SkillTagMetrics(
        font_pt=tag_px * _PX_TO_PT,
        height=tag_px * _PX_TO_MM * line_height,
        padding_x=tag_px * _PX_TO_MM * _TAG_PADDING_RATIO,
        gap_x=tag_px * _PX_TO_MM * _TAG_GAP_RATIO,
        gap_y=tag_px * _PX_TO_MM * _TAG_GAP_RATIO,
        radius=tag_px * _PX_TO_MM * _TAG_RADIUS_RATIO,
    )


def soft_accent(color: tuple[int, int, int], ratio: float = _TAG_TINT_RATIO) -> tuple[int, int, int]:
    """把强调色调成标签底色。"""
    return tuple(round(channel + (255 - channel) * ratio) for channel in color)  # type: ignore[return-value]


def wrap_skill_tags(widths: list[float], *, max_width: float, gap: float) -> list[list[int]]:
    """把标签按可用宽度折行，返回**每行的下标**。

    抽成纯函数是因为折行算错**不会报错**：只会让最后一个标签悄悄跑到页面右边之外，或者把
    整行孤零零地挤到下一页——两种都很难在肉眼下发现，却能离线逐条测出来。

    单个标签本身宽于 ``max_width`` 时单独占一行（正文不可断行，只能让它略微超出），
    调用方应据此收紧标签文案，而不是在这里硬切。
    """
    rows: list[list[int]] = []
    current: list[int] = []
    used = 0.0
    for index, width in enumerate(widths):
        if not current:
            current = [index]
            used = width
            continue
        if used + gap + width <= max_width:
            current.append(index)
            used += gap + width
        else:
            rows.append(current)
            current = [index]
            used = width
    if current:
        rows.append(current)
    return rows

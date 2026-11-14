# SPDX-License-Identifier: Apache-2.0
"""``_ResumePDF`` 的高层绘制入口（从 ``canvas.py`` 纯搬迁，W07 起是薄委托）。

为什么独立成模块：``canvas.py`` 贴着 500 行预算。这些方法只把调用转发给
``style_blocks`` / ``meta_lines`` / ``meta_columns`` / ``skill_tags`` 的绘制函数，
不持有画布状态，因此整体搬进 mixin、由 ``_ResumePDF`` 继承——对外方法名与签名
逐字不变，``isinstance`` / 既有调用方与 ``monkeypatch.setattr(_ResumePDF, ...)``
落点也不变。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, cast

from .meta_columns import draw_meta_columns
from .meta_lines import draw_meta_line
from .skill_tags import draw_skill_tags
from .style_blocks import draw_bullets, draw_entry_head, draw_section_title

if TYPE_CHECKING:
    # 宿主类 _ResumePDF 提供画布状态；本 mixin 只做转发，运行期不 import（否则成环）。
    from .canvas import _ResumePDF


class _CanvasDrawersMixin:
    def section_title(
        self,
        text: str,
        base: float,
        *,
        leading_gap: float,
        style=None,
        section: str = "",
        keep_lines: int = 0,
    ) -> None:
        """区块标题：绘制在 style_blocks（W07 起消费角色/对象覆盖），本方法保留原签名。"""
        pdf = cast("_ResumePDF", self)
        draw_section_title(
            pdf,
            text,
            base,
            leading_gap=leading_gap,
            style=style,
            section=section,
            keep_lines=keep_lines,
        )

    def bullets(
        self,
        items: list[str],
        base: float,
        *,
        style=None,
        section: str = "",
        object_id=None,
        split_ok: bool = False,
    ) -> None:
        """列表项：绘制在 style_blocks（缩进/符号/行高/对齐可被覆盖），分页口径不变。"""
        pdf = cast("_ResumePDF", self)
        draw_bullets(
            pdf, items, base, style=style, section=section, object_id=object_id, split_ok=split_ok
        )

    def entry_head(
        self,
        left: str,
        right: str,
        base: float,
        *,
        style=None,
        meta_style=None,
        section: str = "",
        object_id=None,
        keep_lines: int = 0,
    ) -> None:
        """条目头：绘制在 style_blocks（字号/颜色/粗体/对齐/段前距可被覆盖）。"""
        pdf = cast("_ResumePDF", self)
        draw_entry_head(
            pdf,
            left,
            right,
            base,
            style=style,
            meta_style=meta_style,
            section=section,
            object_id=object_id,
            keep_lines=keep_lines,
        )

    def meta_line(
        self, text: str, base: float, *, style=None, first: bool = True, last: bool = True
    ) -> None:
        """条目副行：绘制在 meta_lines。``first`` / ``last`` = 灰字段组的首/末条（问题 17），
        组级段距只在首尾出现；默认都为 True = 旧行为（一条一组时逐像素不变）。
        """
        draw_meta_line(cast("_ResumePDF", self), text, base, style=style, first=first, last=last)

    def meta_columns(
        self,
        cells,
        widths: Sequence[float],
        gap: float,
        base: float,
        *,
        style=None,
        first: bool = True,
        last: bool = True,
    ) -> None:
        """W4 条目字段多列：一行按**预算好的列宽**并排绘制（几何与 meta_line 同口径）。

        ``widths`` 是 ``meta_columns.column_widths`` 按该 entry 每列最宽内容算出的结果（mm），
        同一个 entry 的所有行共用一份，跨行列起点才对得齐。``first`` / ``last`` 的语义
        与 ``meta_line`` 相同（问题 17：一行多个 cell 属于**同一行**，组语义落在行上）。
        """
        draw_meta_columns(
            cast("_ResumePDF", self), cells, widths, gap, base, style=style, first=first, last=last
        )

    def skill_tags(self, labels: list[str], base: float, *, style=None) -> None:
        """把专业技能画成**模板真实的标签形状**，与 HTML 预览一致。

        以前这里是用「、」连起来的**一行纯文本**（用户实测反馈："预览里是蓝色小框，导出 PDF
        后没有了"）；后来补成标签，但把 8 个模板统一画成"带底色的圆角框 + 强调色文字"——预览
        里 classic 是硬编码浅灰底、modern 是描边胶囊、technical 是左侧色条、compact 用「·」
        分隔、minimal 是纯文字，导出的 PDF 全长得一样。现在形状由 `layout.tag_style` 驱动，
        五种形态各画各的。

        绘制主体在 `skill_tags.draw_skill_tags`：标签几何本属那个模块，而本类已经贴着 500 行
        预算（见 `tests/test_file_size_budget.py`）。
        """
        pdf = cast("_ResumePDF", self)
        draw_skill_tags(
            pdf,
            labels,
            base,
            layout=pdf.layout,
            accent=pdf.accent,
            line_color=pdf.line_color,
            body_text=pdf.body_text,
            muted_text=pdf.muted_text,
            style=style,
        )


__all__ = ["_CanvasDrawersMixin"]

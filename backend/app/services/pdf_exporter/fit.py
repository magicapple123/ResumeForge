"""一页适配与入口（测量 / 真实页数 / 决策 / ``build_resume_pdf``）。"""
from __future__ import annotations

import logging

from ...schemas.resume import MAX_RESUME_PAGES, ResumeContent
from .canvas import _ResumePDF
from .fonts import FONT_ENV_VAR, ResumePDFError, _resolve_font_paths
from .layout import (
    MIN_FIT_SCALE,
    _FIT_MAX_PASSES,
    _FIT_MIN_STEP,
    _FIT_PAGE_STEP,
    _FIT_RATIO_MARGIN,
    _FIT_TOLERANCE_MM,
    ResumeLayout,
    resolve_layout,
)
from .render import ResumePDF, _draw_resume, _register_fonts
from .theme import resolve_accent, resolve_line

logger = logging.getLogger(__name__)


def measure_content_height(
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    regular: str | None = None,
    bold: str | None = None,
    include_photo: bool = True,
    line: tuple[int, int, int] | None = None,
    format_config: dict | None = None,
) -> float:
    """量出这份简历在给定版式下的内容高度（mm）。

    **只测量、不决策**：把自动分页关掉，让内容连续排下来，末尾的 y 减去上页边距就是
    真实内容高度。这样"该不该缩、缩到多少"（`decide_fit_scale`）与"内容有多高"各自
    独立，后续要做"并排多页"时只换决策那一步即可。

    ``line`` 是分隔线颜色（区块标题下划线用），只影响配色、不影响高度；不传则用兜底浅灰。
    """
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
    pdf = _ResumePDF(accent, layout, line=line or (217, 222, 231), measuring=True)
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    _draw_resume(pdf, resume, include_photo=include_photo, format_config=format_config)
    return pdf.get_y() - layout.margin_top


def rendered_page_count(
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    regular: str | None = None,
    bold: str | None = None,
    include_photo: bool = True,
    line: tuple[int, int, int] | None = None,
    format_config: dict | None = None,
) -> int:
    """真实渲染这份简历，返回它实际排出来的页数。

    **这是"装不装得下"的唯一权威判据**：``measure_content_height`` 量的是**连续内容高度**，
    而真实分页会因 `ensure_space`（不切断条目）提前换页、留下一段空隙——于是"连续高 < 可用高"
    仍可能排出第二页。按连续高判定会**说谎**（报告 1 页、实际 2 页、``overflow=False``）。
    这里让内容按真实分页排一遍，直接数页数。
    """
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
    pdf = _ResumePDF(accent, layout, line=line or (217, 222, 231))
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    _draw_resume(pdf, resume, include_photo=include_photo, format_config=format_config)
    return pdf.pages_count


def decide_fit_scale(
    measure_pages, measure_height, *, page_limit: int, usable_height: float
) -> tuple[float, bool]:
    """决定一页适配的缩放：返回 ``(scale, overflow)``。

    **判定"装得下"以真实页数为准**（``measure_pages(scale) <= page_limit``），而不是连续
    内容高度——这正是"请求 1 页、产出 2 页，而 overflow 还在说装得下"那个 bug 的修法。

    收敛策略（尽量贴近预览脚本 `_resume_fit_script.j2`）：
      1. 从 1.0 起，只在真实页数超限时才继续缩（绝不来回震荡、也绝不放大）；
      2. 连续高明显超出可用高时，按 `可用高 / 内容高 × 0.995` 比例跳一档（快）；
      3. 连续高已"达标"（在容差内）却仍多页时，比例档跳不动（比值 ≥ 1），退化为
         **每轮至少收 `_FIT_PAGE_STEP`** 的离散档——专门处理"连续高 ≠ 实际分页高"的边界；
      4. 下限 `MIN_FIT_SCALE`；最多 `_FIT_MAX_PASSES` 轮；
      5. 到下限仍多页 → ``overflow=True``，如实标出，交给调用方提示用户加页/换字号，
         而不是把文字裁掉（与预览"塞不下就溢出并提示"一致）。

    ``measure_pages`` / ``measure_height`` 分别是 ``scale -> 页数`` 与 ``scale -> 连续高(mm)``
    的可调用对象。高度只在页数超限时才需要——常见情形（本来就放得下）只渲染一次即可放行。
    """
    scale = 1.0
    pages = measure_pages(scale)
    for _ in range(_FIT_MAX_PASSES):
        if pages <= page_limit:
            return scale, False
        height = measure_height(scale)
        # 连续高明显超出 → 按比例一次跳够；连续高已达标（比例档失效）→ 用离散下限兜底。
        ratio = usable_height / height * _FIT_RATIO_MARGIN if height > usable_height + _FIT_TOLERANCE_MM else 1.0
        next_scale = max(MIN_FIT_SCALE, scale * min(ratio, 1 - _FIT_PAGE_STEP))
        if next_scale >= scale - _FIT_MIN_STEP:
            break
        scale = next_scale
        pages = measure_pages(scale)
    return scale, pages > page_limit


def build_resume_pdf(
    resume: ResumeContent,
    *,
    template: str = "classic",
    page_limit: int = 1,
    font_scale: str = "standard",
    format_config: dict | None = None,
    margin_mm: float | None = None,
    include_photo: bool = True,
) -> ResumePDF:
    """把结构化简历渲染成 PDF。

    版式（行距/页边距/区块间距**与各层级字号比例**）与预览对齐：默认取所选**样式模板**的
    版式值，用户在「格式模板」里设过的 `line_height` / `page_padding` / `section_gap` 会
    覆盖它们；``margin_mm`` 是导出时的页边距直接覆盖；内容超过所选页数时按与预览同口径缩
    **字号派生尺寸**来装下，是否"装得下"以**真实渲染的页数**为准（见 `decide_fit_scale`），
    实在装不下就如实标记 ``overflow``。
    """
    from ..resume.resume_templates import FONT_SCALES, template_spec

    fonts = _resolve_font_paths()
    if fonts is None:
        raise ResumePDFError(
            "未找到可用的中文字体，无法在服务端生成 PDF；请用「打印 / 另存为 PDF」导出，"
            f"或设置环境变量 {FONT_ENV_VAR} 指向一个中文 TTF/TTC 字体文件"
        )
    regular, bold = fonts
    spec = template_spec(template)
    scale = FONT_SCALES.get(font_scale) or FONT_SCALES["standard"]
    base = float(scale["base_px"])

    from ..resume.resume_templates import validated_format_config

    overrides = validated_format_config(format_config)
    accent_adjust = overrides.get("font_scale_adjust")
    if isinstance(accent_adjust, (int, float)):
        base = round(base * float(accent_adjust), 2)
    accent = resolve_accent(spec["name"], overrides)
    line = resolve_line(spec["name"], overrides)

    layout = resolve_layout(
        template=spec["name"], base_px=base, format_config=overrides, margin_mm=margin_mm
    )
    limit = max(1, min(int(page_limit), MAX_RESUME_PAGES))

    # 一页适配：先测**真实页数**→ 再决（缩到多少）→ 最后照决策渲染一遍。
    usable = layout.usable_height_per_page * limit

    def pages_at(value: float) -> int:
        return rendered_page_count(
            resume,
            accent=accent,
            layout=layout.with_fit_scale(value),
            regular=regular,
            bold=bold,
            include_photo=include_photo,
            line=line,
            format_config=overrides,
        )

    def height_at(value: float) -> float:
        return measure_content_height(
            resume,
            accent=accent,
            layout=layout.with_fit_scale(value),
            regular=regular,
            bold=bold,
            include_photo=include_photo,
            line=line,
            format_config=overrides,
        )

    fit_scale, overflow = decide_fit_scale(
        pages_at, height_at, page_limit=limit, usable_height=usable
    )
    final_layout = layout.with_fit_scale(fit_scale)

    pdf = _ResumePDF(accent, final_layout, line=line)
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    _draw_resume(pdf, resume, include_photo=include_photo, format_config=overrides)

    pages = pdf.pages_count
    # 硬要求：**标志不许说谎**——最终真的多出页就必须标 overflow。决策层已按页数判定，
    # 这里再兜一次，防止将来改动让"页数"与"标志"再次脱节（用户会以为一切正常）。
    if pages > limit:
        overflow = True
    if overflow:
        # 到下限仍塞不下：不裁内容，但必须让用户知道（日志只有开发者能看到，界面读 headers）。
        logger.info(
            "PDF 内容缩到下限 %.2f 仍超出所选页数上限 %s，实际 %s 页",
            fit_scale,
            limit,
            pages,
        )
    return ResumePDF(content=bytes(pdf.output()), pages=pages, scale=fit_scale, overflow=overflow)

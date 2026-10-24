# SPDX-License-Identifier: Apache-2.0
"""分页报告（W08 §3.6）：复用真实 PDF 渲染的绘制日志，回答"第几页之后被截断了、截断的是谁"。

**为什么不重写一遍排版**：截断定位必须与导出的 PDF 同源。本模块调用
``pdf_exporter.build_resume_pdf``（W08 起它会返回 ``spans`` 绘制日志），再按
``page_limit`` 过滤——渲染与定位是同一趟，不存在"报告的页数和下载的不一样"。
"""

from __future__ import annotations

from typing import Any

from ..pdf_exporter import build_resume_pdf
from .resume_labels import DEFAULT_RESUME_LANGUAGE
from .resume_pagination import resolve_pagination

# 续页重复姓名需要上边距放得下：小于它就不画（契约 §3.4 的终止规则）。
REPEAT_NAME_MIN_MARGIN = 8.0


def _truncated_at(spans: tuple, page_limit: int) -> dict | None:
    """第一条落在**页数上限之后**的内容（绘制顺序即阅读顺序）。"""
    for span in spans:
        if span.page <= page_limit:
            continue
        kind = "point" if span.kind == "point" else ("entry" if span.kind == "entry" else "section")
        return {
            "kind": kind,
            "section": span.section,
            "object_id": span.object_id,
            "point_index": span.point_index,
            "text_preview": span.text,
        }
    return None


def _manual_breaks(plan, spans: tuple) -> list[dict]:
    """用户显式设了"从新页开始"的对象/板块，以及它在产物里实际落到第几页。"""
    breaks: list[dict] = []
    entry_pages = {
        span.object_id: span.page
        for span in spans
        if span.kind == "entry" and span.object_id and span.page > 1
    }
    for object_id in sorted(plan.entries):
        if plan.entry(object_id).break_before_page and object_id in entry_pages:
            breaks.append({"kind": "entry", "object_id": object_id, "page": entry_pages[object_id]})
    section_pages = {
        span.section: span.page for span in spans if span.kind == "section" and span.page > 1
    }
    for key in sorted(plan.sections):
        if plan.section(key).break_before_page and key in section_pages:
            breaks.append({"kind": "section", "section": key, "page": section_pages[key]})
    return breaks


def _warnings(plan, layout) -> list[dict]:
    warnings: list[dict] = []
    if plan.repeat_name and layout.margin_top < REPEAT_NAME_MIN_MARGIN:
        warnings.append(
            {
                "code": "repeat_name_no_room",
                "detail": (
                    f"上边距 {layout.margin_top:g}mm 小于 {REPEAT_NAME_MIN_MARGIN:g}mm，"
                    "续页姓名未绘制（避免压住正文）"
                ),
            }
        )
    return warnings


def build_pagination_report(
    resume,
    *,
    template: str,
    format_config: dict | None,
    page_limit: int,
    font_scale: str = "standard",
    include_photo: bool = True,
    language: str = DEFAULT_RESUME_LANGUAGE,
    snapshot: dict[str, str] | None = None,
) -> dict[str, Any]:
    """渲染一次 PDF 并汇总页数/截断位置/手动分页/警告（纯读，不落库、不冻结交付）。"""
    from .resume_layout import PageMeasure  # noqa: F401  (仅为类型/语义对照，运行期不依赖)

    pdf = build_resume_pdf(
        resume,
        template=template,
        page_limit=page_limit,
        font_scale=font_scale,
        format_config=format_config,
        include_photo=include_photo,
        language=language,
    )
    plan = resolve_pagination(format_config)
    from ..pdf_exporter import resolve_layout

    layout = resolve_layout(
        template=template,
        base_px=12.0 + 0.0,  # 仅用于读模板边距；真实排版由 build_resume_pdf 内部解析
        format_config=format_config,
    )
    return {
        "pages": pdf.pages,
        "pages_needed": pdf.pages_needed if pdf.pages_needed is not None else pdf.pages,
        "overflow": pdf.overflow,
        "page_limit": page_limit,
        "truncated_at": _truncated_at(pdf.spans, page_limit),
        "manual_breaks": _manual_breaks(plan, pdf.spans),
        "warnings": _warnings(plan, layout),
        "snapshot": snapshot or {},
    }


__all__ = ["REPEAT_NAME_MIN_MARGIN", "build_pagination_report"]

# SPDX-License-Identifier: Apache-2.0
"""分页报告（W08 §3.6）：复用真实 PDF 渲染的绘制日志，回答"第几页之后被截断了、截断的是谁"。

**为什么不重写一遍排版**：截断定位必须与导出的 PDF 同源。本模块调用
``pdf_exporter.build_resume_pdf``（W08 起它会返回 ``spans`` 绘制日志），再按
``page_limit`` 过滤——渲染与定位是同一趟，不存在"报告的页数和下载的不一样"。
"""

from __future__ import annotations

from typing import Any

from ..pdf_exporter import build_resume_pdf
from .document_html import coerce_document
from .document_plan import build_document_plan
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


def _document_manual_breaks(plan, spans: tuple) -> list[dict]:
    """v2 文档布局显式设置的分区/条目断页（HTML/PDF/Word 同源 planner）。"""
    entry_pages = {
        span.object_id: span.page
        for span in spans
        if span.kind == "entry" and span.object_id and span.page > 1
    }
    section_pages = {
        span.section: span.page for span in spans if span.kind == "section" and span.page > 1
    }
    breaks = [
        {"kind": "entry", "object_id": entry.id, "page": entry_pages[entry.id]}
        for section in plan.sections
        for entry in section.entries
        if entry.layout.start_on_new_page and entry.id in entry_pages
    ]
    breaks.extend(
        {"kind": "section", "section": section.key, "page": section_pages[section.key]}
        for section in plan.sections
        if section.layout.start_on_new_page and section.key in section_pages
    )
    return breaks


def _last_page_fill(pdf, layout) -> float | None:
    """#2：末页内容占用比例（0-1）= 末页内容底部 / 可用内容高度。

    末页没有绘制内容（空简历）或版心不可用时返回 None——「未测量」胜过伪造 0。
    顶格/超版心都夹到 [0, 1]：这是给用户看的占用参考，不是渲染断言。
    """
    bottoms = [span.y_bottom for span in pdf.spans if span.page == pdf.pages]
    if not bottoms:
        return None
    usable = layout.usable_height_per_page
    if usable <= 0:
        return None
    fill = (max(bottoms) - layout.margin_top) / usable
    return round(min(1.0, max(0.0, fill)), 3)


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
    page_limit_is_unlimited: bool = False,
    font_scale: str = "standard",
    include_photo: bool = True,
    language: str = DEFAULT_RESUME_LANGUAGE,
    snapshot: dict[str, str] | None = None,
) -> dict[str, Any]:
    """渲染一次 PDF 并汇总页数/截断位置/手动分页/警告（纯读，不落库、不冻结交付）。

    ``page_limit`` 是**渲染保护上限**（``pdf_exporter.fit`` 要一个正数 max_pages），
    用户选「不限篇幅」时它等于 ``UNLIMITED_RENDER_MAX_PAGES``（10）。数字字段因此不能说
    "用户要 10 页"，那一层语义由 ``page_limit_is_unlimited`` 单独带出：前端按这个布尔
    决定说「实际 N 页」还是「实际 N 页（上限 M 页）」。**不要**把 ``page_limit`` 改写成
    0 ——页标记按它过滤截断点，0 会让整份报告失去页码基准。
    """
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
    document_model = coerce_document(resume, language=language, format_config=format_config)
    document_plan = build_document_plan(document_model, format_config, language)
    legacy_plan = resolve_pagination(format_config)
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
        # #2：末页占用（0-1）。页数正好用满上限时，前端把「实际 N 页（上限 N 页）」
        # 换成「已达上限」——占用数字比重复页数更有信息量。
        "last_page_fill": _last_page_fill(pdf, layout),
        "page_limit": page_limit,
        # 「用户选的是不限」与"上限正好 10 页"是两种语义，数字字段分不开，所以单独带一位。
        # 报告里 ``truncated_at`` 也不会因为保护上限而误报：不限时不裁剪。
        "page_limit_is_unlimited": bool(page_limit_is_unlimited),
        "truncated_at": _truncated_at(pdf.spans, page_limit),
        "manual_breaks": _merge_manual_breaks(
            _manual_breaks(legacy_plan, pdf.spans),
            _document_manual_breaks(document_plan, pdf.spans),
        ),
        "warnings": _warnings(legacy_plan, layout),
        "snapshot": snapshot or {},
    }


def _merge_manual_breaks(*groups: list[dict]) -> list[dict]:
    """兼容旧 format_config 分页标记，同时保留 v2 文档的显式断页。"""
    merged: list[dict] = []
    seen: set[tuple[object, object, object]] = set()
    for item in (entry for group in groups for entry in group):
        key = (item.get("kind"), item.get("section") or item.get("object_id"), item.get("page"))
        if key not in seen:
            seen.add(key)
            merged.append(item)
    return merged


__all__ = ["REPEAT_NAME_MIN_MARGIN", "build_pagination_report"]

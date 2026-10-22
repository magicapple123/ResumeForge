# SPDX-License-Identifier: Apache-2.0
"""Word（.docx）简历导出：用 ``python-docx`` 生成，版式复用 ``pdf_exporter.ResumeLayout``。

**为什么不另写一套排版**：直出 PDF 与预览不一致的教训已经反复出现——任何渲染器只要
自己再存一份"行距 / 页边距 / 字号层级 / 强调色"，模板一改就会悄悄漂移。所以 Word 的
页边距、字号层级、行距、区块间距与强调色**全部**从 ``ResumeLayout`` 与
``resume_templates`` 读（与 PDF 同一来源），本模块只负责把结构化简历按这套版式写进
``Document``。

分页（Word 没有 fpdf 那种可回读的页数）用与 PDF **同一套连续流模型**估算：
连续内容高 ÷ 每页可用高。这个估算是"连续流"模型，与 Word 的自动分页一致，因此与
PDF 的真实页数差在 ±1 内（容差断言见 ``test_docx_exporter.py``）。**不缩字号**
（2026-10-21 用户要求）：按版式参数原样写入，估算页数超过 ``page_limit`` 时标记
``overflow``，由界面提示用户——Word 自己会顺延出更多页，文档里不会丢内容。
没有可用的中文字体时**仍能生成**（python-docx 只写字体名，渲染由 Word 完成），但无法做
页数估算，此时 ``pages=None``。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

from ..schemas.resume import MAX_RESUME_PAGES, ResumeContent
from .pdf_exporter import (
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_HEIGHT_MM,
    PAGE_WIDTH_MM,
    _photo_bytes,
    _resolve_font_paths,
    crop_image_to_cover,
    measure_content_height,
    resolve_accent,
    resolve_layout,
)
from .resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    field_labels,
    level_text,
    list_separator,
    section_titles,
)
from .resume.resume_sections import resolved_section_order

# Word 里写的是字体名，最终由用户机器上的 Word 解析；用微软雅黑与 PDF 首选字体一致。
DOCX_FONT = "微软雅黑"

# 正文 / 辅助文字颜色与 PDF 的 `set_text_color` 保持一致（强调色另从模板解析）。
_BODY_COLOR = (31, 41, 55)
_MUTED_COLOR = (107, 114, 128)


@dataclass(frozen=True)
class ResumeDOCX:
    """生成好的 Word 文档，连同估算页数与"装不装得下"的结论（语义与 ``ResumePDF`` 对齐）。"""

    content: bytes
    pages: int | None
    overflow: bool = False


def _join(values: list[str], separator: str = " · ") -> str:
    return separator.join(str(item).strip() for item in values if str(item).strip())


def _set_run_font(
    run, *, size_pt: float, bold: bool = False, color: tuple[int, int, int] | None = None
) -> None:
    """统一设置 run 的字体 / 字号 / 颜色，并补上 east-asian 字体（否则中文会回退默认字体）。"""
    run.font.name = DOCX_FONT
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), DOCX_FONT)
    if color is not None:
        run.font.color.rgb = RGBColor(color[0], color[1], color[2])


def _paragraph(
    doc, *, indent_mm: float = 0.0, space_after_mm: float = 0.0, space_before_mm: float = 0.0
):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Mm(indent_mm)
    paragraph.paragraph_format.space_after = Mm(space_after_mm)
    paragraph.paragraph_format.space_before = Mm(space_before_mm)
    return paragraph


def _section_title(doc, text: str, *, base: float, layout, accent: tuple[int, int, int]) -> None:
    """区块标题：字号用 ``section_title_ratio``，颜色用强调色，间距与预览 ``section_gap`` 同口径。"""
    size = base * layout.section_title_ratio
    gap_mm = base * _PX_TO_MM * layout.section_gap
    paragraph = _paragraph(doc, space_before_mm=gap_mm, space_after_mm=base * _PX_TO_MM * 0.4)
    run = paragraph.add_run(text)
    _set_run_font(run, size_pt=size * _PX_TO_PT, bold=True, color=accent)


def _bullets(doc, items: list[str], *, base: float, indent_mm: float = 3.0) -> None:
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        paragraph = _paragraph(doc, indent_mm=indent_mm)
        run = paragraph.add_run(f"· {text}")
        _set_run_font(run, size_pt=base * _PX_TO_PT, color=_BODY_COLOR)


def _meta_line(doc, text: str, *, base: float, layout) -> None:
    if not text.strip():
        return
    paragraph = _paragraph(doc)
    run = paragraph.add_run(text)
    _set_run_font(run, size_pt=base * layout.entry_sub_ratio * _PX_TO_PT, color=_MUTED_COLOR)


def _entry_head(doc, left: str, right: str, *, base: float, layout) -> None:
    """条目标题：左侧加粗、右侧辅助信息，与预览 ``.entry-head`` 一致。"""
    title_size = base * layout.entry_title_ratio
    paragraph = _paragraph(doc, space_before_mm=base * _PX_TO_MM * 0.2)
    run = paragraph.add_run(left)
    _set_run_font(run, size_pt=title_size * _PX_TO_PT, bold=True, color=_BODY_COLOR)
    if right:
        meta_run = paragraph.add_run(f"　{right}")
        _set_run_font(
            meta_run,
            size_pt=base * layout.entry_meta_ratio * _PX_TO_PT,
            color=_MUTED_COLOR,
        )


def _header(
    doc,
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    layout,
    include_photo: bool,
    language: str,
) -> None:
    base = layout.base_px
    photo = _photo_bytes(resume.photo) if (resume.photo and include_photo) else None
    if photo:
        try:
            picture_paragraph = doc.add_paragraph()
            picture_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            picture_paragraph.paragraph_format.space_after = Mm(0)
            # 与 PDF 同一口径：先按模板照片框的比例做 object-fit: cover 的居中裁剪
            # （`crop_image_to_cover`，一处实现两处共用），宽度给了之后高度随图片
            # 自身宽高比走——裁过之后它恰好就是模板的 `photo_height_ratio`。
            picture_paragraph.add_run().add_picture(
                BytesIO(
                    crop_image_to_cover(photo, layout.photo_width_ratio / layout.photo_height_ratio)
                ),
                width=Mm(layout.gap_mm(layout.photo_width_ratio)),
            )
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            pass

    # 姓名与性别各用各的 run：姓名是姓名字号/粗体/强调色，性别是 `.name-extra` 的口径
    # （extra 字号/常规字重/muted 灰）——此前拼成一个 run，性别跟着姓名一起变大变粗。
    name_paragraph = _paragraph(doc)
    name_run = name_paragraph.add_run(resume.name)
    _set_run_font(name_run, size_pt=base * layout.name_ratio * _PX_TO_PT, bold=True, color=accent)
    if resume.gender:
        gender_run = name_paragraph.add_run(f"　{resume.gender}")
        _set_run_font(
            gender_run,
            size_pt=base * layout.name_extra_ratio * _PX_TO_PT,
            color=_MUTED_COLOR,
        )

    if resume.job_intent:
        intent_paragraph = _paragraph(doc)
        intent_run = intent_paragraph.add_run(
            f"{field_labels(language)['intent']}：{resume.job_intent}"
        )
        _set_run_font(
            intent_run, size_pt=base * layout.intent_ratio * _PX_TO_PT, color=_MUTED_COLOR
        )

    contact = _join([resume.phone, resume.email, resume.city, resume.birth_year], "　　")
    if contact:
        contact_paragraph = _paragraph(doc)
        contact_run = contact_paragraph.add_run(contact)
        _set_run_font(
            contact_run, size_pt=base * layout.contact_ratio * _PX_TO_PT, color=_MUTED_COLOR
        )


def _section_summary(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if resume.summary.strip():
        labels = section_titles(language)
        _section_title(doc, labels["summary"], base=base, layout=layout, accent=accent)
        paragraph = _paragraph(doc)
        run = paragraph.add_run(resume.summary.strip())
        _set_run_font(run, size_pt=base * _PX_TO_PT, color=_BODY_COLOR)


def _section_education(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.education:
        return
    labels = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    _section_title(doc, labels["education"], base=base, layout=layout, accent=accent)
    for edu in resume.education:
        _entry_head(
            doc,
            _join([edu.school, edu.major], " · "),
            _join([edu.degree, f"{edu.start_date} - {edu.end_date}"], " · "),
            base=base,
            layout=layout,
        )
        if edu.gpa:
            _meta_line(doc, f"{fields['gpa']}：{edu.gpa}", base=base, layout=layout)
        if edu.courses:
            _meta_line(
                doc, f"{fields['courses']}：{sep.join(edu.courses)}", base=base, layout=layout
            )
        _bullets(doc, edu.achievements, base=base)


def _section_experience(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.experience:
        return
    labels = section_titles(language)
    _section_title(doc, labels["experience"], base=base, layout=layout, accent=accent)
    for exp in resume.experience:
        _entry_head(
            doc,
            _join([exp.company, exp.role], " · "),
            f"{exp.start_date} - {exp.end_date}",
            base=base,
            layout=layout,
        )
        _bullets(doc, exp.description, base=base)


def _section_campus(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.campus_experience:
        return
    labels = section_titles(language)
    _section_title(doc, labels["campus_experience"], base=base, layout=layout, accent=accent)
    for item in resume.campus_experience:
        _entry_head(
            doc,
            _join([item.organization, item.role], " · "),
            f"{item.start_date} - {item.end_date}",
            base=base,
            layout=layout,
        )
        _bullets(doc, item.description, base=base)


def _section_projects(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.projects:
        return
    labels = section_titles(language)
    _section_title(doc, labels["projects"], base=base, layout=layout, accent=accent)
    for project in resume.projects:
        _entry_head(
            doc,
            _join([project.name, project.role], " · "),
            f"{project.start_date} - {project.end_date}",
            base=base,
            layout=layout,
        )
        if project.tech_stack:
            _meta_line(
                doc,
                f"{field_labels(language)['tech_stack']}："
                f"{list_separator(language).join(project.tech_stack)}",
                base=base,
                layout=layout,
            )
        _bullets(doc, project.description, base=base)
        _bullets(doc, project.highlights, base=base)


def _section_skills(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.skills:
        return
    labels = section_titles(language)
    _section_title(doc, labels["skills"], base=base, layout=layout, accent=accent)
    skill_labels = [level_text(skill.name, skill.level, language) for skill in resume.skills]
    if skill_labels:
        paragraph = _paragraph(doc)
        for index, label in enumerate(skill_labels):
            run = paragraph.add_run(("　" if index else "") + label)
            _set_run_font(
                run,
                size_pt=base * layout.tag_font_ratio * _PX_TO_PT,
                color=accent,
            )


def _section_awards(
    doc, resume: ResumeContent, *, base: float, layout, accent, language: str
) -> None:
    if not resume.awards:
        return
    labels = section_titles(language)
    _section_title(doc, labels["awards"], base=base, layout=layout, accent=accent)
    _bullets(
        doc,
        [_join([award.name, award.date, award.description]) for award in resume.awards],
        base=base,
    )


# 分区键 → 渲染函数。**刻意不用 if/elif 链**：链子里漏掉一个键的表现是"那个分区
# 在 Word 里默默不出现"，而字典缺键会在渲染时直接 KeyError——同一个错误，早失败五分钟
# 比晚失败一个版本好。键名与前端、HTML 模板共用 `resume_sections.py` 里的那一份。
_SECTION_RENDERERS = {
    "summary": _section_summary,
    "education": _section_education,
    "experience": _section_experience,
    "campus_experience": _section_campus,
    "projects": _section_projects,
    "skills": _section_skills,
    "awards": _section_awards,
}


def _build_document(
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    layout,
    include_photo: bool,
    section_order: list[str],
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> bytes:
    base = layout.base_px
    doc = Document()

    # 页边距：与 PDF 同一份 layout 的四边——由 `pdf_exporter.layout._resolve_page_margins`
    # 解析（format_config 分边支路 > page_padding > margin_mm 兼容值 > 模板默认）。Word 与
    # PDF 不各自算一遍，否则同一次导出会给出两种边距。
    section = doc.sections[0]
    # 纸张尺寸：python-docx 默认是 Letter（215.9×279.4mm），而预览与 PDF 都是 A4
    # （210×297mm）。不显式设置的话，同一段文字在 Word 里行宽与页高都不同，"页数与
    # PDF 一致"就无从谈起——这是导出侧最容易被忽略的一处口径分叉。
    section.page_width = Mm(PAGE_WIDTH_MM)
    section.page_height = Mm(PAGE_HEIGHT_MM)
    section.top_margin = Mm(layout.margin_top)
    section.bottom_margin = Mm(layout.margin_bottom)
    section.left_margin = Mm(layout.margin_left)
    section.right_margin = Mm(layout.margin_right)

    _header(
        doc,
        resume,
        accent=accent,
        layout=layout,
        include_photo=include_photo,
        language=language,
    )

    for section_key in section_order:
        _SECTION_RENDERERS[section_key](
            doc, resume, base=base, layout=layout, accent=accent, language=language
        )

    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def build_resume_docx(
    resume: ResumeContent,
    *,
    template: str = "classic",
    page_limit: int = 1,
    font_scale: str = "standard",
    format_config: dict | None = None,
    margin_mm: float | None = None,
    include_photo: bool = True,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> ResumeDOCX:
    """把结构化简历渲染成 Word 文档。

    版式全部来自 ``ResumeLayout``（复用 PDF 的同一来源），页数用连续流模型估算，与
    PDF 的真实页数差在 ±1 内。没有中文字体时仍能生成文档，只是 ``pages=None``。

    **不缩字号**（2026-10-21 用户要求）：估算页数超过 ``page_limit`` 时只标记 ``overflow``，
    文档本身按用户设定的版式写入——Word 会自己顺延页数，不会丢内容（与 PDF 的"截断"不同，
    所以界面提示要说清是"超过所选页数"，而不是"超出部分不会显示"）。

    ``margin_mm`` 与 PDF 同一条规则：页边距权威是 ``format_config`` 的分边支路与总键，
    ``margin_mm`` 只在没有 ``page_padding`` 时作回落值（见 ``layout._resolve_page_margins``）。

    ``language`` 决定七个分区标题的文案（唯一来源 ``resume_labels.section_titles``），
    同时传给页数估算与文档构建两条路——标题文字长度会影响换行，两边必须同值。
    """
    from .resume.resume_templates import FONT_SCALES, template_spec, validated_format_config

    spec = template_spec(template)
    scale = FONT_SCALES.get(font_scale) or FONT_SCALES["standard"]
    base_px = float(scale["base_px"])

    overrides = validated_format_config(format_config)
    accent_adjust = overrides.get("font_scale_adjust")
    if isinstance(accent_adjust, (int, float)):
        base_px = round(base_px * float(accent_adjust), 2)
    accent = resolve_accent(spec["name"], overrides)

    layout = resolve_layout(
        template=spec["name"], base_px=base_px, format_config=overrides, margin_mm=margin_mm
    )
    limit = max(1, min(int(page_limit), MAX_RESUME_PAGES))

    pages, overflow = _estimate_pages(
        resume,
        accent=accent,
        layout=layout,
        page_limit=limit,
        include_photo=include_photo,
        language=language,
    )
    content = _build_document(
        resume,
        accent=accent,
        layout=layout,
        include_photo=include_photo,
        section_order=resolved_section_order(overrides),
        language=language,
    )
    return ResumeDOCX(content=content, pages=pages, overflow=overflow)


def _estimate_pages(
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    layout,
    page_limit: int,
    include_photo: bool,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> tuple[int | None, bool]:
    """估算 Word 页数与"是否超过所选页数"。

    Word 自动分页是"连续流"，所以页数用 ``连续内容高 ÷ 每页可用高`` 估算——与 PDF 的
    真实分页共用同一份版式与同一段测量代码。没有中文字体时返回 ``(None, False)``：
    页数未知不等于"装得下"，但也不该凭空报溢出。

    ``language`` 透传给 ``measure_content_height``：标题文字长度随语言变，页数也就跟着变。
    不传就会出现"文档里是英文标题、估算却按中文标题算"的错位。
    """
    fonts = _resolve_font_paths()
    if fonts is None:
        return None, False
    regular, bold = fonts
    height = measure_content_height(
        resume,
        accent=accent,
        layout=layout,
        regular=regular,
        bold=bold,
        include_photo=include_photo,
        language=language,
    )
    pages = max(1, math.ceil(height / layout.usable_height_per_page))
    return pages, pages > page_limit


__all__ = ["DOCX_FONT", "ResumeDOCX", "build_resume_docx"]

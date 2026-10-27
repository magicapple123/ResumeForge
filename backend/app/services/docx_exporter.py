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

W05 起：字体族名取用户实际所选字体文件读出的真实族名（不嵌入、不伪报，见
``docx_fonts``）、条目间距按模板 ``entry_gap``、正文/辅助色与 PDF 同源；七个分区渲染拆到
``docx_sections``，本模块只保留入口、页头与页数估算。
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from functools import partial
from io import BytesIO

from docx import Document
from docx.shared import Mm

from ..schemas.resume import ResumeContent
from ..schemas.resume_generation import LONG_CV_MAX_PAGES
from .docx_blocks import (
    DOCX_FONT,
    DocxTheme,
    decorate_paragraph,
    float_picture,
    resolve_docx_theme,
)
from .docx_blocks import (
    paragraph as _paragraph,
)
from .docx_blocks import (
    set_run_font as _set_run_font,
)
from .docx_custom_sections import section_custom
from .docx_sections import SECTION_RENDERERS
from .pdf_exporter import (
    _PX_TO_PT,
    PAGE_HEIGHT_MM,
    PAGE_WIDTH_MM,
    _photo_bytes,
    _resolve_font_paths,
    fit_photo_size,
    measure_content_height,
    resolve_accent,
    resolve_accent_soft,
    resolve_font_paths,
    resolve_layout,
)
from .resume.resume_contact import (
    CONTACT_BREAKS_KEY,
    WORD_SEPARATOR,
    contact_items,
    contact_lines,
)
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE, field_labels
from .resume.resume_render_overrides import resolve_render_overrides
from .resume.resume_sections import resolved_section_order
from .resume.resume_visibility import visible_resume

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResumeDOCX:
    """生成好的 Word 文档，连同估算页数与"装不装得下"的结论（语义与 ``ResumePDF`` 对齐）。"""

    content: bytes
    pages: int | None
    overflow: bool = False


def _apply_continuation(doc, overrides, name: str) -> None:
    """W08：Word 的续页信息（重复姓名 / 页码）。

    画在 section.header / footer 的**页边距区域**里，不进正文流；首屏不画（与 PDF 口径一致）。
    默认 plan 全空 → 一个字节都不加（旧产物不变）。
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    if overrides is None:
        return
    plan = overrides.pagination
    if plan.empty:
        return
    section = doc.sections[0]

    def _field(paragraph, instruction: str) -> None:
        run = paragraph.add_run()
        begin = OxmlElement("w:fldChar")
        begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = instruction
        end = OxmlElement("w:fldChar")
        end.set(qn("w:fldCharType"), "end")
        run._r.append(begin)
        run._r.append(instr)
        run._r.append(end)

    if plan.repeat_name and name.strip():
        section.different_first_page_header_footer = True
        header_paragraph = section.header.paragraphs[0]
        header_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        run = header_paragraph.add_run(name)
        _set_run_font(run, size_pt=9, color=None)
    if plan.page_numbers:
        footer_paragraph = section.footer.paragraphs[0]
        footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        prefix = footer_paragraph.add_run("第 ")
        _set_run_font(prefix, size_pt=9, color=None)
        _field(footer_paragraph, "PAGE")
        middle = footer_paragraph.add_run(" 页 / 共 ")
        _set_run_font(middle, size_pt=9, color=None)
        _field(footer_paragraph, "NUMPAGES")
        suffix = footer_paragraph.add_run(" 页")
        _set_run_font(suffix, size_pt=9, color=None)


def _header(
    doc,
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
    layout,
    include_photo: bool,
    language: str,
    theme,
    format_config: dict | None = None,
) -> None:
    base = layout.base_px
    # 这份简历的字体族 + 正文/辅助色（与 PDF 同一份解析）。
    set_font = partial(_set_run_font, font_name=theme.font_name)
    photo = _photo_bytes(resume.photo) if (resume.photo and include_photo) else None
    fields = field_labels(language)

    # 姓名与性别各用各的 run：姓名是姓名字号/粗体/强调色，性别是 `.name-extra` 的口径
    # （extra 字号/常规字重/muted 灰）——此前拼成一个 run，性别跟着姓名一起变大变粗。
    name_paragraph = _paragraph(doc)
    # 页头那几段要一起加底色（见函数末尾）：先收集，别用"最后 N 段"去猜。
    header_paragraphs = [name_paragraph]
    name_run = name_paragraph.add_run(resume.name)
    set_font(name_run, size_pt=base * layout.name_ratio * _PX_TO_PT, bold=True, color=accent)
    if resume.gender:
        gender_run = name_paragraph.add_run(f"　{resume.gender}")
        set_font(
            gender_run,
            size_pt=base * layout.name_extra_ratio * _PX_TO_PT,
            color=theme.muted_text,
        )

    if photo:
        try:
            # 与 PDF 同一口径：照片按**原图比例**装进模板照片框（object-fit: contain），
            # 不再按框比例 cover 裁切——服务端已经按 `photo_crop` 派生过裁剪图，再裁一次
            # 用户就"看不到裁剪效果"（#10）。只给宽度即可：python-docx 按图片自身宽高比
            # 算高度，宽高比因此与 fit_photo_size 的结果一致、不会变形。
            photo_w = layout.gap_mm(layout.photo_width_ratio)
            photo_h = layout.gap_mm(layout.photo_height_ratio)
            draw_w, draw_h = fit_photo_size(photo, photo_w, photo_h)
            picture_run = name_paragraph.add_run()
            picture_run.add_picture(BytesIO(photo), width=Mm(draw_w))
            # **浮于文字上方**（2026-10-24 用户实测的解法）：嵌入型会让照片独占一行、
            # 把姓名整体下推，页头因此比预览高一截。详见 `docx_blocks.float_picture`。
            # 垂直偏移 = contain 居中留出的上边距，与 HTML `object-fit: contain` 同一定位。
            float_picture(
                picture_run,
                align="left" if layout.header_photo_side == "left" else "right",
                vertical_offset_mm=max(0.0, (photo_h - draw_h) / 2),
            )
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 Word，已跳过")

    if resume.job_intent:
        intent_paragraph = _paragraph(doc)
        header_paragraphs.append(intent_paragraph)
        intent_run = intent_paragraph.add_run(f"{fields['intent']}：{resume.job_intent}")
        set_font(intent_run, size_pt=base * layout.intent_ratio * _PX_TO_PT, color=theme.muted_text)

    # 联系方式（#6 / #3）：字段集合 / 文案 / 强制换行与 HTML、PDF 共用 `resume_contact`。
    # 此前 Word 只拼了 phone / email / city / birth_year 四个，GitHub 与个人主页整段缺失
    # ——预览有、导出没有。强制换行用 OOXML 的 `w:br`（`run.add_break()`），
    # 与 HTML 的 `<br>` 同义；同一条里字段之间用全角空格（Word 的断行点）。
    contact_line_texts = contact_lines(
        contact_items(resume, fields, (format_config or {}).get(CONTACT_BREAKS_KEY)),
        WORD_SEPARATOR,
    )
    if contact_line_texts:
        contact_paragraph = _paragraph(doc)
        header_paragraphs.append(contact_paragraph)
        for index, line in enumerate(contact_line_texts):
            if index:
                contact_paragraph.add_run().add_break()
            contact_run = contact_paragraph.add_run(line)
            set_font(
                contact_run,
                size_pt=base * layout.contact_ratio * _PX_TO_PT,
                color=theme.muted_text,
            )

    # 页头底色块（modern 的浅绿块）：模板里 `.header` 有 `background` + `padding`，
    # 导出后若只有文字没有底色，"Word 与预览不一样"就又回来了。三段各加同色底纹，
    # 段间距为 0 时它们会连成一整块；四边同色边框把底纹撑开，模拟 CSS 的 padding。
    if getattr(layout, "header_bg", "none") == "soft_accent":
        for node in header_paragraphs:
            decorate_paragraph(
                node,
                fill=accent_soft,
                edges=("top", "left", "bottom", "right"),
                border_color=accent_soft,
                border_sz=4,
                space_pt=6,
            )


def _build_document(
    resume: ResumeContent,
    *,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
    layout,
    include_photo: bool,
    section_order: list[str],
    language: str = DEFAULT_RESUME_LANGUAGE,
    # 唯一调用方 build_resume_docx 一定先 resolve_docx_theme；不再保留 None 默认值，
    # 否则这个 None 会顺着传进 section_custom（DocxTheme 参数）把类型弄脏。
    theme: DocxTheme,
    overrides=None,
    # 已白名单化的 format_config：页头联系方式只要其中的 contact_breaks（#3）。
    format_config: dict | None = None,
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
        accent_soft=accent_soft,
        layout=layout,
        include_photo=include_photo,
        language=language,
        theme=theme,
        format_config=format_config,
    )

    for section_key in section_order:
        SECTION_RENDERERS[section_key](
            doc,
            resume,
            base=base,
            layout=layout,
            accent=accent,
            accent_soft=accent_soft,
            theme=theme,
            language=language,
            overrides=overrides,
        )

    # C2/R-79：自建大字段在系统分区之后独立成栏（空列表零输出，旧产物逐字节不变）。
    section_custom(
        doc,
        resume,
        base=base,
        layout=layout,
        accent=accent,
        accent_soft=accent_soft,
        theme=theme,
        language=language,
        overrides=overrides,
    )

    _apply_continuation(doc, overrides, resume.name)

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
    from .resume.resume_template_format import FONT_KEY
    from .resume.resume_templates import FONT_SCALES, template_spec, validated_format_config

    # 投递视角（W06）：隐藏条目在排版前剔除；页数估算与文档正文因此同源。
    resume = visible_resume(resume)
    spec = template_spec(template)
    scale = FONT_SCALES.get(font_scale) or FONT_SCALES["standard"]
    base_px = float(scale["base_px"])

    overrides = validated_format_config(format_config)
    accent_adjust = overrides.get("font_scale_adjust")
    if isinstance(accent_adjust, (int, float)):
        base_px = round(base_px * float(accent_adjust), 2)
    accent = resolve_accent(spec["name"], overrides)
    # 区块标题与页头的底色块用模板真实的 `--accent-soft`（不是现场调淡，见
    # `resolve_accent_soft` 的注释）。
    accent_soft = resolve_accent_soft(spec["name"], overrides)
    # W05：Word 的字体族名（读所选字体的真实族名）与正文/辅助色（与 PDF 同源）。
    theme = resolve_docx_theme(spec["name"], overrides)
    # W07/W08/W15：角色/对象/分页/照片裁剪四域的唯一解析结果（纯读，不写库）。
    render_overrides = resolve_render_overrides(
        template=spec["name"], format_config=format_config, photo=resume.photo
    )
    if render_overrides.photo_crop is not None:
        resume = resume.model_copy(
            update={"photo": render_overrides.photo_for_render(resume.photo)}
        )

    layout = resolve_layout(
        template=spec["name"], base_px=base_px, format_config=overrides, margin_mm=margin_mm
    )
    # A4 长 CV：Word 只按 page_limit 估算 overflow、不截断内容，所以防御性上限用
    # 长 CV 的 10 页（普通简历的 1–3 在调用方已按文档模式夹紧，行为不变）。
    limit = max(1, min(int(page_limit), LONG_CV_MAX_PAGES))

    pages, overflow = _estimate_pages(
        resume,
        accent=accent,
        layout=layout,
        page_limit=limit,
        include_photo=include_photo,
        language=language,
        font_key=overrides.get(FONT_KEY),
        overrides=render_overrides,
        # 联系方式强制换行也影响页头高度：量的那份必须和画的那份同配置（#3）。
        format_config=overrides,
    )
    content = _build_document(
        resume,
        accent=accent,
        accent_soft=accent_soft,
        layout=layout,
        include_photo=include_photo,
        section_order=resolved_section_order(overrides),
        language=language,
        theme=theme,
        overrides=render_overrides,
        format_config=overrides,
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
    font_key: str | None = None,
    overrides=None,
    format_config: dict | None = None,
) -> tuple[int | None, bool]:
    """估算 Word 页数与"是否超过所选页数"。

    Word 自动分页是"连续流"，所以页数用 ``连续内容高 ÷ 每页可用高`` 估算——与 PDF 的
    真实分页共用同一份版式与同一段测量代码。没有中文字体时返回 ``(None, False)``：
    页数未知不等于"装得下"，但也不该凭空报溢出。

    ``language`` 透传给 ``measure_content_height``：标题文字长度随语言变，页数也就跟着变。
    不传就会出现"文档里是英文标题、估算却按中文标题算"的错位。
    """
    # 与 PDF 同一条字体解析：量高用**这份简历选的字体**，否则"换了字体、页数估算不变"
    # 会让 Word 的页数提示与 PDF 的页数读写各说各话。
    fonts = resolve_font_paths(font_key) if font_key is not None else _resolve_font_paths()
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
        overrides=overrides,
        # 联系方式行数由 contact_breaks 决定，页头高度随之变化——估算必须同配置。
        format_config=format_config,
    )
    pages = max(1, math.ceil(height / layout.usable_height_per_page))
    return pages, pages > page_limit


__all__ = ["DOCX_FONT", "ResumeDOCX", "build_resume_docx"]

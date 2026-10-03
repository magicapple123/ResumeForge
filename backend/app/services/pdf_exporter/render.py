"""绘制编排（``ResumePDF`` 结果对象、字体注册、``_draw_resume`` 主绘制流程）。"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from ..resume.resume_sections import resolved_section_order
from ...schemas.resume import ResumeContent
from .canvas import _ResumePDF
from .fonts import FONT_FAMILY, ResumePDFError
from .layout import (
    _BODY_TEXT,
    _MUTED_TEXT,
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_WIDTH_MM,
    ResumeLayout,
    resolve_layout,
)
from .media import _join, _photo_bytes, crop_image_to_cover
from .name_gender import draw_name_gender, plan_name_gender
from .skill_tags import soft_accent
from .theme import resolve_accent, resolve_line

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResumePDF:
    """生成好的 PDF，连同它的实际页数与一页适配结果。

    ``scale`` 是实际使用的字号缩放（1.0 表示没有缩），``overflow`` 表示"缩到下限仍塞不下"。
    调用方据此提示用户"内容超出所选页数"，而不是让用户下载完才发现。
    """

    content: bytes
    pages: int
    scale: float = 1.0
    overflow: bool = False


def _register_fonts(pdf: FPDF, regular: str, bold: str) -> None:
    try:
        pdf.add_font(FONT_FAMILY, "", regular)
        pdf.add_font(FONT_FAMILY, "B", bold)
    except Exception as exc:  # noqa: BLE001 - 字体解析失败要变成可读提示
        raise ResumePDFError(f"加载中文字体失败（{Path(regular).name}）：{exc}") from exc


def _draw_resume(
    pdf: _ResumePDF,
    resume: ResumeContent,
    *,
    include_photo: bool = True,
    format_config: dict | None = None,
) -> None:
    """把结构化简历画进 ``pdf``。测量与最终渲染共用这一段，保证"量的"就是"画的"。

    ``include_photo=False`` 时**连页头也不给照片预留空间**（不只是不画图）：导出选项里
    关掉照片意味着这一版内容就没有照片，字号自适应与页数判定都要按"无照片"来量，否则
    会量出一个实际不存在的照片高度。

    ``format_config`` 里可能带 ``section_order``（分区顺序）。**分页会受顺序影响**
    （`ensure_space` 不切断条目，于是某个分区被推到下一页时留白多少与顺序有关），
    所以测量路径也要用同一份配置，否则"量的"与"画的"又分家了。
    """
    layout = pdf.layout
    base = layout.scaled_base_px

    # 照片尺寸由模板 `.profile-photo` 的宽高（× 字号）派生——预览里它随字号/缩放走，
    # PDF 此前却是固定 22×28mm，字号一大一小就对不上（用户看到"照片大小与字号不协调"）。
    photo_w = layout.gap_mm(layout.photo_width_ratio)
    photo_h = layout.gap_mm(layout.photo_height_ratio)

    # ===== 页头（含装饰：底边线 / modern 的浅底色块）=====
    # 页头的装饰同样只来自模板 `.header` 的 CSS：底边线（宽度固定 px、强调色）、文字与线之间的
    # padding-bottom，以及 modern 那种浅底色块（`background: var(--accent-soft)` + 圆角 + 四周内边距）。
    hdr_pad_x = layout.gap_mm(layout.header_pad_x)
    hdr_pad_y = layout.gap_mm(layout.header_pad_y)
    hdr_pad_bottom = layout.gap_mm(layout.header_pad_bottom)
    hdr_radius = layout.gap_mm(layout.header_radius)
    # 底边线宽度是固定的 px（CSS `border-bottom: Npx`），不随字号/一页适配缩放，与预览一致。
    hdr_border_w = layout.header_border_width * _PX_TO_MM
    header_has_bg = layout.header_bg == "soft_accent"

    header_top = pdf.get_y()
    content_left = layout.margin_x + hdr_pad_x
    content_top = header_top + hdr_pad_y
    inner_width = pdf.content_width - 2 * hdr_pad_x

    photo = _photo_bytes(resume.photo) if (resume.photo and include_photo) else None
    text_width = inner_width - (photo_w + 6 if photo else 0)

    name_size = base * layout.name_ratio
    extra_size = base * layout.name_extra_ratio
    gender = (resume.gender or "").strip()
    intent_text = f"求职意向：{resume.job_intent}" if resume.job_intent else ""
    contact = _join([resume.phone, resume.email, resume.city, resume.birth_year], "    ")

    # 先量页头正文的高度（不落笔）：modern 的底色块要按它定尺寸、并画在文字之下。
    # 姓名与性别**各量各的**（`plan_name_gender`，与绘制同一逻辑），性别不再并入
    # 姓名行的字号计算——此前拼成一条 name_line，性别被按姓名字号量与画。
    name_plan = plan_name_gender(
        pdf, resume.name, gender, width=text_width, name_size=name_size, extra_size=extra_size
    )
    text_height = name_plan.height
    if intent_text:
        text_height += pdf.text_block_height(
            intent_text, width=text_width, size_px=base * layout.intent_ratio
        )
    if contact:
        text_height += pdf.text_block_height(
            contact, width=text_width, size_px=base * layout.contact_ratio
        )
    photo_span = photo_h if photo else 0.0
    header_content_h = max(text_height, photo_span)

    if header_has_bg:
        pdf.set_fill_color(*soft_accent(pdf.accent))
        pdf.rect(
            layout.margin_x,
            header_top,
            pdf.content_width,
            hdr_pad_y + header_content_h + hdr_pad_y,
            style="F",
            round_corners=hdr_radius > 0,
            corner_radius=hdr_radius,
        )

    if photo:
        try:
            from io import BytesIO

            # 先按目标框比例居中裁剪（object-fit: cover 的等价物）再交给 fpdf2——
            # 它同时给定 w 与 h 时会强制拉伸，不裁剪的照片宽高比一不同就变形。
            # 坏图（裁剪/解码失败）由这里的兜底跳过照片，不阻断导出。
            pdf.image(
                BytesIO(crop_image_to_cover(photo, photo_w / photo_h)),
                x=PAGE_WIDTH_MM - layout.margin_x - hdr_pad_x - photo_w,
                y=content_top,
                w=photo_w,
                h=photo_h,
            )
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 PDF，已跳过")

    pdf.set_y(content_top)
    pdf.set_x(content_left)
    # 姓名（姓名字号/粗体/强调色）与性别（extra 字号/常规/muted）同块绘制，见 plan。
    draw_name_gender(
        pdf, resume.name, name_plan, width=text_width, name_size=name_size, extra_size=extra_size
    )
    pdf.set_text_color(*_BODY_TEXT)
    if intent_text:
        intent_size = base * layout.intent_ratio
        pdf.set_font(FONT_FAMILY, "", intent_size * _PX_TO_PT)
        pdf.set_text_color(*_MUTED_TEXT)
        pdf.set_x(content_left)
        pdf.multi_cell(
            text_width,
            pdf.line_advance(intent_size),
            intent_text,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    if contact:
        contact_size = base * layout.contact_ratio
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        pdf.set_text_color(*_MUTED_TEXT)
        pdf.set_x(content_left)
        pdf.multi_cell(
            text_width,
            pdf.line_advance(contact_size),
            contact,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    pdf.set_text_color(*_BODY_TEXT)

    # 页头块的底：文字底与照片底取更靠下者；modern 再补下内边距，其余模板补 padding-bottom 后画底边线。
    header_bottom = max(pdf.get_y(), content_top + photo_span)
    if header_has_bg:
        header_bottom += hdr_pad_y
    if hdr_border_w > 0:
        header_bottom += hdr_pad_bottom
        line_y = header_bottom
        pdf.set_draw_color(*pdf.accent)
        pdf.set_line_width(hdr_border_w)
        pdf.line(layout.margin_x, line_y, PAGE_WIDTH_MM - layout.margin_x, line_y)
    pdf.set_y(header_bottom)

    # ===== 各分区 =====
    # 第一段之前的留白 = 页头 `.header` 的 margin-bottom（`header_gap`）；之后区块之间 = 上一段
    # `.section` 的 margin-bottom（`section_gap`）。预览里 `.section` 只有 bottom 边距、且页头
    # 自己也有一段 margin-bottom，所以这里必须把两种前导间距分开，否则第一段会比预览紧。
    first_section = True

    def section(title: str) -> None:
        nonlocal first_section
        leading = layout.header_gap if first_section else layout.section_gap
        pdf.section_title(title, base, leading_gap=leading)
        first_section = False

    def body(text: str) -> None:
        pdf.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
        pdf.set_x(layout.margin_x)
        pdf.multi_cell(
            pdf.content_width,
            pdf.line_advance(base),
            text,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    def draw_summary() -> None:
        if resume.summary.strip():
            section("个人总结")
            body(resume.summary.strip())


    def draw_education() -> None:
        if resume.education:
            section("教育经历")
            for index, edu in enumerate(resume.education):
                # 同一分区内条目之间的留白 = 模板 `.entry { margin-bottom }`（此前 PDF 没有）。
                if index:
                    pdf.ln(layout.gap_mm(layout.entry_gap))
                pdf.entry_head(
                    _join([edu.school, edu.major], " · "),
                    _join([edu.degree, f"{edu.start_date} - {edu.end_date}"], " · "),
                    base,
                )
                if edu.gpa:
                    pdf.meta_line(f"绩点/排名：{edu.gpa}", base)
                if edu.courses:
                    pdf.meta_line(f"核心课程：{'、'.join(edu.courses)}", base)
                pdf.bullets(edu.achievements, base)


    def draw_experience() -> None:
        if resume.experience:
            section("实习/工作经历")
            for index, exp in enumerate(resume.experience):
                if index:
                    pdf.ln(layout.gap_mm(layout.entry_gap))
                pdf.entry_head(
                    _join([exp.company, exp.role], " · "),
                    f"{exp.start_date} - {exp.end_date}",
                    base,
                )
                pdf.bullets(exp.description, base)


    def draw_campus() -> None:
        if resume.campus_experience:
            section("校园经历")
            for index, item in enumerate(resume.campus_experience):
                if index:
                    pdf.ln(layout.gap_mm(layout.entry_gap))
                pdf.entry_head(
                    _join([item.organization, item.role], " · "),
                    f"{item.start_date} - {item.end_date}",
                    base,
                )
                pdf.bullets(item.description, base)


    def draw_projects() -> None:
        if resume.projects:
            section("项目经历")
            for index, project in enumerate(resume.projects):
                if index:
                    pdf.ln(layout.gap_mm(layout.entry_gap))
                # 项目名在左、`角色 · 时间` 在右——与预览 `_resume_sections.j2` 一致
                # （此前把角色并进了左边：`name · role`，看起来与预览不是一回事）。
                pdf.entry_head(
                    project.name,
                    _join([project.role, f"{project.start_date} - {project.end_date}"], " · "),
                    base,
                )
                if project.tech_stack:
                    pdf.meta_line(f"技术栈/工具：{'、'.join(project.tech_stack)}", base)
                pdf.bullets(project.description, base)
                pdf.bullets(project.highlights, base)


    def draw_skills() -> None:
        if resume.skills:
            section("专业技能")
            # 标签文案与预览一致：`技能名（等级）`。用标签绘制而不是「、」连接的一行文本——
            # 后者在预览里是带底色的小框，导出后却看不出任何标签形状。
            pdf.skill_tags(
                [
                    f"{skill.name}（{skill.level}）" if skill.level else skill.name
                    for skill in resume.skills
                ],
                base,
            )


    def draw_awards() -> None:
        if resume.awards:
            section("荣誉奖项")
            pdf.bullets(
                [
                    _join([award.name, award.date, award.description])
                    for award in resume.awards
                ],
                base,
            )

    # 分区顺序由版式配置里的 section_order 决定（见 services/resume/resume_sections.py）。
    # 用字典而不是 if/elif 链：漏一个键时字典会直接 KeyError，而 if 链的表现是
    # "那个分区在 PDF 里默默消失"——同一个错误，早失败比晚失败好。
    drawers = {
        "summary": draw_summary,
        "education": draw_education,
        "experience": draw_experience,
        "campus_experience": draw_campus,
        "projects": draw_projects,
        "skills": draw_skills,
        "awards": draw_awards,
    }
    for section_key in resolved_section_order(format_config):
        drawers[section_key]()

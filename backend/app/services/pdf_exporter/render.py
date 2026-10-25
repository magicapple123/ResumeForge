# SPDX-License-Identifier: Apache-2.0
"""绘制编排（``ResumePDF`` 结果对象、字体注册、``_draw_resume`` 主绘制流程）。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from ...schemas.resume import ResumeContent
from ..resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    field_labels,
    level_text,
    list_separator,
    section_titles,
)
from ..resume.resume_pagination import PaginationPlan
from ..resume.resume_sections import resolved_section_order
from .canvas import _ResumePDF
from .columns import SectionDrawer, render_sections
from .fonts import FONT_FAMILY, ResumePDFError
from .layout import (
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_WIDTH_MM,
)
from .media import _join, _photo_bytes, crop_image_to_cover
from .name_gender import draw_name_gender, plan_name_gender
from .research_render import (
    draw_credentials,
    draw_patents,
    draw_publications,
    draw_research_projects,
    experience_kind_line,
    project_extra_line,
)
from .section_presence import section_has_content
from .style_blocks import parse_color, start_forced_page

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResumePDF:
    """生成好的 PDF，连同它的页数与"装不装得下"的结论。

    ``pages`` 是**文件里实际排出的页数**（超出上限时被截断，因此恒 <= 上限）；
    ``pages_needed`` 是按当前参数真实需要的页数（未截断），界面用来说"约需 N 页"；
    ``overflow`` 表示"按当前参数放不进所选页数，尾部已被截断"。

    三者必须彼此自洽：``overflow`` 为真 ⇔ ``pages_needed > pages``。
    **这里不再有"缩放"字段**（2026-10-21）：装不下就如实标记并提示用户，绝不替用户
    把字号压小——滑杆上的字号必须等于纸面上的字号。
    """

    content: bytes
    pages: int
    pages_needed: int | None = None
    overflow: bool = False
    # 这一趟真正画出去的字。**只给字体预子集化用**（见 `font_subset`）。
    chars: frozenset[str] = frozenset()
    # W08：绘制日志（语义锚点；报告端点用）。默认空 tuple，旧调用方零影响。
    spans: tuple = ()


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
    language: str = DEFAULT_RESUME_LANGUAGE,
    overrides=None,
) -> None:
    """把结构化简历画进 ``pdf``。测量与最终渲染共用这一段，保证"量的"就是"画的"。

    ``include_photo=False`` 时**连页头也不给照片预留空间**（不只是不画图）：导出选项里
    关掉照片意味着这一版内容就没有照片，字号自适应与页数判定都要按"无照片"来量，否则
    会量出一个实际不存在的照片高度。

    ``format_config`` 里可能带 ``section_order``（分区顺序）。**分页会受顺序影响**
    （`ensure_space` 不切断条目，于是某个分区被推到下一页时留白多少与顺序有关），
    所以测量路径也要用同一份配置，否则"量的"与"画的"又分家了。

    ``language`` 只决定七个分区标题与字段前缀的文案（取自 ``resume_labels``），
    本函数**不判断语言**。标题文字长度会影响换行与高度，所以测量路径必须传同一个值——
    量的和画的用了两种语言，页数结论就不可信了。

    语言只换**词与标点**（``fields`` / ``sep`` / ``level_text``），不换标点风格：英文产物
    里仍是 ``Objective：…``（全角冒号），这是附录 A 已接受的已知瑕疵，本批不顺手做标点本地化。
    """
    layout = pdf.layout
    base = layout.base_px
    labels = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    # W07：角色/对象覆盖的唯一解析结果（四域入口见 RenderOverrides）。None = 默认路径。
    style = overrides.style if overrides is not None else None
    pagination = overrides.pagination if overrides is not None else PaginationPlan()

    def role_style(role: str, object_id: str | None = None):
        """该角色在对象上下文下的显式覆盖；无覆盖返回 None（= 用模板值）。"""
        if style is None:
            return None
        return style.effective(role, object_id=object_id)

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
    content_right = PAGE_WIDTH_MM - layout.margin_right - hdr_pad_x
    content_top = header_top + hdr_pad_y
    inner_width = pdf.content_width - 2 * hdr_pad_x

    photo = _photo_bytes(resume.photo) if (resume.photo and include_photo) else None
    # 照片占哪一侧由模板 `.header` 的 `flex-direction` 决定（elegant 是 `row-reverse`，
    # DOM 顺序 `[文字块, 照片]` ⇒ 照片在**左**）。此前 PDF 恒画右侧、文字恒从左边距起笔。
    # 两侧的"文字块宽度"是同一个式子（少掉照片宽 + 固定 6mm 间隙），差别只在**起点**平移；
    # `header_photo_side` 缺省 `"right"` 时 `text_left` 就退回原 `content_left`，逐字节不变。
    photo_left = bool(photo) and layout.header_photo_side == "left"
    photo_box = photo_w + 6 if photo else 0.0
    text_width = inner_width - photo_box
    text_left = content_left + photo_box if photo_left else content_left
    # 页头文字对齐：模板 `.header` 的 `text-align`（elegant 是 `center`）。
    # `left` 是**原行为**，其余 7 个模板读到的就是它。
    header_centered = layout.header_align == "center"
    header_text_align = "C" if header_centered else "L"

    name_style = role_style("name")
    meta_style = role_style("meta")
    name_scale = float(name_style.font_scale) if name_style is not None and name_style.font_scale else 1.0
    meta_scale = float(meta_style.font_scale) if meta_style is not None and meta_style.font_scale else 1.0
    name_size = base * layout.name_ratio * name_scale
    extra_size = base * layout.name_extra_ratio
    name_color = parse_color(name_style.color) if name_style is not None and name_style.color else None
    name_bold = name_style.bold if name_style is not None and name_style.bold is not None else True
    meta_color = parse_color(meta_style.color) if meta_style is not None and meta_style.color else None
    gender = (resume.gender or "").strip()
    intent_text = f"{fields['intent']}：{resume.job_intent}" if resume.job_intent else ""
    # 与预览 `_resume_sections.j2` 的 `.contact` 同字段、同顺序、同文案。此前只拼了前四个，
    # GitHub 与个人网站整段丢失（预览有、PDF 没有）。`_join` 会丢掉空串，所以空字段不留分隔符。
    contact = _join(
        [
            resume.phone,
            resume.email,
            resume.city,
            resume.birth_year,
            f"{fields['github']}：{resume.github}" if resume.github else "",
            f"{fields['website']}：{resume.personal_website}" if resume.personal_website else "",
        ],
        "    ",
    )

    # 先量页头正文的高度（不落笔）：modern 的底色块要按它定尺寸、并画在文字之下。
    # 姓名与性别**各量各的**（`plan_name_gender`，与绘制同一逻辑），性别不再并入
    # 姓名行的字号计算——此前拼成一条 name_line，性别被按姓名字号量与画。
    name_plan = plan_name_gender(
        pdf, resume.name, gender, width=text_width, name_size=name_size, extra_size=extra_size
    )
    text_height = name_plan.height
    if intent_text:
        # 段前留白 `.header .intent { margin-top }` 与正文一样占高度，必须计入（下面画的时候
        # 也用同一个 `ln`），否则 modern 的底色块会比文字矮一截。
        text_height += layout.gap_mm(layout.intent_gap)
        text_height += pdf.text_block_height(
            intent_text, width=text_width, size_px=base * layout.intent_ratio * meta_scale
        )
    if contact:
        text_height += layout.gap_mm(layout.contact_gap)
        text_height += pdf.text_block_height(
            contact, width=text_width, size_px=base * layout.contact_ratio * meta_scale
        )
    photo_span = photo_h if photo else 0.0
    header_content_h = max(text_height, photo_span)

    if header_has_bg:
        # 页头底色块用模板 `:root` 的 `--accent-soft` 真值（split 现场调淡约得 #edeae5，
        # 模板写死的是 #f3eee6，两者有色差——见 `theme.resolve_accent_soft`）。
        pdf.set_fill_color(*pdf.accent_soft)
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
                # 照片在左时贴着文字起点画；在右时贴着正文右边界（原行为）。
                x=content_left if photo_left else content_right - photo_w,
                y=content_top,
                w=photo_w,
                h=photo_h,
            )
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 PDF，已跳过")

    pdf.set_y(content_top)
    pdf.set_x(text_left)
    # 姓名（姓名字号/粗体/强调色）与性别（extra 字号/常规/muted）同块绘制，见 plan。
    # `align` 决定这一块在 `text_width` 内居中还是贴左（模板 `.header` 的 `text-align`）。
    draw_name_gender(
        pdf,
        resume.name,
        name_plan,
        width=text_width,
        name_size=name_size,
        extra_size=extra_size,
        align=layout.header_align,
        name_color=name_color,
        name_bold=bool(name_bold),
    )
    pdf.set_text_color(*pdf.body_text)
    if intent_text:
        intent_size = base * layout.intent_ratio * meta_scale
        pdf.set_font(FONT_FAMILY, "", intent_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        # 模板 `.header .intent { margin-top: calc(var(--fs) * N) }`；`ln` 会把 x 复位到左边距，
        # 所以紧跟着重新 `set_x(text_left)`。
        pdf.ln(layout.gap_mm(layout.intent_gap))
        pdf.set_x(text_left)
        pdf.multi_cell(
            text_width,
            pdf.line_advance(intent_size),
            intent_text,
            align=header_text_align,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    if contact:
        contact_size = base * layout.contact_ratio * meta_scale
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        # 同上：`.header .contact { margin-top: calc(var(--fs) * N) }`。
        pdf.ln(layout.gap_mm(layout.contact_gap))
        pdf.set_x(text_left)
        pdf.multi_cell(
            text_width,
            pdf.line_advance(contact_size),
            contact,
            align=header_text_align,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    pdf.set_text_color(*pdf.body_text)

    # 页头块的底：文字底与照片底取更靠下者；modern 再补下内边距，其余模板补 padding-bottom 后画底边线。
    header_bottom = max(pdf.get_y(), content_top + photo_span)
    if header_has_bg:
        header_bottom += hdr_pad_y
    if hdr_border_w > 0:
        header_bottom += hdr_pad_bottom
        line_y = header_bottom
        pdf.set_draw_color(*pdf.accent)
        pdf.set_line_width(hdr_border_w)
        pdf.line(layout.margin_left, line_y, PAGE_WIDTH_MM - layout.margin_right, line_y)
    pdf.set_y(header_bottom)

    # ===== 各分区 =====
    # 第一段之前用 header_gap，之后用上一段 section_gap；drawer 接收画布参数（双栏量高时
    # 跑在 measuring 孪生画布上），返回"是否画了东西"（空分区不吃 header_gap）。

    def body(pdf: _ResumePDF, text: str, object_id: str | None = None) -> None:
        """分区正文（一段 multi_cell）。宽度/起点跟列框走；W07 起消费 body 角色/对象覆盖。"""
        body_style = role_style("body", object_id)
        size = base * (float(body_style.font_scale) if body_style is not None and body_style.font_scale else 1.0)
        line_height = base * _PX_TO_MM * (
            float(body_style.line_height)
            if body_style is not None and body_style.line_height
            else layout.line_height
        )
        align = {"left": "L", "center": "C", "right": "R", "justify": "J"}
        pdf.set_font(FONT_FAMILY, "", size * _PX_TO_PT)
        if body_style is not None and body_style.color is not None:
            pdf.set_text_color(*(parse_color(body_style.color) or pdf.body_text))
        if body_style is not None and body_style.space_before is not None:
            pdf.ln(layout.gap_mm(float(body_style.space_before)))
        pdf.set_x(pdf.frame_left)
        pdf.multi_cell(
            pdf.frame_width,
            line_height,
            text,
            align=align.get(str(body_style.align) if body_style is not None else "left", "L"),
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        if body_style is not None and body_style.space_after is not None:
            pdf.ln(layout.gap_mm(float(body_style.space_after)))
        pdf.set_text_color(*pdf.body_text)

    def draw_summary(pdf: _ResumePDF, leading: float) -> bool:
        text = resume.summary.strip()
        if not text:
            return False
        # W08：标题 + 整段摘要整体预留（keep_together）——页尾不留一行孤行，下一页页首也不留。
        pdf.ensure_title_paragraph(text, base, leading_gap=leading, style=role_style("section_title"), body_style=role_style("body"), keep_lines=pagination.section("summary").keep_with_next)
        pdf.section_title(labels["summary"], base, leading_gap=leading, style=role_style("section_title"), section="summary", keep_lines=pagination.section("summary").keep_with_next)
        body(pdf, text)
        return True

    def draw_education(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.education:
            return False
        pdf.section_title(labels["education"], base, leading_gap=leading, style=role_style("section_title"), section="education", keep_lines=pagination.section("education").keep_with_next)
        for index, edu in enumerate(resume.education):
            start_forced_page(pdf, pagination.entry(edu.id), margin_top=layout.margin_top)
            # 同一分区内条目之间的留白 = 模板 `.entry { margin-bottom }`（此前 PDF 没有）。
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            entry_style = role_style("entry_title", edu.id)
            pdf.entry_head(
                _join([edu.school, edu.major], " · "),
                _join([edu.degree, f"{edu.start_date} - {edu.end_date}"], " · "),
                base,
                style=entry_style,
                meta_style=role_style("meta", edu.id), section="education", object_id=edu.id, keep_lines=pagination.entry(edu.id).keep_with_next,
            )
            if edu.gpa:
                pdf.meta_line(f"{fields['gpa']}：{edu.gpa}", base, style=role_style("meta", edu.id))
            if edu.courses:
                pdf.meta_line(f"{fields['courses']}：{sep.join(edu.courses)}", base, style=role_style("meta", edu.id))
            pdf.bullets(edu.achievements, base, style=role_style("body", edu.id), section="education", object_id=edu.id, split_ok=pagination.entry(edu.id).allow_split)
        return True

    def draw_experience(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.experience:
            return False
        pdf.section_title(labels["experience"], base, leading_gap=leading, style=role_style("section_title"), section="experience", keep_lines=pagination.section("experience").keep_with_next)
        for index, exp in enumerate(resume.experience):
            start_forced_page(pdf, pagination.entry(exp.id), margin_top=layout.margin_top)
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            pdf.entry_head(
                _join([exp.company, exp.role], " · "),
                f"{exp.start_date} - {exp.end_date}",
                base,
                style=role_style("entry_title", exp.id),
                meta_style=role_style("meta", exp.id), section="experience", object_id=exp.id, keep_lines=pagination.entry(exp.id).keep_with_next,
            )
            # A4：实践/服务经历的关系类型（空值不画，旧产物不变）。
            kind_line = experience_kind_line(exp.experience_kind, language)
            if kind_line:
                pdf.meta_line(kind_line, base, style=role_style("meta", exp.id))
            pdf.bullets(exp.description, base, style=role_style("body", exp.id), section="experience", object_id=exp.id, split_ok=pagination.entry(exp.id).allow_split)
        return True

    def draw_campus(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.campus_experience:
            return False
        pdf.section_title(labels["campus_experience"], base, leading_gap=leading, style=role_style("section_title"), section="campus_experience", keep_lines=pagination.section("campus_experience").keep_with_next)
        for index, item in enumerate(resume.campus_experience):
            start_forced_page(pdf, pagination.entry(item.id), margin_top=layout.margin_top)
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            pdf.entry_head(
                _join([item.organization, item.role], " · "),
                f"{item.start_date} - {item.end_date}",
                base,
                style=role_style("entry_title", item.id),
                meta_style=role_style("meta", item.id), section="campus_experience", object_id=item.id, keep_lines=pagination.entry(item.id).keep_with_next,
            )
            pdf.bullets(item.description, base, style=role_style("body", item.id), section="campus_experience", object_id=item.id, split_ok=pagination.entry(item.id).allow_split)
        return True

    def draw_projects(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.projects:
            return False
        pdf.section_title(labels["projects"], base, leading_gap=leading, style=role_style("section_title"), section="projects", keep_lines=pagination.section("projects").keep_with_next)
        for index, project in enumerate(resume.projects):
            start_forced_page(pdf, pagination.entry(project.id), margin_top=layout.margin_top)
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            # 项目名在左、`角色 · 时间` 在右（与预览一致；此前把角色并进了左边）。
            pdf.entry_head(
                project.name,
                _join([project.role, f"{project.start_date} - {project.end_date}"], " · "),
                base,
                style=role_style("entry_title", project.id),
                meta_style=role_style("meta", project.id), section="projects", object_id=project.id, keep_lines=pagination.entry(project.id).keep_with_next,
            )
            if project.tech_stack:
                pdf.meta_line(f"{fields['tech_stack']}：{sep.join(project.tech_stack)}", base, style=role_style("meta", project.id))
            # A4 作品项目：成果类型 + 公开链接（空值不画，旧产物不变）。
            project_meta = project_extra_line(project, language)
            if project_meta:
                pdf.meta_line(project_meta, base, style=role_style("meta", project.id))
            project_body = role_style("body", project.id)
            pdf.bullets(project.description, base, style=project_body, section="projects", object_id=project.id, split_ok=pagination.entry(project.id).allow_split)
            pdf.bullets(project.highlights, base, style=project_body, section="projects", object_id=project.id, split_ok=pagination.entry(project.id).allow_split)
        return True

    def draw_skills(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.skills:
            return False
        pdf.section_title(labels["skills"], base, leading_gap=leading, style=role_style("section_title"), section="skills", keep_lines=pagination.section("skills").keep_with_next)
        # 标签文案与预览一致（`level_text`：技能名 + 本语言的等级括号）。用标签绘制而不是
        # 用分隔符连成一行文本——后者在预览里是带底色的小框，导出后却看不出任何标签形状。
        pdf.skill_tags(
            [level_text(skill.name, skill.level, language) for skill in resume.skills],
            base,
            style=role_style("body"),
        )
        return True

    def draw_awards(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.awards:
            return False
        pdf.section_title(labels["awards"], base, leading_gap=leading, style=role_style("section_title"), section="awards", keep_lines=pagination.section("awards").keep_with_next)
        pdf.bullets(
            [_join([award.name, award.date, award.description]) for award in resume.awards],
            base,
            style=role_style("body"),
            section="awards",
        )
        return True

    # 分区顺序由版式配置里的 section_order 决定（见 services/resume/resume_sections.py）。
    # 用字典而不是 if/elif 链：漏一个键时字典会直接 KeyError，而 if 链的表现是
    # "那个分区在 PDF 里默默消失"——同一个错误，早失败比晚失败好。
    drawers: dict[str, SectionDrawer] = {
        "summary": draw_summary,
        "education": draw_education,
        "experience": draw_experience,
        "campus_experience": draw_campus,
        "publications": lambda pdf, leading: draw_publications(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "research_projects": lambda pdf, leading: draw_research_projects(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "patents": lambda pdf, leading: draw_patents(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "credentials": lambda pdf, leading: draw_credentials(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "projects": draw_projects,
        "skills": draw_skills,
        "awards": draw_awards,
    }
    section_keys = [
        key for key in resolved_section_order(format_config) if section_has_content(resume, key)
    ]

    if layout.column_count > 1:
        # 双栏（split）：两两一行并排，行级分页。绘制逻辑与单栏**完全是同一批 drawer**——
        # `columns.render_sections` 只负责"切行 / 量高 / 分页 / 并排放"，见该模块 docstring。
        render_sections(pdf, section_keys, drawers)
        return

    # 单栏：顺序排下来。第一个**非空**分区之前用 `header_gap`（页头的 margin-bottom），
    # 之后每一段之前用 `section_gap`（上一段 `.section` 的 margin-bottom）。
    first_section = True
    for section_key in section_keys:
        start_forced_page(pdf, pagination.section(section_key), margin_top=layout.margin_top)
        leading = layout.header_gap if first_section else layout.section_gap
        if drawers[section_key](pdf, leading):
            first_section = False

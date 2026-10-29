# SPDX-License-Identifier: Apache-2.0
"""绘制编排（``ResumePDF`` 结果对象、字体注册、``_draw_resume`` 主绘制流程）。

页头整段（照片取景 / 装饰 / 姓名-意向-联系方式）拆到 ``header.py``：本文件贴着 500 行
生产代码预算，而页头是"版式计算 + 照片 + 三段文字 + 装饰"的四合一，与"各分区怎么画"
不是同一件事。拆分是纯搬迁，行为零变化（见 ``header.draw_header`` 的 docstring）。

摘要 / 技能 / 语言 / 奖项这四个"短分区"同样拆到 ``short_sections.py``（2026-11，同一件
事：贴着预算）。它们需要同一组上下文（排版参数、角色覆盖、分页计划、摘要用的 ``body``
闭包），因此由本文件的 ``brief()`` 用 ``functools.partial`` 一次绑定，字典里仍是统一的
``drawer(pdf, leading) -> bool`` 形态。同样是纯搬迁，行为零变化。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from ...schemas.resume import ResumeContent
from ..resume.resume_field_layout import resolve_field_layout
from ..resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    field_labels,
    list_separator,
    section_titles,
)
from ..resume.resume_pagination import PaginationPlan
from ..resume.resume_sections import resolved_section_order
from .canvas import _ResumePDF
from .columns import SectionDrawer, render_sections
from .custom_sections import draw_custom
from .fonts import FONT_FAMILY, ResumePDFError
from .header import draw_header
from .layout import _PX_TO_MM, _PX_TO_PT
from .media import _join
from .profile_fields import draw_profile_meta
from .research_render import (
    draw_credentials,
    draw_patents,
    draw_publications,
    draw_research_projects,
    experience_kind_line,
    project_extra_line,
)
from .section_presence import section_has_content
from .short_sections import draw_awards, draw_languages, draw_skills, draw_summary
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
    # W4：条目字段排版域（空字典 = 默认逐字段一行，四个渲染器共用同一份解析）。
    field_layout = resolve_field_layout(format_config)
    # W07：角色/对象覆盖的唯一解析结果（四域入口见 RenderOverrides）。None = 默认路径。
    style = overrides.style if overrides is not None else None
    pagination = overrides.pagination if overrides is not None else PaginationPlan()

    def role_style(role: str, object_id: str | None = None):
        """该角色在对象上下文下的显式覆盖；无覆盖返回 None（= 用模板值）。"""
        if style is None:
            return None
        return style.effective(role, object_id=object_id)

    # ===== 页头（含装饰：底边线 / modern 的浅底色块）=====
    # 绘制细节在 `header.py`（`render.py` 贴着 500 行预算）：照片 contain 取景、页头底色/
    # 底边线、姓名-意向-联系方式三段与 contact_breaks 换行都在那里一次写完。空字段零输出，
    # 所以没有照片/没有联系方式时，页头高度与底边线位置仍是按"没有这一段"算。
    draw_header(
        pdf,
        resume,
        layout=layout,
        base=base,
        fields=fields,
        include_photo=include_photo,
        format_config=format_config,
        role_style=role_style,
    )

    # ===== 各分区 =====
    # 第一段之前用 header_gap，之后用上一段 section_gap；drawer 接收画布参数（双栏量高时
    # 跑在 measuring 孪生画布上），返回"是否画了东西"（空分区不吃 header_gap）。

    def body(pdf: _ResumePDF, text: str, object_id: str | None = None) -> None:
        """分区正文（一段 multi_cell）。宽度/起点跟列框走；W07 起消费 body 角色/对象覆盖。"""
        body_style = role_style("body", object_id)
        size = base * (
            float(body_style.font_scale)
            if body_style is not None and body_style.font_scale
            else 1.0
        )
        line_height = (
            base
            * _PX_TO_MM
            * (
                float(body_style.line_height)
                if body_style is not None and body_style.line_height
                else layout.line_height
            )
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

    # 短分区（摘要 / 技能 / 语言 / 奖项）共用的上下文：绘制细节在 `short_sections.py`
    # （本文件贴着 500 行预算）。它们是纯搬迁，`body` 也一并注入，所以短分区拿到的就是
    # "量的与画的同一份"画布参数，而不是另起一套。
    brief_context = dict(
        resume=resume,
        base=base,
        labels=labels,
        fields=fields,
        language=language,
        role_style=role_style,
        pagination=pagination,
        field_layout=field_layout,
        body=body,
    )

    def brief(drawer, **extra):
        """绑成 ``drawer(pdf, leading)``——与其余 drawer 同一形态，单栏/双栏共用。"""
        return partial(drawer, **brief_context, **extra)

    def draw_education(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.education:
            return False
        pdf.section_title(
            labels["education"],
            base,
            leading_gap=leading,
            style=role_style("section_title"),
            section="education",
            keep_lines=pagination.section("education").keep_with_next,
        )
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
                meta_style=role_style("meta", edu.id),
                section="education",
                object_id=edu.id,
                keep_lines=pagination.entry(edu.id).keep_with_next,
            )
            if edu.gpa:
                pdf.meta_line(f"{fields['gpa']}：{edu.gpa}", base, style=role_style("meta", edu.id))
            if edu.courses:
                pdf.meta_line(
                    f"{fields['courses']}：{sep.join(edu.courses)}",
                    base,
                    style=role_style("meta", edu.id),
                )
            pdf.bullets(
                edu.achievements,
                base,
                style=role_style("body", edu.id),
                section="education",
                object_id=edu.id,
                split_ok=pagination.entry(edu.id).allow_split,
            )
            draw_profile_meta(
                pdf,
                edu,
                "education",
                base=base,
                fields=fields,
                style=role_style("meta", edu.id),
                field_layout=field_layout,
            )
        return True

    def draw_experience(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.experience:
            return False
        pdf.section_title(
            labels["experience"],
            base,
            leading_gap=leading,
            style=role_style("section_title"),
            section="experience",
            keep_lines=pagination.section("experience").keep_with_next,
        )
        for index, exp in enumerate(resume.experience):
            start_forced_page(pdf, pagination.entry(exp.id), margin_top=layout.margin_top)
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            pdf.entry_head(
                _join([exp.company, exp.role], " · "),
                f"{exp.start_date} - {exp.end_date}",
                base,
                style=role_style("entry_title", exp.id),
                meta_style=role_style("meta", exp.id),
                section="experience",
                object_id=exp.id,
                keep_lines=pagination.entry(exp.id).keep_with_next,
            )
            # A4：实践/服务经历的关系类型（空值不画，旧产物不变）。
            kind_line = experience_kind_line(exp.experience_kind, language)
            if kind_line:
                pdf.meta_line(kind_line, base, style=role_style("meta", exp.id))
            pdf.bullets(
                exp.description,
                base,
                style=role_style("body", exp.id),
                section="experience",
                object_id=exp.id,
                split_ok=pagination.entry(exp.id).allow_split,
            )
            draw_profile_meta(
                pdf,
                exp,
                "experience",
                base=base,
                fields=fields,
                style=role_style("meta", exp.id),
                field_layout=field_layout,
            )
        return True

    def draw_campus(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.campus_experience:
            return False
        pdf.section_title(
            labels["campus_experience"],
            base,
            leading_gap=leading,
            style=role_style("section_title"),
            section="campus_experience",
            keep_lines=pagination.section("campus_experience").keep_with_next,
        )
        for index, item in enumerate(resume.campus_experience):
            start_forced_page(pdf, pagination.entry(item.id), margin_top=layout.margin_top)
            if index:
                pdf.ln(layout.gap_mm(layout.entry_gap))
            pdf.entry_head(
                _join([item.organization, item.role], " · "),
                f"{item.start_date} - {item.end_date}",
                base,
                style=role_style("entry_title", item.id),
                meta_style=role_style("meta", item.id),
                section="campus_experience",
                object_id=item.id,
                keep_lines=pagination.entry(item.id).keep_with_next,
            )
            pdf.bullets(
                item.description,
                base,
                style=role_style("body", item.id),
                section="campus_experience",
                object_id=item.id,
                split_ok=pagination.entry(item.id).allow_split,
            )
            draw_profile_meta(
                pdf,
                item,
                "campus_experience",
                base=base,
                fields=fields,
                style=role_style("meta", item.id),
                field_layout=field_layout,
            )
        return True

    def draw_projects(pdf: _ResumePDF, leading: float) -> bool:
        if not resume.projects:
            return False
        pdf.section_title(
            labels["projects"],
            base,
            leading_gap=leading,
            style=role_style("section_title"),
            section="projects",
            keep_lines=pagination.section("projects").keep_with_next,
        )
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
                meta_style=role_style("meta", project.id),
                section="projects",
                object_id=project.id,
                keep_lines=pagination.entry(project.id).keep_with_next,
            )
            if project.tech_stack:
                pdf.meta_line(
                    f"{fields['tech_stack']}：{sep.join(project.tech_stack)}",
                    base,
                    style=role_style("meta", project.id),
                )
            # A4 作品项目：成果类型 + 公开链接（空值不画，旧产物不变）。
            project_meta = project_extra_line(project, language)
            if project_meta:
                pdf.meta_line(project_meta, base, style=role_style("meta", project.id))
            project_body = role_style("body", project.id)
            pdf.bullets(
                project.description,
                base,
                style=project_body,
                section="projects",
                object_id=project.id,
                split_ok=pagination.entry(project.id).allow_split,
            )
            pdf.bullets(
                project.highlights,
                base,
                style=project_body,
                section="projects",
                object_id=project.id,
                split_ok=pagination.entry(project.id).allow_split,
            )
            draw_profile_meta(
                pdf,
                project,
                "projects",
                base=base,
                fields=fields,
                style=role_style("meta", project.id),
                field_layout=field_layout,
            )
        return True

    # 分区顺序由版式配置里的 section_order 决定（见 services/resume/resume_sections.py）。
    # 用字典而不是 if/elif 链：漏一个键时字典会直接 KeyError，而 if 链的表现是
    # "那个分区在 PDF 里默默消失"——同一个错误，早失败比晚失败好。
    drawers: dict[str, SectionDrawer] = {
        "summary": brief(draw_summary),
        "education": draw_education,
        "experience": draw_experience,
        "campus_experience": draw_campus,
        "publications": lambda pdf, leading: draw_publications(
            pdf,
            resume,
            base=base,
            leading=leading,
            labels=labels,
            language=language,
            field_layout=field_layout,
        ),
        "research_projects": lambda pdf, leading: draw_research_projects(
            pdf,
            resume,
            base=base,
            leading=leading,
            labels=labels,
            language=language,
            field_layout=field_layout,
        ),
        "patents": lambda pdf, leading: draw_patents(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "credentials": lambda pdf, leading: draw_credentials(
            pdf, resume, base=base, leading=leading, labels=labels, language=language
        ),
        "projects": draw_projects,
        "skills": brief(draw_skills),
        "languages": brief(draw_languages),
        "awards": brief(draw_awards),
    }
    section_keys = [
        key for key in resolved_section_order(format_config) if section_has_content(resume, key)
    ]

    if layout.column_count > 1:
        # 双栏（split）：两两一行并排，行级分页。绘制逻辑与单栏**完全是同一批 drawer**——
        # `columns.render_sections` 只负责"切行 / 量高 / 分页 / 并排放"，见该模块 docstring。
        render_sections(pdf, section_keys, drawers)
        draw_custom(pdf, resume, base, layout, not section_keys, role_style, body)
        return

    # 单栏：顺序排下来。第一个**非空**分区之前用 `header_gap`（页头的 margin-bottom），
    # 之后每一段之前用 `section_gap`（上一段 `.section` 的 margin-bottom）。
    first_section = True
    for section_key in section_keys:
        start_forced_page(pdf, pagination.section(section_key), margin_top=layout.margin_top)
        leading = layout.header_gap if first_section else layout.section_gap
        if drawers[section_key](pdf, leading):
            first_section = False

    # C2/R-79：自建分区排在 13 个系统分区之后；没有自建分区时零绘制、零字节变化。
    draw_custom(pdf, resume, base, layout, first_section, role_style, body)

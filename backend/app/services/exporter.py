# SPDX-License-Identifier: Apache-2.0
"""简历导出：JSON / Markdown / HTML。

PDF 有两条路：浏览器打印（前端打开导出 HTML 后调用 print，零字体依赖、版式与预览
完全一致），以及服务端直接生成（``pdf_exporter``，可以直接下载，但需要系统中文字体）。
HTML 渲染在这里，同时负责把模板、页数与字号档位写进版式。
"""

import json
import re
import secrets
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from jinja2.sandbox import SandboxedEnvironment

from ..schemas.resume import MAX_RESUME_PAGES, ResumeContent
from .resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    field_labels,
    gender_text,
    level_parens,
    level_text,
    list_separator,
    section_titles,
)
from .resume.resume_sections import DEFAULT_SECTION_ORDER, resolved_section_order
from .resume.resume_template_format import FONT_KEY
from .resume.resume_template_style import style_css, validated_style_config
from .resume.resume_templates import (
    DEFAULT_FONT_SCALE,
    DEFAULT_TEMPLATE,
    font_scale_spec,
    format_css,
    template_spec,
    validated_format_config,
)
from .resume_font_embed import embed_css as embed_font_css

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

# 简历内容来自大模型输出，HTML 模板必须开启自动转义防止 XSS。
# 注意模板文件名是 resume.html.j2，后缀匹配需同时覆盖 .html 与 .j2
_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "j2"]),
)

# 用户自制模板专用：沙箱环境（禁止访问以 _ 开头的属性与任意 Python 对象），
# 但仍保留同一个文件加载器，好让自制模板能 include 共用正文片段。
_sandbox_env = SandboxedEnvironment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "j2"]),
)

_ILLEGAL_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n]+')


def sanitize_filename(name: str) -> str:
    """去除文件名中的非法字符，同时避免 Content-Disposition 注入。"""
    cleaned = _ILLEGAL_FILENAME_CHARS.sub("_", name).strip(" ._")
    return cleaned or "resume"


def build_filename(resume: ResumeContent, suffix: str) -> str:
    parts = [resume.name or "简历", resume.job_intent or "求职简历"]
    date = datetime.now().strftime("%Y%m%d")
    return f"{sanitize_filename('-'.join(parts))}-{date}.{suffix}"


def export_json(resume: ResumeContent) -> str:
    # 照片是内嵌 data URL，放进 JSON 会产生无意义的大字段；其他资料保持完整。
    return json.dumps(resume.model_dump(exclude={"photo"}), ensure_ascii=False, indent=2)


def _join_bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def export_markdown(
    resume: ResumeContent,
    *,
    section_order: list[str] | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> str:
    """导出不包含照片的 Markdown 文本。

    照片是**唯一**的例外（内嵌 data URL，放进文本导出没有意义）。除此之外，凡是预览里会
    出现的内容这里都要有——以前漏掉了性别与出生年：预览页眉显示它们、md 里却查无此项，
    属于"同一份简历两个输出说得不一样"（用户报告的正是这类差异，只是发生在别的输出上）。

    ``language`` 决定七个分区标题与字段前缀的文案，与 PDF / Word / HTML 同源
    （``resume_labels``）；缺省 ``zh-CN``，与历史输出**逐字一致**。语言只换词与分隔符，
    **不换标点风格**：英文产物里仍是 `Objective：…` 这种全角冒号，这是附录 A 已明确接受
    的已知瑕疵（本批不做标点本地化）。
    """
    lines: list[str] = []
    titles = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    header = resume.name
    # 性别在预览里是姓名后缀（与 `_resume_sections.j2` 的位置一致）。
    if resume.gender:
        header += gender_text(resume.gender, language)
    if resume.job_intent:
        header += f" · {resume.job_intent}"
    lines.append(f"# {header}")
    contacts = " | ".join(
        item for item in [resume.phone, resume.email, resume.city, resume.birth_year] if item
    )
    if contacts:
        lines.append(f"{contacts}\n")

    def write_summary() -> None:
        if resume.summary:
            lines.append(f"## {titles['summary']}\n")
            lines.append(f"{resume.summary}\n")

    def write_education() -> None:
        if resume.education:
            lines.append(f"## {titles['education']}\n")
            for edu in resume.education:
                lines.append(
                    f"### {edu.school} · {edu.major} · {edu.degree}（{edu.start_date} - {edu.end_date}）\n"
                )
                if edu.gpa:
                    lines.append(f"- {fields['gpa']}：{edu.gpa}")
                if edu.courses:
                    lines.append(f"- {fields['courses']}：{sep.join(edu.courses)}")
                lines.append(_join_bullets(edu.achievements))
                lines.append("")

    def write_experience() -> None:
        if resume.experience:
            lines.append(f"## {titles['experience']}\n")
            for exp in resume.experience:
                lines.append(
                    f"### {exp.company} · {exp.role}（{exp.start_date} - {exp.end_date}）\n"
                )
                lines.append(_join_bullets(exp.description))
                lines.append("")

    def write_campus_experience() -> None:
        if resume.campus_experience:
            lines.append(f"## {titles['campus_experience']}\n")
            for item in resume.campus_experience:
                lines.append(
                    f"### {item.organization} · {item.role}（{item.start_date} - {item.end_date}）\n"
                )
                lines.append(_join_bullets(item.description))
                lines.append("")

    def write_projects() -> None:
        if resume.projects:
            lines.append(f"## {titles['projects']}\n")
            for project in resume.projects:
                lines.append(
                    f"### {project.name} · {project.role}（{project.start_date} - {project.end_date}）\n"
                )
                if project.tech_stack:
                    lines.append(f"**{fields['tech_stack']}**：{sep.join(project.tech_stack)}")
                lines.append(_join_bullets(project.description))
                lines.append(_join_bullets(project.highlights))
                lines.append("")

    def write_skills() -> None:
        if resume.skills:
            lines.append(f"## {titles['skills']}\n")
            lines.append(
                _join_bullets(
                    level_text(skill.name, skill.level, language) for skill in resume.skills
                )
            )
            lines.append("")

    def write_awards() -> None:
        if resume.awards:
            lines.append(f"## {titles['awards']}\n")
            lines.append(
                _join_bullets(
                    f"{award.name} · {award.date}"
                    + (f" · {award.description}" if award.description else "")
                    for award in resume.awards
                )
            )
            lines.append("")

    writers = {
        "summary": write_summary,
        "education": write_education,
        "experience": write_experience,
        "campus_experience": write_campus_experience,
        "projects": write_projects,
        "skills": write_skills,
        "awards": write_awards,
    }

    # 分区顺序与预览 / PDF / Word 共用同一份定义（见 services/resume/resume_sections.py）。
    # Markdown 与 txt 都从这里出，所以两者的顺序天然一致。
    for section_key in section_order or DEFAULT_SECTION_ORDER:
        writers[section_key]()

    return "\n".join(lines).strip() + "\n"


def normalize_page_limit(value: int) -> int:
    return max(1, min(int(value or 1), MAX_RESUME_PAGES))


def _inject_before(html: str, block: str, marker: str) -> str:
    """把一段内容插到标记之前；标记缺失时追加到末尾（宁可少一层样式，也不要报错）。"""
    if marker in html:
        return html.replace(marker, f"{block}\n{marker}", 1)
    return f"{html}\n{block}"


def _active_font_style(resume: ResumeContent, font_name: str | None = None) -> str:
    """这份简历要内嵌的字体样式（R10 / 项 14）；没有可用字体时返回空串。

    ``font_name`` 来自 ``format_config["font"]``（每份简历自己的选择）；``None`` 表示没设过，
    走设备上当前选中的字体。

    字符集取简历全部可见文本（照片的 data URL 排除在外：几千个 base64 字符没有意义）。
    没有字体时**不输出任何标签**——HTML 里不该出现孤零零的 ``@font-face``。
    """
    text = json.dumps(resume.model_dump(exclude={"photo"}), ensure_ascii=False)
    css = embed_font_css(text, font_name)
    if not css:
        return ""
    return f'<style id="rf-font">\n{css}\n</style>'


def render_html(
    resume: ResumeContent,
    *,
    template: str = DEFAULT_TEMPLATE,
    page_limit: int = 1,
    font_scale: str = DEFAULT_FONT_SCALE,
    format_config: dict | None = None,
    style_config: dict | None = None,
    template_html: str = "",
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> str:
    """渲染简历 HTML。

    ``page_limit`` 决定 body 高度（N × A4），装不下时模板内的探针只标记溢出、
    **不会缩小字号**（2026-10-21 用户要求：参数与纸面严格一致）；
    ``font_scale`` 只改变一个基准像素变量，所有尺寸都由它推算；
    ``format_config`` 是一组受校验的 CSS 覆盖（格式模板）；
    ``template_html`` 非空时用它渲染——那是用户自制的样式模板，走沙箱环境。

    ``language`` 决定纸面上的分区标题与字段前缀，与 PDF / Word / Markdown **同一张表**
    （``resume_labels``）；缺省 ``zh-CN``，与历史输出逐字一致。四个文案上下文
    （``section_titles`` / ``field_labels`` / ``list_separator`` / ``level_parens``）
    **无条件**放进 Jinja 上下文——只在某些分支放会让 ``{{ section_titles.summary }}``
    渲染成空串，也就是"整份简历没有分区标题"这种静默故障。自制模板通过
    ``{% include "_resume_sections.j2" %}`` 同样能取到它们。
    """
    # A per-document nonce authorizes only the fixed A4 fitting script.
    csp_nonce = secrets.token_hex(16)
    spec = template_spec(template)
    scale = font_scale_spec(font_scale)
    style_values = validated_style_config(style_config)
    if spec["name"] == "split" and "column_count" not in style_values:
        style_values["column_count"] = 2
    format_values = validated_format_config(format_config)
    overrides = {**style_values, **format_values}
    base_px = float(scale["base_px"])
    adjust = overrides.get("font_scale_adjust")
    if isinstance(adjust, (int, float)):
        base_px = round(base_px * float(adjust), 2)

    context = {
        "resume": resume,
        "csp_nonce": csp_nonce,
        "page_limit": normalize_page_limit(page_limit),
        "base_px": base_px,
        # 正文分区顺序（页眉不参与）。模板里有页码、A4 适配脚本等同样读这个上下文。
        "resume_section_order": resolved_section_order(overrides),
        "template_config": style_values,
        # 纸面固定文案（分区标题 / 字段前缀 / 分隔符 / 等级括号）。**任何分支都要有**：
        # 模板里写的是 `{{ section_titles.summary }}`，缺了这个键 Jinja 会渲染成空串——
        # 产物看起来只是"没有标题"，不会报错，是最难被发现的一类故障。
        "section_titles": section_titles(language),
        "field_labels": field_labels(language),
        "list_separator": list_separator(language),
        # 等级括号要拆成左右两半：模板得在括号中间放带 `data-resume-path` 的 `<span>`，
        # 前端靠它做「点纸面字段定位编辑」，所以这里不能直接用 `level_text` 的成品字符串。
        "level_parens": level_parens(language),
    }

    if template_html:
        # 用户模板走沙箱环境；它的 `{% include "_resume_sections.j2" %}` 仍能命中内置
        # 目录（沙箱环境带同一个文件加载器），所以自制模板复用全部正文片段。
        html = _sandbox_env.from_string(template_html).render(**context)
        # 导入时已剥离 <script>，这里补回页数自适应脚本：自制模板同样需要它。
        fit_script = _env.get_template("_resume_fit_script.j2").render(**context)
        html = _inject_before(html, fit_script, "</body>")
    else:
        html = _env.get_template(spec["file"]).render(**context)

    css_blocks = [
        style_css(style_values),
        format_css(style_values),
        format_css(format_values),
    ]
    css = "\n".join(block for block in css_blocks if block)
    if css:
        html = _inject_before(html, f"<style>\n{css}\n</style>", "</head>")
    # 字体样式必须**最后**插：风格配置里的 body font-family 也带 !important，
    # 同优先级下后出现的声明生效，否则用户选的字体族会盖掉自定义字体。
    # 字体按**这份简历自己的选择**（`format_config.font`）内嵌；这里读的是
    # `format_values`（已由 `validated_format_config` 白名单化的那一份），
    # 所以不存在的字体文件在到达渲染前就已经被丢弃。
    font_style = _active_font_style(resume, format_values.get(FONT_KEY))
    if font_style:
        html = _inject_before(html, font_style, "</head>")
    return html

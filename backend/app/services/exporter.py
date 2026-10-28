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

from ..schemas.resume import ResumeContent
from ..schemas.resume_generation import mode_page_limit

# Markdown 正文导出（含 TXT 复用的 writers）已迁至 services/resume/markdown_export.py；
# 这里 re-export，保持 "from app.services.exporter import export_markdown" 等既有导入路径不变。
from .resume.markdown_export import export_markdown  # noqa: F401  (re-export：保持既有导入路径)
from .resume.profile_field_lines import profile_field_row_cells
from .resume.resume_contact import CONTACT_BREAKS_KEY, contact_items
from .resume.resume_field_layout import FIELD_LAYOUT_SECTIONS, field_layout_css
from .resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    authors_text,
    credential_detail,
    credential_status_text,
    date_range,
    experience_kind_text,
    field_labels,
    level_parens,
    list_separator,
    normalize_language,
    patent_detail,
    patent_status_text,
    publication_detail,
    publication_status_text,
    section_titles,
)
from .resume.resume_render_overrides import render_overrides_css, resolve_render_overrides
from .resume.resume_rich_text import apply_rich_html, strip_markers
from .resume.resume_sections import resolved_section_order
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
from .resume.resume_visibility import visible_resume
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
    # 文件名是**纯文本消费方**：`**加粗**` 的标记不该出现在用户下载到的文件名里。
    parts = [strip_markers(resume.name) or "简历", strip_markers(resume.job_intent) or "求职简历"]
    date = datetime.now().strftime("%Y%m%d")
    return f"{sanitize_filename('-'.join(parts))}-{date}.{suffix}"


def export_json(resume: ResumeContent) -> str:
    # 照片是内嵌 data URL，放进 JSON 会产生无意义的大字段；其他资料保持完整。
    # 「交付 JSON」是投递产物：隐藏条目按 W06 契约排除（内部快照/备份保留，见
    # resume_visibility）。无隐藏条目时 visible_resume 原样返回，历史字节不变。
    return json.dumps(
        visible_resume(resume).model_dump(exclude={"photo"}), ensure_ascii=False, indent=2
    )


def normalize_page_limit(value: int, mode: str = "resume") -> int:
    """按文档模式夹紧页数（W14）：普通简历 1–3、长 CV 1–10；只有一份实现。"""
    return mode_page_limit(value, mode)


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
    ``format_config`` 是一组受校验的 CSS 覆盖（版式）；
    ``template_html`` 非空时用它渲染——那是用户自制的模板，走沙箱环境。

    ``language`` 决定纸面上的分区标题与字段前缀，与 PDF / Word / Markdown **同一张表**
    （``resume_labels``）；缺省 ``zh-CN``，与历史输出逐字一致。四个文案上下文
    （``section_titles`` / ``field_labels`` / ``list_separator`` / ``level_parens``）
    **无条件**放进 Jinja 上下文——只在某些分支放会让 ``{{ section_titles.summary }}``
    渲染成空串，也就是"整份简历没有分区标题"这种静默故障。自制模板通过
    ``{% include "_resume_sections.j2" %}`` 同样能取到它们。
    """
    # 纸面视角（W06）：隐藏条目从所有 HTML 产物消失——下载的 HTML、分享包、草稿预览、
    # 精确预览的 HTML 全是本函数渲染的，过滤放在这个唯一收口里，四条链路不可能各说各话。
    # 内部快照/备份不经过这里（它们读 record.content），因此保留隐藏正文。
    resume = visible_resume(resume)
    # A per-document nonce authorizes only the fixed A4 fitting script.
    csp_nonce = secrets.token_hex(16)
    spec = template_spec(template)
    # W07/W08/W15：四个扩展域的唯一消费入口（角色/对象覆盖、分页、照片裁剪）。
    # 默认全空 → 不产生任何 CSS、不换照片，产物与改动前逐字节一致。
    render_overrides = resolve_render_overrides(
        template=spec["name"], format_config=format_config, photo=resume.photo
    )
    if render_overrides.photo_crop is not None:
        # 非破坏裁剪：只替换**本次渲染**的照片，content 与库里的原图一个字节都不动。
        resume = resume.model_copy(
            update={"photo": render_overrides.photo_for_render(resume.photo)}
        )
    scale = font_scale_spec(font_scale)
    style_values = validated_style_config(style_config)
    if spec["name"] == "split" and "column_count" not in style_values:
        style_values["column_count"] = 2
    format_values = validated_format_config(format_config)
    overrides = {**style_values, **format_values}
    # W4 条目字段排版：有配置的分区才预计算行（.sub-row 模板分支只读这份结果）；
    # 无配置时 field_rows 为空字典，模板走**原有**逐行标记，产物逐字节不变。
    field_layout = render_overrides.field_layout
    paper_fields = field_labels(language)
    field_rows: dict[str, list] = {}
    for section_key in FIELD_LAYOUT_SECTIONS:
        if section_key not in field_layout:
            continue
        entries = getattr(resume, section_key, ()) or ()
        field_rows[section_key] = [
            profile_field_row_cells(item, section_key, paper_fields, field_layout)
            for item in entries
        ]
    base_px = float(scale["base_px"])
    adjust = overrides.get("font_scale_adjust")
    if isinstance(adjust, (int, float)):
        base_px = round(base_px * float(adjust), 2)

    context = {
        "resume": resume,
        "csp_nonce": csp_nonce,
        # 页数上限只做**最后一道**防御性夹紧：记录/导出路由已按文档模式夹过一次
        # （普通 1–3 / 长 CV 1–10，见 resume_record.default_render_context 与
        # export_routes）。此前这里固定按 resume 模式夹到 3 页，会让 10 页长 CV 的
        # HTML 导出被误截成 3 页高度（A4 §8.6 的"旧 3 页校验误拦"）；改成按长 CV
        # 上限兜底后，普通简历的 1–3 页路径逐字节不变。
        "page_limit": normalize_page_limit(page_limit, "long_cv"),
        "base_px": base_px,
        # `<html lang="{{ language }}">` 的唯一取值点。**无条件注入**（与下面四个文案上下文
        # 同理）：缺键会让自制模板渲染出 `lang=""`，而内置模板会直接报 Undefined。
        # 已经 `normalize_language` 收口，所以未知值 / 空值一律落回 `zh-CN`——默认参数下
        # 产物与今天逐字一致（`lang` 不属于提取文本，黄金基线的指纹不受影响）。
        "language": normalize_language(language),
        # 正文分区顺序（页眉不参与）。模板里有页码、A4 适配脚本等同样读这个上下文。
        "resume_section_order": resolved_section_order(overrides),
        "template_config": style_values,
        # 纸面固定文案（分区标题 / 字段前缀 / 分隔符 / 等级括号）。**任何分支都要有**：
        # 模板里写的是 `{{ section_titles.summary }}`，缺了这个键 Jinja 会渲染成空串——
        # 产物看起来只是"没有标题"，不会报错，是最难被发现的一类故障。
        "section_titles": section_titles(language),
        "field_labels": paper_fields,
        # W4 条目字段排版：field_layout = 解析后的域（模板据此选 .sub-row 分支）；
        # profile_rows = 每个条目按列数/顺序/独占行装箱后的单元格（含字段名）。
        # 两者都**无条件**注入：缺键会让模板的 if 分支静默走错（同 section_titles 的教训）。
        "field_layout": field_layout,
        "profile_rows": field_rows,
        # #3 页眉联系方式：字段顺序 / 文案 / 强制换行都在 `resume_contact` 里定义一次，
        # 模板只负责把 break_before 译成 <br>（强制换行）与 <wbr>（字段间自动换行点）。
        # 旧简历没有 contact_breaks → 只有 <wbr>，行为 = "字段整体不拆行、字段间可换行"。
        "contact_items": contact_items(
            resume, paper_fields, format_values.get(CONTACT_BREAKS_KEY)
        ),
        "list_separator": list_separator(language),
        # 等级括号要拆成左右两半：模板得在括号中间放带 `data-resume-path` 的 `<span>`，
        # 前端靠它做「点纸面字段定位编辑」，所以这里不能直接用 `level_text` 的成品字符串。
        "level_parens": level_parens(language),
        # W14 科研三栏目：状态正名与作者行由模板调用同一份函数（不硬编码中文）。
        "publication_status_text": lambda status: publication_status_text(status, language),
        "patent_status_text": lambda status: patent_status_text(status, language),
        # A4 资格证照与关系类型：同一份正名表（模板不硬编码状态词）。
        "credential_status_text": lambda status: credential_status_text(status, language),
        "credential_detail": lambda credential: credential_detail(credential, language),
        "experience_kind_text": lambda kind: experience_kind_text(kind, language),
        "authors_text": lambda authors: authors_text(authors, language),
        "publication_detail": lambda publication: publication_detail(publication, language),
        "patent_detail": lambda patent: patent_detail(patent, language),
        "date_range": date_range,
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
        render_overrides_css(render_overrides),
        # W4：只在存在条目字段排版配置时注入（默认产物一个字符都不多）。
        field_layout_css(field_layout),
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
    # ===== 字符级加粗的唯一 HTML 收口 =====
    # 八套内置模板、版式缩略图、`/api/resumes/render`、导出 HTML、分享包全部走这个函数，
    # 所以 `**…**` → `<strong>` 只在这里做一次。只处理**文本段**（见
    # `resume_rich_text.apply_rich_html`）：标签属性、注释、`<style>`/`<script>` 一律跳过，
    # 否则样式表里出现 `**` 会把整页写坏。
    return apply_rich_html(html)

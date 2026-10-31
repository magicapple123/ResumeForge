# SPDX-License-Identifier: Apache-2.0
"""简历 HTML 渲染胶水（v2）：content → ResumeDocument → DocumentPlan → Jinja 模板。

为什么单独一层：exporter.py 是四出口的调度门面（格式、文件名、模板参数、字体嵌入、
渲染后处理），HTML 的「文档语义 → 标记」只应有一份实现。v2 起所有模板都变成
「:root 变量 + 主题 CSS + include _resume_document.j2」的外壳，字段位置/顺序/分栏/
条目头布局由 planner 唯一决定，本模块只负责：

* 把入口内容归一成 v2（v1 → converter，只读不写库；见 coerce_document）；
* 纸面视角过滤（hidden 条目 / hidden 文本块 / placement=hidden 字段一律不上纸面，
  与 PDF / Word / Markdown 用同一份 paper_document）；
* 构造模板上下文（plan + 语言分隔符 + 照片 alt + 页标题）并注入结构 CSS。

**不缩字号**：本模块不出现任何缩放系数；字号只有模板 CSS 的 --fs（用户设定的值）。
"""

from __future__ import annotations

from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from jinja2.sandbox import SandboxedEnvironment

from ...schemas.resume_document import ResumeDocument, ResumeItem, document_to_json, parse_document
from ...schemas.resume_document_plan import DocumentPlan
from .resume_contact import CONTACT_BREAKS_KEY
from .resume_labels import field_labels, normalize_language
from .resume_render_overrides import RenderOverrides, render_overrides_css
from .resume_template_catalog import TEMPLATES_DIR
from .resume_template_format import format_css
from .resume_template_style import style_css

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

# 允许出现在 href 里的协议：其余（javascript: / data: 等）一律只渲染文字。
_SAFE_LINK_PREFIXES = ("http://", "https://", "mailto:")

# 灰字段列间距的兜底值（字号倍数）：equal 1.6 / flow 1.2，与 v1 field_layout 的
# default_gap 同一口径（用户没设 gap 时四个出口用同一个默认值，不各写一份）。
DEFAULT_CELL_GAP: dict[str, float] = {"equal": 1.6, "flow": 1.2}


def default_cell_gap(align: str | None) -> float:
    """灰字段列间距兜底：未设置 gap 时按 align 取默认值（字号倍数）。"""
    return DEFAULT_CELL_GAP.get(str(align or "equal"), DEFAULT_CELL_GAP["equal"])


#: inline 板块（技能/语言）里条目内多个字段之间的分隔符（计划 §6.4 的 inline 口径）。
CELL_JOIN = " · "
#: 以左括号开头的 cell 是上一条的“（等级）”延续，不再补条目内分隔符。
_PAREN_PREFIXES = ("（", "(")


def cell_needs_separator(cell) -> bool:
    """inline 条目内：当前 cell 前是否要补 CELL_JOIN（括号延续不补）。"""
    segments = getattr(cell, "segments", ()) or ()
    if not segments:
        return False
    text = str(getattr(segments[0], "text", "") or "").lstrip()
    return not text.startswith(_PAREN_PREFIXES)


def join_cell_texts(texts) -> str:
    """inline 条目内的纯文本拼接（与模板/PDF/Word/Markdown 同一个分隔口径）。"""
    parts: list[str] = []
    for text in texts:
        value = str(text or "")
        if not value:
            continue
        if parts and not value.lstrip().startswith(_PAREN_PREFIXES):
            parts.append(CELL_JOIN)
        parts.append(value)
    return "".join(parts)


def inject_before(html: str, block: str, marker: str) -> str:
    """把一段内容插到标记之前；标记缺失时追加到末尾（宁可少一层样式，也不要报错）。"""
    if marker in html:
        return html.replace(marker, block + "\n" + marker, 1)
    return html + "\n" + block


def safe_link(url: str | None) -> str:
    """只放行 http(s) / mailto 链接；用户数据里的其它协议按纯文本渲染（防 XSS）。"""
    text = str(url or "").strip()
    if not text:
        return ""
    return text if text.lower().startswith(_SAFE_LINK_PREFIXES) else ""


def _looks_like_document(data: dict) -> bool:
    """v2 判据：有 version=2 或同时带 header + sections（v1 没有这两个键）。"""
    return data.get("version") == 2 or ("header" in data and "sections" in data)


def _with_format_contact_breaks(
    document: ResumeDocument, format_config: dict | None
) -> ResumeDocument:
    """format_config.contact_breaks 的兼容兜底：文档自身没有时才采用。

    contact_breaks 在 v2 里是 document.header.contact_breaks（converter 从 v1 的
    format_config 迁入）。但"单格式导出"请求可以只带 format_config.contact_breaks、
    内容已经是 v2（converter 不会重跑），此时必须在这里合并——否则 HTML/PDF/Word 三个
    出口对同一份设置给出不同页眉（bundle 与单格式导出会各说各话）。
    """
    if not isinstance(format_config, dict) or document.header.contact_breaks:
        return document
    breaks = format_config.get(CONTACT_BREAKS_KEY)
    if not isinstance(breaks, (list, tuple)):
        return document
    cleaned = [str(value).strip() for value in breaks if str(value or "").strip()]
    if not cleaned:
        return document
    return document.model_copy(
        update={"header": document.header.model_copy(update={"contact_breaks": cleaned})}
    )


def coerce_document(
    content: Any,
    *,
    language: str | None = None,
    format_config: dict | None = None,
) -> ResumeDocument:
    """把任意入口内容归一成 v2 文档：v2 直接解析；v1 走 converter（读时转换，不写库）。

    content 可以是 v2 dict、ResumeDocument、v1 ResumeContent 或它的 dict 形式。
    这是四个出口共用的唯一入口归一化点——不允许各渲染器自己判断版本。
    """
    if isinstance(content, ResumeDocument):
        return content
    if hasattr(content, "model_dump"):
        data = content.model_dump(mode="json")
    elif isinstance(content, dict):
        data = content
    else:
        raise TypeError(f"无法识别的简历内容类型：{type(content)!r}")
    if _looks_like_document(data):
        return _with_format_contact_breaks(parse_document(data), format_config)
    # v1：converter 的唯一触发点（延迟导入避免循环依赖）。
    from .document_converter import ensure_document_version

    converted = ensure_document_version(data, language=language, format_config=format_config)
    return _with_format_contact_breaks(parse_document(converted), format_config)


def _item_is_visible(item: ResumeItem) -> bool:
    """纸面上的 item：hidden 放置 / 隐藏文本块 / 空值都不上纸面。"""
    placement = getattr(item, "placement", None)
    if placement == "hidden":
        return False
    if getattr(item, "kind", "") == "text":
        return not getattr(item, "hidden", False) and bool(str(item.text or "").strip())
    if getattr(item, "kind", "") == "list":
        hidden = {str(value or "").strip() for value in getattr(item, "hidden_values", ()) or ()}
        return any(
            str(value or "").strip() and str(value).strip() not in hidden for value in item.values
        )
    if getattr(item, "kind", "") == "authors":
        return any(str(author.name or "").strip() for author in item.authors)
    return bool(str(getattr(item, "value", "") or "").strip())


def paper_document(document: ResumeDocument) -> ResumeDocument:
    """纸面视角：隐藏条目 / 隐藏文本 / placement=hidden 字段从文档里剔除。

    这是「hidden = 数据保留、不上纸面」的唯一过滤点：HTML / PDF / Word / Markdown 都以
    paper_document 的结果去规划，四个出口不可能各说各话；源内容（编辑态 / 内部快照）
    不受影响。没有隐藏项时原样返回对象（不复制）。
    """
    changed = False
    sections = []
    for section in document.sections:
        entries = []
        section_changed = False
        for entry in section.entries:
            if entry.hidden:
                section_changed = True
                continue
            items = []
            for item in entry.items:
                if not _item_is_visible(item):
                    section_changed = True
                    continue
                if getattr(item, "kind", "") == "list" and getattr(item, "hidden_values", None):
                    hidden = {
                        str(value or "").strip()
                        for value in item.hidden_values
                        if str(value or "").strip()
                    }
                    values = [value for value in item.values if str(value).strip() not in hidden]
                    if len(values) != len(item.values):
                        section_changed = True
                        item = item.model_copy(update={"values": values})
                        if not values:
                            continue
                items.append(item)
            if len(items) != len(entry.items):
                section_changed = True
                entry = entry.model_copy(update={"items": items})
            if not items:
                section_changed = True
                continue
            entries.append(entry)
        if section_changed:
            changed = True
            section = section.model_copy(update={"entries": entries})
        if not entries and section.kind != "text":
            changed = True
            continue
        sections.append(section)
    if not changed:
        return document
    return document.model_copy(update={"sections": sections})


def document_photo_value(document: ResumeDocument) -> str | None:
    """页眉照片（header 里 placement=photo 的字段值，data URL 或空）。"""
    for item in document.header.items:
        if item.placement == "photo":
            value = str(item.value or "").strip()
            return value or None
    return None


def with_document_photo(document: ResumeDocument, photo: str | None) -> ResumeDocument:
    """派生一份「本次渲染用」的文档：照片换成裁剪后的 data URL（源内容一个字节不动）。"""
    items = []
    placed = False
    for item in document.header.items:
        if item.placement == "photo":
            if photo:
                items.append(item.model_copy(update={"value": photo}))
                placed = True
            continue
        items.append(item)
    if photo and not placed:
        return document
    return document.model_copy(
        update={"header": document.header.model_copy(update={"items": items})}
    )


def document_header_value(document: ResumeDocument, placement: str) -> str:
    """页眉某位置第一条非空值（页标题用：name / subtitle）。"""
    for item in document.header.items:
        if item.placement == placement and str(item.value or "").strip():
            return str(item.value).strip()
    return ""


def document_page_title(document: ResumeDocument) -> str:
    """单文件 HTML 的 <title> 主体（姓名 - 求职意向）；模板在末尾补「 - 简历」。"""
    name = document_header_value(document, "name") or "简历"
    intent = document_header_value(document, "subtitle")
    return f"{name} - {intent}" if intent else name


def document_text_for_font(document: ResumeDocument) -> str:
    """字体子集要覆盖的全部字符：除页眉照片 data URL 以外的所有文本。"""
    parts: list[str] = []
    for item in document.header.items:
        if item.placement == "photo":
            continue
        parts.append(item.value)
        parts.append(item.label)
    for section in document.sections:
        parts.append(section.title)
        for entry in section.entries:
            for item in entry.items:
                parts.append(getattr(item, "label", "") or "")
                parts.append(getattr(item, "value", "") or "")
                parts.append(getattr(item, "text", "") or "")
                parts.extend(str(value) for value in getattr(item, "values", ()) or ())
                parts.extend(
                    str(author.name or "") for author in getattr(item, "authors", ()) or ()
                )
    return "\n".join(part for part in parts if part)


def document_for_delivery(document: ResumeDocument) -> dict:
    """交付 JSON：纸面视角的 v2 文档（不含页眉照片的 data URL）。

    「交付 JSON」是投递产物：hidden 条目/字段按 W06 契约排除（内部快照/备份保存源内容，
    不经过本函数）；照片是内嵌 data URL，放进 JSON 只是几 MB 的噪音。
    """
    paper = paper_document(document)
    data = document_to_json(paper)
    for section in data.get("sections") or []:
        for entry in section.get("entries") or []:
            for item in entry.get("items") or []:
                if item.get("kind") == "list":
                    item.pop("hidden_values", None)
    header = data.get("header")
    if isinstance(header, dict):
        header["items"] = [
            item for item in header.get("items") or [] if item.get("placement") != "photo"
        ]
    return data


# v2 结构样式：条目头三种布局 / 灰字段网格 / 正文段落。集中注入而不是 9 套模板各抄
# 一份：模板只提供主题（:root、字号、颜色、间距），结构与 W07 角色样式都在这里收口；
# 自制模板 include 正文片段时同样拿到这套规则。
_DOCUMENT_CSS = """
  /* ===== v2 文档结构（由 exporter 统一注入；模板只提供主题样式）===== */
  .entry-head .title { flex: 1 1 auto; min-width: 0; }
  .entry-head .meta { flex: 0 1 auto; max-width: 55%; text-align: right; white-space: normal; }
  .entry-head.head-stacked, .entry-head.head-meta_first { display: block; }
  .entry-head.head-stacked .meta, .entry-head.head-meta_first .meta { max-width: none; text-align: left; }
  .entry-head.head-stacked .meta { margin-top: calc(var(--fs) * 0.14); }
  .entry-head.head-meta_first .title { margin-top: calc(var(--fs) * 0.14); }
  /* 灰字段：equal = 网格（跨行列宽一致，solo 独占整行）；flow = 行内顺排。 */
  .sub-grid { display: grid; align-items: baseline; }
  .sub-grid.sub-cols-1 { grid-template-columns: repeat(1, minmax(0, auto)); }
  .sub-grid.sub-cols-2 { grid-template-columns: repeat(2, minmax(0, auto)); }
  .sub-grid.sub-cols-3 { grid-template-columns: repeat(3, minmax(0, auto)); }
  .sub-cell-solo { grid-column: 1 / -1; }
  .sub-flow .sub-cell { margin-right: calc(var(--fs) * 0.4); }
  .sub-flow .sub-cell:last-child { margin-right: 0; }
  /* inline 板块（技能/语言）：一行一个 li，标签形状由模板的 .skill-list / .skill-list li
     决定。这里的 :where() 是零特异性兜底——只给没有主题 CSS 的自制模板补上"标签排成一排"
     的最小结构，内置 9 套模板自己的 .skill-list 规则仍然优先（Q26）。 */
  :where(.skill-list) { list-style: none; margin: 0; padding-left: 0; }
  :where(.skill-list > li) { display: inline-block; margin: 0 calc(var(--fs) * 0.57) calc(var(--fs) * 0.36) 0; }
  .body-paragraph { margin-bottom: calc(var(--fs) * 0.21); }
  .entry .body-paragraph:last-child { margin-bottom: 0; }
  /* 条目级分页（计划 §6.2）：只作用于打印/分页引擎。 */
  .entry-break-before{break-before:page;page-break-before:always}
  .entry-keep{break-inside:avoid;page-break-inside:avoid}
"""


def document_css(plan: DocumentPlan) -> str:
    """v2 文档结构 CSS（plan 里没有需要逐份生成的结构规则；保留入参便于将来扩展）。"""
    if not plan.sections:
        return ""
    return _DOCUMENT_CSS.strip()


def build_context(
    document: ResumeDocument,
    plan: DocumentPlan,
    *,
    page_limit: int,
    base_px: float,
    language: str,
    csp_nonce: str,
    template_config: dict,
) -> dict:
    """模板上下文：模板只读 plan + 展示常量，不接触 v1 字段。"""
    resolved_language = normalize_language(language or document.language)
    return {
        "document_plan": plan,
        "page_title": document_page_title(document),
        "photo_alt": field_labels(resolved_language).get("photo_alt", "照片"),
        "default_cell_gap": default_cell_gap,
        "cell_needs_separator": cell_needs_separator,
        "safe_link": safe_link,
        "template_config": template_config,
        "page_limit": page_limit,
        "base_px": base_px,
        "language": resolved_language,
        "csp_nonce": csp_nonce,
    }


def build_resume_html(
    document: ResumeDocument,
    plan: DocumentPlan,
    *,
    template_file: str,
    page_limit: int,
    base_px: float,
    language: str,
    csp_nonce: str,
    style_values: dict | None = None,
    format_values: dict | None = None,
    render_overrides: RenderOverrides | None = None,
    template_html: str = "",
    template_config: dict | None = None,
) -> str:
    """渲染 HTML（不含字体嵌入与 **加粗** 后处理，那两步是 exporter 的唯一收口）。

    template_html 非空时渲染用户自制模板（沙箱环境），并补回页数探针脚本；自制模板
    的正文契约是 include 正文片段（历史名 _resume_sections.j2，现在是
    _resume_document.j2 的别名）。
    """
    style_values = style_values if isinstance(style_values, dict) else {}
    format_values = format_values if isinstance(format_values, dict) else {}
    context = build_context(
        document,
        plan,
        page_limit=page_limit,
        base_px=base_px,
        language=language,
        csp_nonce=csp_nonce,
        template_config=template_config if template_config is not None else style_values,
    )
    if template_html:
        html = _sandbox_env.from_string(template_html).render(**context)
        # 导入时已剥离 <script>，这里补回页数自适应脚本：自制模板同样需要它。
        html = inject_before(
            html, _env.get_template("_resume_fit_script.j2").render(**context), "</body>"
        )
    else:
        html = _env.get_template(template_file).render(**context)

    css_blocks = [
        style_css(style_values),
        format_css(style_values),
        format_css(format_values),
        render_overrides_css(render_overrides) if render_overrides is not None else "",
        document_css(plan),
    ]
    css = "\n".join(block for block in css_blocks if block)
    if css:
        html = inject_before(html, "<style>\n" + css + "\n</style>", "</head>")
    return html


def new_csp_nonce() -> str:
    """每次渲染一份 nonce（只授权模板里的固定 A4 探针脚本）。"""
    import secrets

    return secrets.token_hex(16)


__all__ = [
    "CELL_JOIN",
    "build_context",
    "build_resume_html",
    "cell_needs_separator",
    "coerce_document",
    "default_cell_gap",
    "document_css",
    "document_for_delivery",
    "document_header_value",
    "document_page_title",
    "document_photo_value",
    "document_text_for_font",
    "inject_before",
    "join_cell_texts",
    "new_csp_nonce",
    "paper_document",
    "safe_link",
    "with_document_photo",
]

# SPDX-License-Identifier: Apache-2.0
"""简历导出：JSON / Markdown / HTML 的统一入口（v2 字段级文档模型）。

PDF 有两条路：浏览器打印（前端打开导出 HTML 后调用 print，零字体依赖、版式与预览
完全一致），以及服务端直接生成（pdf_exporter，可以直接下载，但需要系统中文字体）。
HTML 渲染在这里调度，同时负责把模板、页数与字号档位写进版式。

v2 起本模块的职责只剩「调度」：

* 入口内容先归一成 ResumeDocument（v1 走 document_io 的 converter，读时转换不写库；
  见 document_html.coerce_document）；
* HTML：paper_document（隐藏项不上纸面）→ planner → 模板外壳；
* JSON：直接输出 v2 文档（投递视角，不含照片 data URL）；
* Markdown / TXT：正文由 markdown_export 消费同一份 DocumentPlan 产出。

**不缩字号**：page_limit 只决定 body 高度（N × A4），装不下时模板探针只标记溢出、
不会缩小字号；字体嵌入、模板主题、角色样式注入、**加粗**后处理都在这里收口。
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from ..schemas.resume_generation import mode_page_limit

# Markdown 正文导出（含 TXT 复用的 writers）已迁至 services/resume/markdown_export.py；
# 这里 re-export，保持 "from app.services.exporter import export_markdown" 等既有导入路径不变。
from .resume.document_html import (
    build_resume_html,
    coerce_document,
    document_for_delivery,
    document_header_value,
    document_photo_value,
    document_text_for_font,
    inject_before,
    new_csp_nonce,
    paper_document,
    with_document_photo,
)
from .resume.markdown_export import export_markdown  # noqa: F401  (re-export：保持既有导入路径)
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE, normalize_language
from .resume.resume_render_overrides import resolve_render_overrides
from .resume.resume_rich_text import apply_rich_html, strip_markers
from .resume.resume_template_format import FONT_KEY
from .resume.resume_template_style import validated_style_config
from .resume.resume_templates import (
    DEFAULT_FONT_SCALE,
    DEFAULT_TEMPLATE,
    font_scale_spec,
    template_spec,
    validated_format_config,
)
from .resume_font_embed import embed_css as embed_font_css

_ILLEGAL_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n]+')


def sanitize_filename(name: str) -> str:
    """去除文件名中的非法字符，同时避免 Content-Disposition 注入。"""
    cleaned = _ILLEGAL_FILENAME_CHARS.sub("_", name).strip(" ._")
    return cleaned or "resume"


def _header_text(content, placement: str) -> str:
    """页眉某位置的展示文本（文件名 / 页标题用）；v1 内容先转换再取。"""
    document = coerce_document(content)
    return document_header_value(document, placement)


def build_filename(content, suffix: str) -> str:
    """按「姓名-求职意向-日期」生成下载文件名。

    content 可以是 v1 ResumeContent 或 v2 文档/JSON；文件名是**纯文本消费方**：
    **加粗** 的标记不该出现在用户下载到的文件名里（始终 strip_markers）。
    """
    parts = [
        strip_markers(_header_text(content, "name")) or "简历",
        strip_markers(_header_text(content, "subtitle")) or "求职简历",
    ]
    date = datetime.now().strftime("%Y%m%d")
    return f"{sanitize_filename('-'.join(parts))}-{date}.{suffix}"


def export_json(content) -> str:
    """导出 v2 文档 JSON（投递视角：隐藏条目/字段排除、照片 data URL 不出现）。

    这是简历的**数据交付物**：字段、位置（placement）、版式（section/entry layout）原样
    保留，下游（ATS / 导入 / 备份之外的场景）拿到的就是纸面渲染的同一份数据模型。
    """
    document = paper_document(coerce_document(content))
    return json.dumps(document_for_delivery(document), ensure_ascii=False, indent=2)


def normalize_page_limit(value: int, mode: str = "resume") -> int:
    """按文档模式夹紧页数（W14）：普通简历 1–3、长 CV 1–10；只有一份实现。"""
    return mode_page_limit(value, mode)


def _active_font_style(document, font_name: str | None = None) -> str:
    """这份简历要内嵌的字体样式（R10 / 项 14）；没有可用字体时返回空串。

    font_name 来自 format_config["font"]（每份简历自己的选择）；None 表示没设过，
    走设备上当前选中的字体。字符集取全部可见文本（照片 data URL 排除在外：几千个
    base64 字符没有意义）。没有字体时不输出任何标签——HTML 里不该出现孤零零的
    @font-face。
    """
    text = document_text_for_font(document)
    css = embed_font_css(text, font_name)
    if not css:
        return ""
    return '<style id="rf-font">\n' + css + "\n</style>"


def render_html(
    content,
    *,
    template: str = DEFAULT_TEMPLATE,
    page_limit: int = 1,
    font_scale: str = DEFAULT_FONT_SCALE,
    format_config: dict | None = None,
    style_config: dict | None = None,
    template_html: str = "",
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> str:
    """渲染简历 HTML（草稿预览 / 精确预览 / 导出 HTML 共用这一个收口）。

    page_limit 决定 body 高度（N × A4），装不下时模板内的探针只标记溢出、
    **不会缩小字号**（2026-10-21 用户要求：参数与纸面严格一致）；
    font_scale 只改变一个基准像素变量，所有尺寸都由它推算；
    format_config 是一组受校验的 CSS 覆盖（版式）+ v2 文档布局的兜底来源；
    template_html 非空时用它渲染——那是用户自制的模板，走沙箱环境。

    入口接受 v1 ResumeContent（读时转换）或 v2 文档/JSON：converter 是唯一的版本
    归一化点，四个出口共用，所以同一份旧简历在 HTML / PDF / Word / Markdown 里看到
    的是同一套字段与顺序。
    """
    resolved_language = normalize_language(language)
    # 纸面视角（W06 / v2 hidden）：隐藏条目与隐藏字段从所有 HTML 产物消失。过滤与
    # PDF / Word / Markdown 共用 paper_document（全流程只在规划前过滤一次）。
    document = paper_document(
        coerce_document(content, language=resolved_language, format_config=format_config)
    )
    # A per-document nonce authorizes only the fixed A4 fitting script.
    csp_nonce = new_csp_nonce()
    spec = template_spec(template)
    # W07/W08/W15：四个扩展域的唯一消费入口（角色/对象覆盖、分页、照片裁剪）。
    render_overrides = resolve_render_overrides(
        template=spec["name"], format_config=format_config, photo=document_photo_value(document)
    )
    if render_overrides.photo_crop is not None:
        # 非破坏裁剪：只替换**本次渲染**的照片，content 与库里的原图一个字节都不动。
        document = with_document_photo(
            document, render_overrides.photo_for_render(document_photo_value(document))
        )
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

    # v2：planner 是字段位置/顺序/分栏/条目头布局的唯一真相；模板不再认识任何字段。
    from .resume.document_plan import build_document_plan

    plan = build_document_plan(document, format_config, resolved_language)
    html = build_resume_html(
        document,
        plan,
        template_file=spec["file"],
        page_limit=normalize_page_limit(page_limit, "long_cv"),
        base_px=base_px,
        language=resolved_language,
        csp_nonce=csp_nonce,
        style_values=style_values,
        format_values=format_values,
        render_overrides=render_overrides,
        template_html=template_html,
        template_config=style_values,
    )
    # 字体样式必须**最后**插：风格配置里的 body font-family 也带 !important，
    # 同优先级下后出现的声明生效，否则用户选的字体族会盖掉自定义字体。
    # 字体按**这份简历自己的选择**（format_config.font）内嵌；这里读的是
    # format_values（已由 validated_format_config 白名单化的那一份），所以不存在的
    # 字体文件在到达渲染前就已经被丢弃。
    font_style = _active_font_style(document, format_values.get(FONT_KEY))
    if font_style:
        html = inject_before(html, font_style, "</head>")
    # ===== 字符级加粗的唯一 HTML 收口 =====
    # 全部模板、版式缩略图、/api/resumes/render、导出 HTML、分享包都走这个函数，
    # 所以 **…** → <strong> 只在这里做一次。只处理**文本段**（见
    # resume_rich_text.apply_rich_html）：标签属性、注释、<style>/<script> 一律跳过，
    # 否则样式表里出现 ** 会把整页写坏。
    return apply_rich_html(html)


__all__ = [
    "build_filename",
    "export_json",
    "export_markdown",
    "normalize_page_limit",
    "render_html",
    "sanitize_filename",
]

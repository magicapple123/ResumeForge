# SPDX-License-Identifier: Apache-2.0
"""测量与入口（内容高度 / 自然页数 / build_resume_pdf）。

**这里没有"缩字号把内容塞进一页"这一步**（2026-10-21 用户要求）：按用户设定的字号 /
行距 / 页边距排一遍，超过页数上限就截断到上限（见 truncate.truncate_pdf）并如实标记
overflow，由界面提示用户加页、收紧版式或精简内容。同一套口径在预览侧成立。

v2 起本模块只负责"准备文档 -> 调 planner -> 交给 document_render 画"以及页数/截断结论；
每个分区怎么排由 DocumentPlan 决定，不再有第二份字段拼装。
"""

from __future__ import annotations

import hashlib
import logging
import time

from ...schemas.resume_document import ResumeDocument
from ...schemas.resume_document_plan import DocumentPlan
from ...schemas.resume_generation import LONG_CV_MAX_PAGES, LONG_CV_RESOURCE_BUDGET
from ..resume.document_html import (
    coerce_document,
    document_header_value,
    document_photo_value,
    document_text_for_font,
    paper_document,
    with_document_photo,
)
from ..resume.document_plan import build_document_plan
from ..resume.resume_labels import DEFAULT_RESUME_LANGUAGE, normalize_language
from ..resume.resume_render_overrides import resolve_render_overrides
from ..resume.resume_template_format import FONT_KEY
from . import font_subset
from .canvas import _ResumePDF
from .document_render import draw_document
from .fonts import FONT_ENV_VAR, ResumePDFError, _resolve_font_paths, resolve_font_paths
from .layout import _BODY_TEXT, _MUTED_TEXT, ResumeLayout, resolve_layout
from .render import ResumePDF, _register_fonts
from .theme import (
    resolve_accent,
    resolve_accent_soft,
    resolve_line,
    resolve_muted,
    resolve_text,
)
from .truncate import truncate_pdf

logger = logging.getLogger(__name__)

# 渲染器自己写的装饰字符 —— 它们不来自简历正文，但对纸面是必需的（字体子集必须包含）。
# 字体子集的缓存键是内容签名，所以"先用一个模板渲、再换语言渲"会复用前一趟的字符集；
# 渲染器直接写死的标点（全角冒号、日期连字符、计划里的「；」等）必须无条件收进来。
_EXTRA_PAPER_CHARS = frozenset("·•–：；;（）、-0123456789/第页共{}…")


def _fixed_paper_chars() -> frozenset[str]:
    """纸面上由语言包/渲染器印出、不属于用户正文的字符全集（字体子集必须无条件包含）。"""
    from ..resume.resume_labels import (
        FIELD_LABELS,
        GENDER_PAREN,
        LEVEL_PAREN,
        LIST_SEPARATOR,
        RESUME_LANGUAGES,
        SECTION_TITLES,
    )

    parts: list[str] = ["".join(_EXTRA_PAPER_CHARS)]
    for language in RESUME_LANGUAGES:
        parts.extend(SECTION_TITLES[language].values())
        parts.extend(FIELD_LABELS[language].values())
        parts.append(LIST_SEPARATOR[language])
        parts.append(LEVEL_PAREN[language].replace("{level}", ""))
        parts.append(GENDER_PAREN[language].replace("{gender}", ""))
    return frozenset("".join(parts))


_DECORATIVE_CHARS = _fixed_paper_chars()


def _prepare_document(
    content,
    *,
    format_config: dict | None,
    language: str,
) -> tuple[ResumeDocument, DocumentPlan]:
    """入口内容 -> (纸面文档, plan)：隐藏项/版本都在这里收口。"""
    resolved_language = normalize_language(language)
    document = paper_document(
        coerce_document(content, language=resolved_language, format_config=format_config)
    )
    plan = build_document_plan(document, format_config, resolved_language)
    return document, plan


def _role_style_query(overrides):
    """把 RenderOverrides 收成绘制层的查询函数；None = 模板默认（不做任何覆盖）。"""
    style = overrides.style if overrides is not None else None
    if style is None:
        return None

    def query(role: str, object_id: str | None = None):
        return style.effective(role, object_id=object_id)

    return query


def measure_content_height(
    content,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    regular: str | None = None,
    bold: str | None = None,
    include_photo: bool = True,
    line: tuple[int, int, int] | None = None,
    body_text: tuple[int, int, int] | None = None,
    muted_text: tuple[int, int, int] | None = None,
    accent_soft: tuple[int, int, int] | None = None,
    format_config: dict | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
    overrides=None,
) -> float:
    """量出这份简历在给定版式下的内容高度（mm）。只测量、不决策。"""
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
    _document, plan = _prepare_document(content, format_config=format_config, language=language)
    pdf = _ResumePDF(
        accent,
        layout,
        line=line or (217, 222, 231),
        body_text=body_text or _BODY_TEXT,
        muted_text=muted_text or _MUTED_TEXT,
        accent_soft=accent_soft,
        measuring=True,
    )
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    draw_document(
        pdf, plan, include_photo=include_photo, role_style=_role_style_query(overrides)
    )
    return pdf.get_y() - layout.margin_top


def _continuation_of(overrides):
    """续页信息只在用户真的开了 repeat_name / page_numbers 时启用（默认 None = 零变化）。"""
    if overrides is None:
        return None
    plan = overrides.pagination
    return None if plan.empty else plan


def render_resume_pdf(
    content,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    regular: str | None = None,
    bold: str | None = None,
    include_photo: bool = True,
    line: tuple[int, int, int] | None = None,
    body_text: tuple[int, int, int] | None = None,
    muted_text: tuple[int, int, int] | None = None,
    accent_soft: tuple[int, int, int] | None = None,
    format_config: dict | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
    overrides=None,
) -> ResumePDF:
    """按给定版式真渲染一份 PDF（返回产物本身，不只是页数）。不限页数；截断在渲染之后。"""
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
    document, plan = _prepare_document(content, format_config=format_config, language=language)
    pdf = _ResumePDF(
        accent,
        layout,
        line=line or (217, 222, 231),
        body_text=body_text or _BODY_TEXT,
        muted_text=muted_text or _MUTED_TEXT,
        accent_soft=accent_soft,
        continuation=_continuation_of(overrides),
        resume_name=document_header_value(document, "name"),
    )
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    draw_document(
        pdf, plan, include_photo=include_photo, role_style=_role_style_query(overrides)
    )
    return ResumePDF(
        content=bytes(pdf.output()),
        pages=pdf.pages_count,
        chars=frozenset(pdf.drawn_chars),
        spans=tuple(pdf.spans),
    )


def _content_signature(content, language: str = DEFAULT_RESUME_LANGUAGE) -> tuple[str, str]:
    """这份内容的字符集指纹：所有会画到纸上的文字拼起来做 sha256（照片不算）。"""
    document = coerce_document(content, language=normalize_language(language))
    text = document_text_for_font(document)
    return hashlib.sha256(text.encode("utf-8")).hexdigest(), text


def _render_with_subset_font(
    content,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    fonts: tuple[str, str],
    line: tuple[int, int, int] | None,
    include_photo: bool,
    format_config: dict | None,
    body_text: tuple[int, int, int] | None = None,
    muted_text: tuple[int, int, int] | None = None,
    accent_soft: tuple[int, int, int] | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
    overrides=None,
) -> ResumePDF:
    """优先用"上一趟同内容渲染收来的字符集"裁出的小字体，失败就用全量字体。

    子集只省 fpdf2 解析大字体那几百毫秒：字形、度量、断行规则都没变，产物与全量字体逐字
    几何一致。ResumePDFError 时退回全量字体重排一次——这是加速，绝不能让它让导出失败。
    """
    signature, text = _content_signature(content, language)
    cached = font_subset.charset_for(signature)
    render_fonts = fonts
    if cached:
        candidate = font_subset.subset_font_paths(fonts, cached)
        if candidate is not None:
            render_fonts = candidate
    try:
        rendered = render_resume_pdf(
            content,
            accent=accent,
            layout=layout,
            regular=render_fonts[0],
            bold=render_fonts[1],
            include_photo=include_photo,
            line=line,
            format_config=format_config,
            body_text=body_text,
            muted_text=muted_text,
            accent_soft=accent_soft,
            language=language,
            overrides=overrides,
        )
    except ResumePDFError:
        if render_fonts is fonts:
            raise
        logger.warning("预子集字体渲染失败，退回全量字体重排一次", exc_info=True)
        font_subset.forget_charset(signature)
        # 这份字符集已经证伪，不能再记回去（否则下一趟又拿它重试一次、再付一遍重排的钱）。
        return render_resume_pdf(
            content,
            accent=accent,
            layout=layout,
            regular=fonts[0],
            bold=fonts[1],
            include_photo=include_photo,
            line=line,
            format_config=format_config,
            body_text=body_text,
            muted_text=muted_text,
            accent_soft=accent_soft,
            language=language,
            overrides=overrides,
        )
    payload = rendered.chars.union(text).union(_DECORATIVE_CHARS)
    font_subset.remember_charset(signature, payload)
    font_subset.prewarm(fonts, payload)
    return rendered


def rendered_page_count(
    content,
    *,
    accent: tuple[int, int, int],
    layout: ResumeLayout,
    regular: str | None = None,
    bold: str | None = None,
    include_photo: bool = True,
    line: tuple[int, int, int] | None = None,
    body_text: tuple[int, int, int] | None = None,
    muted_text: tuple[int, int, int] | None = None,
    accent_soft: tuple[int, int, int] | None = None,
    format_config: dict | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> int:
    """真实渲染这份简历，返回它自然排出来的页数（不设上限、不截断）。

    这是"装不装得下"的唯一权威判据：连续内容高会因提前换页（不切断条目）与真实页数
    不同，按连续高判定会说谎（报告 1 页、实际 2 页）。
    """
    return render_resume_pdf(
        content,
        accent=accent,
        layout=layout,
        regular=regular,
        bold=bold,
        include_photo=include_photo,
        line=line,
        format_config=format_config,
        body_text=body_text,
        muted_text=muted_text,
        accent_soft=accent_soft,
        language=language,
    ).pages


def build_resume_pdf(
    content,
    *,
    template: str = "classic",
    page_limit: int = 1,
    font_scale: str = "standard",
    format_config: dict | None = None,
    margin_mm: float | None = None,
    include_photo: bool = True,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> ResumePDF:
    """把简历内容渲染成 PDF —— 完全按用户设定的版式（入口接受 v1 或 v2 内容）。

    版式与预览对齐：默认取所选模板的版式值，用户在「版式」里设过的 line_height /
    page_padding / section_gap 会覆盖它们；margin_mm 是页边距的兼容回落值。

    内容超过所选页数时不再缩字号：先按真实参数排一遍（不限页数）得到自然页数
    pages_needed；装得下就把这一份交出去；装不下则裁到页数上限，overflow=True，
    pages_needed 一并带回，界面据此提示"约需 N 页（上限 M 页），超出的部分不会显示"。
    """
    from ..resume.resume_templates import FONT_SCALES, template_spec, validated_format_config

    resolved_language = normalize_language(language)
    # 投递视角（W06 / v2 hidden）：隐藏项在排版前剔除；页数、溢出标志与产物内容只反映
    # 纸面上真正出现的东西，源内容不动。
    document = paper_document(
        coerce_document(content, language=resolved_language, format_config=format_config)
    )
    # 格式覆盖要先于字体解析：字体本身也是 format_config 的一项，而且要用白名单化之后
    # 的那一份——不存在的字体文件在到这里之前就被丢弃了。
    overrides = validated_format_config(format_config)
    spec = template_spec(template)
    # W07/W08/W15：四域覆盖的唯一入口；照片裁剪用派生图，content 原图一个字节不动。
    render_overrides = resolve_render_overrides(
        template=spec["name"],
        format_config=format_config,
        photo=document_photo_value(document),
    )
    if render_overrides.photo_crop is not None:
        document = with_document_photo(
            document, render_overrides.photo_for_render(document_photo_value(document))
        )
    fonts = resolve_font_paths(overrides.get(FONT_KEY))
    if fonts is None:
        raise ResumePDFError(
            "未找到可用的中文字体，无法在服务端生成 PDF；请用「打印 / 另存为 PDF」导出，"
            f"或设置环境变量 {FONT_ENV_VAR} 指向一个中文 TTF/TTC 字体文件"
        )
    regular, bold = fonts
    scale = FONT_SCALES.get(font_scale) or FONT_SCALES["standard"]
    base = float(scale["base_px"])
    adjust = overrides.get("font_scale_adjust")
    if isinstance(adjust, (int, float)):
        base = round(base * float(adjust), 2)
    accent = resolve_accent(spec["name"], overrides)
    line = resolve_line(spec["name"], overrides)
    body_text = resolve_text(spec["name"], overrides)
    muted_text = resolve_muted(spec["name"], overrides)
    accent_soft = resolve_accent_soft(spec["name"], overrides)

    layout = resolve_layout(
        template=spec["name"], base_px=base, format_config=overrides, margin_mm=margin_mm
    )
    limit = max(1, min(int(page_limit), LONG_CV_MAX_PAGES))
    started = time.monotonic()
    natural = _render_with_subset_font(
        document,
        accent=accent,
        layout=layout,
        line=line,
        include_photo=include_photo,
        format_config=format_config,
        fonts=(regular, bold),
        body_text=body_text,
        muted_text=muted_text,
        accent_soft=accent_soft,
        language=resolved_language,
        overrides=render_overrides,
    )
    elapsed = time.monotonic() - started
    if elapsed > LONG_CV_RESOURCE_BUDGET["max_render_seconds"]:
        # 长 CV 资源预算：超时明确失败，不静默截断、不缩字号（AGENTS 红线）。
        raise ResumePDFError(
            f"按当前设置渲染耗时 {elapsed:.1f}s，超过长 CV 预算 "
            f"{LONG_CV_RESOURCE_BUDGET['max_render_seconds']}s；请精简内容或减少页数后重试"
        )
    pages_needed = natural.pages
    if pages_needed <= limit:
        return ResumePDF(
            content=natural.content,
            pages=pages_needed,
            pages_needed=pages_needed,
            overflow=False,
            chars=natural.chars,
            spans=natural.spans,
        )

    # 超限：裁到上限（宁可截掉尾部，也不要悄悄多给一页）。界面读响应头
    # X-Resume-Overflow / X-Resume-Pages-Needed，日志只有开发者能看到。
    logger.info(
        "PDF 按当前版式需要 %s 页，超出所选上限 %s 页，已截断；请提示用户加页或收紧版式",
        pages_needed,
        limit,
    )
    return ResumePDF(
        content=truncate_pdf(natural.content, limit),
        pages=limit,
        pages_needed=pages_needed,
        overflow=True,
        chars=natural.chars,
        spans=natural.spans,
    )

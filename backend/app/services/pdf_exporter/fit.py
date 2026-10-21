# SPDX-License-Identifier: Apache-2.0
"""测量与入口（内容高度 / 自然页数 / ``build_resume_pdf``）。

**这里没有"缩字号把内容塞进一页"这一步**（2026-10-21 用户要求）。

以前的做法是：装不下就按比例一步步压小字号派生尺寸，直到正文挤进页数上限（下限 0.5 倍）。
它解决的是"导出的页数超出所选页数"，代价却是用户调的 18px 在纸面上变成了 9px——**参数
与呈现不一致**，而且缩到下限还放不下时只得到一句"字号已降到最小"。

现在的口径：**参数是权威**。按用户设定的字号 / 行距 / 页边距排一遍，超过页数上限就
截断到上限（见 `truncate.truncate_pdf`）并如实标记 ``overflow``，由界面提示用户
加页、收紧版式或精简内容。同一套口径在预览侧（`layout.ts` + 模板里的溢出探针）成立。
"""

from __future__ import annotations

import hashlib
import logging

from ...schemas.resume import MAX_RESUME_PAGES, ResumeContent
from ..resume.resume_template_format import FONT_KEY
from . import font_subset
from .canvas import _ResumePDF
from .fonts import FONT_ENV_VAR, ResumePDFError, _resolve_font_paths, resolve_font_paths
from .layout import _BODY_TEXT, _MUTED_TEXT, ResumeLayout, resolve_layout
from .render import ResumePDF, _draw_resume, _register_fonts
from .theme import (
    resolve_accent,
    resolve_accent_soft,
    resolve_line,
    resolve_muted,
    resolve_text,
)
from .truncate import truncate_pdf

logger = logging.getLogger(__name__)

# 渲染器自己写的装饰字符：列表项的「·」圆点、compact 模板标签之间的「·」分隔符。
# 它们**不来自简历正文**，但对用到它们的模板是必需的；而字体字符集是按**内容**缓存的
# （`_content_signature` 不含模板），所以"先用 classic 渲一遍、再切 compact 渲同一份内容"
# 时，缓存的子集里没有「·」，分隔符会静默变成空白（fpdf2 只打一行 missing glyph 警告）。
# 固定并进去即可——两个字符的成本可以忽略。
_DECORATIVE_CHARS = frozenset("·")


def measure_content_height(
    resume: ResumeContent,
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
) -> float:
    """量出这份简历在给定版式下的内容高度（mm）。

    **只测量、不决策**：把自动分页关掉，让内容连续排下来，末尾的 y 减去上页边距就是
    真实内容高度。它回答"这份内容有多高"，与"排几页 / 装不装得下"
    （`rendered_page_count` 与 ``build_resume_pdf``）各管一件事。

    ``line`` 是分隔线颜色（区块标题下划线用），只影响配色、不影响高度；不传则用兜底浅灰。
    """
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
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
    _draw_resume(pdf, resume, include_photo=include_photo, format_config=format_config)
    return pdf.get_y() - layout.margin_top


def render_resume_pdf(
    resume: ResumeContent,
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
) -> ResumePDF:
    """按给定版式**真渲染一份 PDF**（返回产物本身，不只是页数）。

    不限页数：这里回答的是"这份内容按这套参数排出来是什么样、几页"。要按上限截断是
    **渲染之后**的事（`truncate_pdf`），不在这里做——见模块 docstring。
    """
    if regular is None or bold is None:
        fonts = _resolve_font_paths()
        if fonts is None:
            raise ResumePDFError("未找到可用的中文字体，无法在服务端生成 PDF")
        regular, bold = fonts
    pdf = _ResumePDF(
        accent,
        layout,
        line=line or (217, 222, 231),
        body_text=body_text or _BODY_TEXT,
        muted_text=muted_text or _MUTED_TEXT,
        accent_soft=accent_soft,
    )
    _register_fonts(pdf, regular, bold)
    pdf.add_page()
    _draw_resume(pdf, resume, include_photo=include_photo, format_config=format_config)
    return ResumePDF(
        content=bytes(pdf.output()),
        pages=pdf.pages_count,
        chars=frozenset(pdf.drawn_chars),
    )


def _content_signature(resume: ResumeContent) -> tuple[str, str]:
    """这份内容的「字符集指纹」：把所有文字字段拼起来做 sha256。

    为什么不直接用 `canonical_content_sha256(resume.model_dump())`：那份指纹把照片
    data URL（几 MB）也算进去，每趟渲染白花十几毫秒；这里只关心"会画出哪些字"，
    照片一个像素都不影响字形集合。

    返回 ``(指纹, 纯文本)``：纯文本用来给字符集兜底（渲染器某次没画到的栏目，它的字
    仍然在正文里）。
    """
    parts: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key != "photo":
                    walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(resume.model_dump())
    text = "\x1f".join(parts)
    return hashlib.sha256(text.encode("utf-8")).hexdigest(), text


def _render_with_subset_font(
    resume: ResumeContent,
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
) -> ResumePDF:
    """优先用"上一趟同内容渲染收来的字符集"裁出的小字体，失败就用全量字体。

    子集只省掉 fpdf2 解析 19MB 字体的那 ~330ms：字形、度量、断行规则都没变（子集保留
    原字体的 head / hhea / hmtx / glyf），所以产物与全量字体逐字几何一致。

    ``ResumePDFError`` 时**退回全量字体重排一次**并丢掉这份字符集——这是加速，绝不能
    因为它让导出失败。
    """
    signature, text = _content_signature(resume)
    cached = font_subset.charset_for(signature)
    render_fonts = fonts
    if cached:
        candidate = font_subset.subset_font_paths(fonts, cached)
        if candidate is not None:
            render_fonts = candidate
    try:
        rendered = render_resume_pdf(
            resume,
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
        )
    except ResumePDFError:
        if render_fonts is fonts:
            raise
        logger.warning("预子集字体渲染失败，退回全量字体重排一次", exc_info=True)
        font_subset.forget_charset(signature)
        # 直接返回：这份字符集已经证伪，**不能**再记回去，否则下一趟又拿它重试一次、
        # 再付一遍"先失败再重排"的钱。宁可这份内容退回全量字体（就是优化前的样子）。
        return render_resume_pdf(
            resume,
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
        )
    # 记下这一趟画出去的字，并并上正文里的字：万一某个栏目这趟没被画到（照片关闭、
    # 空栏目），它的字下次也还在集合里，不会出现"少一个字"。
    payload = rendered.chars.union(text).union(_DECORATIVE_CHARS)
    font_subset.remember_charset(signature, payload)
    # 顺手在后台把子集裁好：裁剪本身比渲染还贵（~200ms/字体），不能让它落在"下一趟"头上。
    font_subset.prewarm(fonts, payload)
    return rendered


def rendered_page_count(
    resume: ResumeContent,
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
) -> int:
    """真实渲染这份简历，返回它**自然**排出来的页数（不设上限、不截断）。

    **这是"装不装得下"的唯一权威判据**：``measure_content_height`` 量的是**连续内容高度**，
    而真实分页会因 `ensure_space`（不切断条目）提前换页、留下一段空隙——于是"连续高 < 可用高"
    仍可能排出第二页。按连续高判定会**说谎**（报告 1 页、实际 2 页）。
    """
    return render_resume_pdf(
        resume,
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
    ).pages


def build_resume_pdf(
    resume: ResumeContent,
    *,
    template: str = "classic",
    page_limit: int = 1,
    font_scale: str = "standard",
    format_config: dict | None = None,
    margin_mm: float | None = None,
    include_photo: bool = True,
) -> ResumePDF:
    """把结构化简历渲染成 PDF —— **完全按用户设定的版式**。

    版式（行距/页边距/区块间距**与各层级字号比例**）与预览对齐：默认取所选**样式模板**的
    版式值，用户在「格式模板」里设过的 `line_height` / `page_padding` / `section_gap` 会
    覆盖它们；``margin_mm`` 是页边距的**兼容回落值**（只在 ``format_config`` 没给
    ``page_padding`` 时生效，见 ``layout._resolve_margin_mm``）。

    内容超过所选页数时**不再缩字号**（2026-10-21 用户要求）：

    1. 按真实参数排一遍（不限页数），得到自然页数 ``pages_needed``；
    2. 装得下 → 直接把这一份交出去；
    3. 装不下 → 把**这一份**裁到页数上限，``overflow=True``，``pages_needed`` 一并带回，
       界面据此提示"约需 N 页（上限 M 页），超出的部分不会显示"。

    第 3 步以前是"再排一遍、渲染时就停在第 N 页"，那要多走一整趟绘制（本机 ~400ms，
    其中字体解析占大头）。裁页只要 ~3ms，产物在页数 / 溢出口径上完全一致——差异只有
    一处，也是用户 2026-10-21 确认接受的：末页不再有一条字渗进下边距（详见 `truncate`）。
    """
    from ..resume.resume_templates import FONT_SCALES, template_spec, validated_format_config

    # 格式覆盖要先于字体解析：字体本身也是 `format_config` 的一项（项 14），而且要用
    # **白名单化之后**的那一份——不存在的字体文件在到这里之前就被丢弃了。
    overrides = validated_format_config(format_config)
    fonts = resolve_font_paths(overrides.get(FONT_KEY))
    if fonts is None:
        raise ResumePDFError(
            "未找到可用的中文字体，无法在服务端生成 PDF；请用「打印 / 另存为 PDF」导出，"
            f"或设置环境变量 {FONT_ENV_VAR} 指向一个中文 TTF/TTC 字体文件"
        )
    regular, bold = fonts
    spec = template_spec(template)
    scale = FONT_SCALES.get(font_scale) or FONT_SCALES["standard"]
    base = float(scale["base_px"])

    adjust = overrides.get("font_scale_adjust")
    if isinstance(adjust, (int, float)):
        base = round(base * float(adjust), 2)
    accent = resolve_accent(spec["name"], overrides)
    line = resolve_line(spec["name"], overrides)
    # 正文 / 辅助文字 / 强调色浅底同样按模板解析：此前它们是 `layout` 里的模块常量，
    # 模板 `:root` 的 `--text` / `--muted` 与用户的颜色覆盖对 PDF 完全不生效。
    body_text = resolve_text(spec["name"], overrides)
    muted_text = resolve_muted(spec["name"], overrides)
    accent_soft = resolve_accent_soft(spec["name"], overrides)

    layout = resolve_layout(
        template=spec["name"], base_px=base, format_config=overrides, margin_mm=margin_mm
    )
    limit = max(1, min(int(page_limit), MAX_RESUME_PAGES))
    natural = _render_with_subset_font(
        resume,
        accent=accent,
        layout=layout,
        line=line,
        include_photo=include_photo,
        format_config=overrides,
        fonts=(regular, bold),
        body_text=body_text,
        muted_text=muted_text,
        accent_soft=accent_soft,
    )
    pages_needed = natural.pages
    if pages_needed <= limit:
        # 本来就放得下：这一份就是最终产物。
        return ResumePDF(
            content=natural.content,
            pages=pages_needed,
            pages_needed=pages_needed,
            overflow=False,
            chars=natural.chars,
        )

    # 超限：裁到上限（宁可截掉尾部，也不要悄悄多给一页）。
    # 日志只有开发者能看到，界面读的是响应头（`X-Resume-Overflow` / `X-Resume-Pages-Needed`）。
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
    )

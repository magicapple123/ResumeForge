# SPDX-License-Identifier: Apache-2.0
"""通用导出管线：全仓库**唯一**的导出出口。

任何"把一份简历变成可下载文件"的路径都必须经过 :func:`build_export`：先按需脱敏
（``privacy.redact``），再按 ``FORMAT_RENDERERS`` 注册表选格式渲染器，最后可选地做水印
后处理（``watermark.apply_watermark``）。``api/resumes.py`` 不再分支散派格式。

渲染器是**既有实现**的适配壳：json/md/html 复用 ``exporter``，pdf 复用 ``pdf_exporter``，
docx/txt 是 R-16 新增的两个渲染器（Word 复用 ``ResumeLayout``，纯文本复用 Markdown 正文
结构去标记）。管线不新增任何缩放 / 版式逻辑——字号与页边距一律由 `format_config` 决定，
任何渲染器都不许自行压小字号（2026-10-21 用户要求），由既有测试钉住。
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass

from ..schemas.resume import ResumeContent
from ..schemas.resume_generation import UNLIMITED_PAGE_LIMIT, UNLIMITED_RENDER_MAX_PAGES
from .docx_exporter import build_resume_docx
from .exporter import build_filename, export_json, export_markdown, render_html
from .pdf_exporter import build_resume_pdf
from .privacy import RedactionOptions, plain_text_document, redact, redact_document
from .resume.document_truncate import TruncationResult, truncate_for_format
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from .resume.resume_sections import resolved_section_order
from .resume.resume_template_format import validated_format_config
from .txt_exporter import export_txt
from .watermark import apply_watermark


@dataclass(frozen=True)
class ExportRequest:
    """一次导出请求。字段与 ``schemas/export.ExportRequest`` 一一对应，由 API 层转换。

    ``font_scale`` / ``page_limit`` 为 ``None`` 时表示沿用记录里存的值；``margin_mm``
    是**兼容字段**（R1）——只在 ``format_config`` 没给 ``page_padding`` 时作为它的回落值，
    不再单独覆盖页边距。``format_config`` 是本次导出的版式草稿覆盖（可为 None）：给值时
    叠加在记录值之上，让"预览里调过、还没保存"的字号/行距也能进入导出。

    ``language`` 与 ``font_scale`` / ``page_limit`` **同属"请求覆盖记录"**：``None`` =
    用记录里的语言，给值 = 用这次请求的草稿语言。它必须和它们走同一条路，否则"预览切到
    English、导出还是中文"——预览的版式草稿与导出的版式是同一份。
    """

    format: str = "pdf"
    watermark: str = ""
    redact: bool = False
    redact_options: RedactionOptions | None = None
    margin_mm: float | None = None
    font_scale: str | None = None
    page_limit: int | None = None
    format_config: dict | None = None
    language: str | None = None
    include_photo: bool = True


@dataclass(frozen=True)
class RenderContext:
    """渲染器所需、由调用方解析好的版式上下文。

    ``template`` / ``template_html`` 由 ``resume_template_store.resolve_style_template``
    解析一次后传入，避免每个渲染器各解析一次。``margin_mm`` 是页边距的**兼容回落值**
    （见 ``pdf_exporter.layout._resolve_margin_mm``）：``format_config.page_padding``
    在时它一律不生效。``include_photo`` 决定照片是否进入渲染（txt/md/json 本来就不含照片）。

    ``language`` 是**内容级**字段：它决定纸面上印哪个语言的分区标题，所以产物文本会
    跟着变——因此它也必须进 ``render_config_fingerprint``（否则"同一份指纹、两种文字"
    会让交付血缘比对失效）。渲染器只接收这个值，不许自己判断语言，一律走
    ``resume_labels.section_titles(language)``。

    ``page_limit_is_unlimited`` 保住的是**语义**，不是数字：用户选「不限篇幅」时记录里
    存的是 ``0``，而 ``mode_page_limit(0)`` 会把它折成 10 页（那是 PDF 的渲染保护上限）。
    只看 ``page_limit`` 的渲染器无法区分"用户选了 10 页"与"用户选了不限"——前者要裁、
    后者不许裁。所以调用方把**原始请求值是否为 0**单独带进来（1-D 方案 A）。
    """

    template: str = "classic"
    template_html: str = ""
    style_config: dict | None = None
    page_limit: int = 1
    font_scale: str = "standard"
    format_config: dict | None = None
    margin_mm: float | None = None
    include_photo: bool = True
    language: str = DEFAULT_RESUME_LANGUAGE
    #: 原始请求/记录里的页数上限是否为 ``0``（「不限篇幅」）：为真时任何格式都不裁剪。
    page_limit_is_unlimited: bool = False


@dataclass(frozen=True)
class RenderedArtifact:
    """单个格式渲染器的输出。"""

    content: bytes
    media_type: str
    pages: int | None = None
    #: 按当前版式**真实需要**几页（未截断）；只有服务端 PDF 能给出精确值。
    pages_needed: int | None = None
    page_limit: int | None = None
    overflow: bool = False


@dataclass(frozen=True)
class ExportArtifact:
    """管线的最终产物。

    ``truncated`` / ``truncated_at`` 是 1-D 新增的**裁剪事实**：内容因篇幅上限被裁掉时
    为真，并指出裁点（``section/object_id``）。它和 ``overflow`` 说的不是一件事——
    ``overflow`` 是"裁完还在上限之外"（只有分页引擎才有意义），``truncated`` 是"文件里
    少了东西"。界面提示"超出的部分不会出现在文件里"靠的是后者。
    """

    content: bytes
    filename: str
    media_type: str
    pages: int | None = None
    pages_needed: int | None = None
    page_limit: int | None = None
    overflow: bool = False
    truncated: bool = False
    truncated_at: str = ""


def _render_json(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_json(resume).encode("utf-8"),
        media_type="application/json; charset=utf-8",
    )


def _render_markdown(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_markdown(
            resume,
            section_order=resolved_section_order(context.format_config),
            language=context.language,
            format_config=context.format_config,
        ).encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
    )


def _render_html(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=render_html(
            resume,
            template=context.template,
            page_limit=context.page_limit,
            font_scale=context.font_scale,
            format_config=context.format_config,
            style_config=context.style_config,
            template_html=context.template_html,
            language=context.language,
        ).encode("utf-8"),
        media_type="text/html; charset=utf-8",
    )


def _render_pdf(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    pdf = build_resume_pdf(
        resume,
        template=context.template,
        page_limit=context.page_limit,
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
        language=context.language,
    )
    return RenderedArtifact(
        content=pdf.content,
        media_type="application/pdf",
        pages=pdf.pages,
        pages_needed=pdf.pages_needed,
        page_limit=context.page_limit,
        overflow=pdf.overflow,
    )


DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _rendered_docx(docx, context: RenderContext) -> RenderedArtifact:
    """把 ``ResumeDOCX`` 收成管线产物：媒体类型只有这一处定义。

    Word 收敛路径（``document_truncate.truncate_for_format``）会把最后一轮建好的 docx
    一并交回，``build_export`` 直接复用它——同一份文档、同一组参数，重建一遍只会让用户
    多等一次。
    """
    return RenderedArtifact(
        content=docx.content,
        media_type=DOCX_MEDIA_TYPE,
        pages=docx.pages,
        page_limit=context.page_limit,
        overflow=docx.overflow,
    )


def _render_docx(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    docx = build_resume_docx(
        resume,
        template=context.template,
        page_limit=context.page_limit,
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
        language=context.language,
    )
    return _rendered_docx(docx, context)


def _render_txt(resume: ResumeContent | dict, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_txt(
            resume,
            section_order=resolved_section_order(context.format_config),
            language=context.language,
            format_config=context.format_config,
        ).encode("utf-8"),
        media_type="text/plain; charset=utf-8",
    )


# 格式渲染器注册表：新增格式（docx/txt）时在此挂一个渲染器即可，不改管线。
FORMAT_RENDERERS: dict[str, Callable[[ResumeContent | dict, RenderContext], RenderedArtifact]] = {
    "json": _render_json,
    "md": _render_markdown,
    "html": _render_html,
    "pdf": _render_pdf,
    "docx": _render_docx,
    "txt": _render_txt,
}


#: 这两种格式的「最大篇幅」不经过本模块的裁剪：
#: - ``pdf``：``pdf_exporter.fit`` 内部真渲染 + ``truncate_pdf`` 兜底，不额外测量一次；
#: - ``json``：数据交付物，始终完整（导出面板在该格式旁标注了这件事）。
_PAGE_LIMIT_EXEMPT_FORMATS = frozenset(("pdf", "json"))


def _render_with_page_limit(
    fmt: str, document: ResumeContent | dict, context: RenderContext
) -> tuple[RenderedArtifact, TruncationResult | None]:
    """1-D 的唯一收口：**先按篇幅上限裁，再渲染**；返回（产物, 裁剪结论）。

    裁剪结论为 ``None`` 表示这条格式走的是既有路径之一（pdf 自己裁 / json 完整 /
    用户选了「不限篇幅」）。其余格式（docx / html / md / txt）的正文里只保留前 ``N`` 页
    的内容——界面上的「最大篇幅」因此对五个格式是同一个承诺。
    """
    renderer = FORMAT_RENDERERS[fmt]
    if fmt in _PAGE_LIMIT_EXEMPT_FORMATS or context.page_limit_is_unlimited:
        return renderer(document, context), None
    outcome = truncate_for_format(document, context, export_format=fmt)
    if outcome.docx is not None:
        # Word 收敛时已经把最后一轮产物建好了：直接复用，不再建第二遍。
        return _rendered_docx(outcome.docx, context), outcome
    return renderer(outcome.document, context), outcome


def effective_format_config(request: ExportRequest, context: RenderContext) -> dict:
    """本次导出**实际生效**的版式配置：记录值 + 请求里的草稿覆盖。

    请求值过一遍 ``validated_format_config``（未知键丢弃、越界回退）——它来自 HTTP
    请求体，不能因为调用方多塞一个键就影响渲染。**合并方向是"请求覆盖记录"**：预览里
    拖出来的字号系数、行距正是靠这一条进入导出的。
    """
    merged = dict(context.format_config or {})
    merged.update(validated_format_config(request.format_config))
    return merged


def _prepare_for_render(
    request: ExportRequest, resume: ResumeContent | dict
) -> ResumeContent | dict:
    """脱敏 + 版本归一：v2 文档走 v2-native 脱敏，**原样（脱敏后）交给渲染器**。

    四出口（HTML/PDF/Word/Markdown/TXT/JSON）已全部切到 v2 / DocumentPlan 渲染器，
    所以这里不能再把 v2 折成 v1 分析视图——那样会退回按 v1 槽位默认位置重排，用户在
    制作台里改过的字段位置（placement / 顺序 / 隐藏）会在导出里丢失。v1 输入继续走旧
    redact，渲染器自己会做一次 conversion（与读旧记录同一套规则）。
    """
    if isinstance(resume, Mapping):
        if resume.get("version") == 2:
            if request.redact:
                return redact_document(dict(resume), request.redact_options)
            return plain_text_document(dict(resume))
        # 非 v2 的 dict = v1 内容的 dict 形式：``redact`` 只认 v1 模型，先按 v1 校验成模型。
        resume = ResumeContent.model_validate(dict(resume))
    return redact(resume, request.redact_options) if request.redact else resume


def build_export(
    request: ExportRequest,
    resume: ResumeContent | dict,
    context: RenderContext,
) -> ExportArtifact:
    """把一份简历按请求导出成最终产物（脱敏 → 格式渲染 → 可选水印）。

    resume 接受 v1 模型（旧调用方）与 v2 文档 dict（API 切换后 v2 是唯一存储格式）；
    v2 在管线入口做 v2-native 脱敏，再按当前渲染器能力适配。

    **「最大篇幅」在这里收口**（1-D 方案 A）：pdf 走自己的真渲染 + 裁页，json 始终完整，
    「不限篇幅」一个字节都不裁，其余格式先按 PDF 同一套版式测量、按整块裁掉越界内容再
    渲染——界面承诺的「最大篇幅」因此对五个格式是同一件事。
    """
    renderer = FORMAT_RENDERERS.get(request.format)
    if renderer is None:
        raise ValueError(f"不支持的导出格式：{request.format}")

    # 脱敏是可组合的前置步骤（共享知识第 7 条：规则只在 privacy 一份实现）。
    effective_resume = _prepare_for_render(request, resume)

    # 请求里显式给出的版式覆盖优先，否则沿用记录里存的值。
    effective_page_limit = (
        request.page_limit if request.page_limit is not None else context.page_limit
    )
    page_limit_is_unlimited = context.page_limit_is_unlimited or (
        int(effective_page_limit or 0) == UNLIMITED_PAGE_LIMIT
    )
    # 「不限篇幅」的**渲染值**：pdf/word 渲染器都要一个正数 max_pages，而
    # ``pdf_exporter.fit`` 内部是 ``max(1, page_limit)``——把语义值 0 原样交下去，
    # 就等于把"不限"变成最严的 1 页。所以在管线入口折成渲染保护上限；
    # "一个字都不裁"仍由 ``page_limit_is_unlimited`` 决定（下面两处判断都读它）。
    render_page_limit = (
        UNLIMITED_RENDER_MAX_PAGES if page_limit_is_unlimited else effective_page_limit
    )
    effective_context = RenderContext(
        template=context.template,
        template_html=context.template_html,
        style_config=context.style_config,
        page_limit=render_page_limit,
        font_scale=request.font_scale or context.font_scale,
        format_config=effective_format_config(request, context),
        margin_mm=request.margin_mm,
        include_photo=request.include_photo,
        # 语言在这里**必须**跟着走：重建上下文是为了叠加"请求里的版式草稿覆盖"，
        # 漏掉它就会在"预览里拖过字号、还没保存"那条路上悄悄退回中文标题。
        # 请求值优先（``request.language``）：预览里切的语言就是这次导出的语言，
        # 与 ``font_scale`` / ``page_limit`` 同一条覆盖规则；``None`` 才回落记录值。
        language=request.language or context.language,
        # 「不限篇幅」也**必须**跟着走：``page_limit==0`` 会被折成 10（渲染保护上限），
        # 只看数字分不清"选了 10 页"与"选了不限"，那 10 页就会变成裁剪预算。
        page_limit_is_unlimited=page_limit_is_unlimited,
    )
    rendered, limit_outcome = _render_with_page_limit(
        request.format, effective_resume, effective_context
    )
    content = rendered.content
    if request.watermark:
        content = apply_watermark(content, request.watermark, request.format)
    pages_needed = rendered.pages_needed
    if pages_needed is None and limit_outcome is not None:
        # html/md/txt 没有分页引擎，但这次**测量**知道真实需求页数：如实带回去，
        # 界面才能说"按当前设置约需 N 页"，而不是只丢一句"已裁剪"。
        pages_needed = limit_outcome.pages_needed
    # 1-D 补：PDF 的「最大篇幅」由 ``pdf_exporter.fit`` 真的按页裁（``pages_needed >
    # pages`` 就是文件里少了页）。以前只有 ``overflow`` 说这件事——"裁完仍超限"与
    # "文件里确实少了东西"混在同一个标志里：同一份简历 Word 会说"从某板块起没有"、
    # PDF 只说"溢出"，界面读到的口径不一致。
    #
    # 用户选「不限篇幅」时不算裁剪：那条路径上的 10 页是 ``mode_page_limit(0)`` 的
    # **渲染保护上限**（``UNLIMITED_RENDER_MAX_PAGES``），不是用户的篇幅承诺；
    # 报成"已按上限裁剪"等于替用户说他没说过的话。
    pdf_dropped = bool(
        request.format == "pdf"
        and not effective_context.page_limit_is_unlimited
        and rendered.pages_needed
        and rendered.pages
        and rendered.pages_needed > rendered.pages
    )
    truncated = bool(pdf_dropped or (limit_outcome is not None and limit_outcome.truncated))
    truncated_at = ""
    if limit_outcome is not None and limit_outcome.truncated and limit_outcome.cut is not None:
        # PDF 的裁点是"第 N 页起"，没有板块/条目可指——它只报"少了内容"，不报位置。
        truncated_at = limit_outcome.cut.header_value()
    page_limit = rendered.page_limit
    if page_limit is None and truncated:
        # md/txt/html 的渲染器不报页数上限，但**裁过的文件**确实是按这条上限裁的：
        # 界面要用它说"已按 N 页篇幅上限裁剪"，缺了只能显示一个空数字。
        page_limit = effective_context.page_limit
    return ExportArtifact(
        content=content,
        filename=build_filename(effective_resume, request.format),
        media_type=rendered.media_type,
        pages=rendered.pages,
        pages_needed=pages_needed,
        page_limit=page_limit,
        overflow=rendered.overflow,
        truncated=truncated,
        truncated_at=truncated_at,
    )


@dataclass(frozen=True)
class ExportDelivery:
    """带交付标识的导出产物（RF-16）：管线产物 + 不可变交付哈希。

    ``build_export`` 的**并列**出口——既有函数的签名与返回完全不变，现有调用方零破坏；
    需要「交付记录」语义（内容指纹 + 来源 + 渲染配置指纹）的调用方改走本函数。
    交付记录落库属 RF-17，本批只提供纯函数与测试，不改 API 响应与数据库。
    """

    artifact: ExportArtifact
    content_sha256: str
    source_resume_id: int | None = None
    rendered_config_sha256: str = ""


def render_config_fingerprint(request: ExportRequest, context: RenderContext) -> str:
    """把「影响渲染结果」的全部输入序列化成稳定 sha256，用于交付血缘比对。

    覆盖格式、水印、脱敏选项与**生效后**的版式参数（``build_export`` 的覆盖规则：
    请求显式给出的 ``page_limit`` / ``font_scale`` / ``format_config`` 优先于记录值；
    ``margin_mm`` 只在 ``format_config`` 没给 ``page_padding`` 时才有意义，但它照样进
    指纹——同一份请求换了它，「生效后的页边距」也可能跟着换），以及解析后的模板上下文。

    ``language`` 必须在内：它是**内容级**字段，换语言就换掉了纸面上的分区标题，产物
    文本随之改变。不把它算进来，就会出现"配置指纹相同、下载到的文件却是另一种语言"。
    序列化用排序键的紧凑 JSON，保证同一配置稳定出同一指纹。
    """
    payload = {
        "format": request.format,
        "watermark": request.watermark,
        "redact": request.redact,
        "redact_options": asdict(request.redact_options) if request.redact_options else None,
        "margin_mm": request.margin_mm,
        "font_scale": request.font_scale or context.font_scale,
        "page_limit": request.page_limit if request.page_limit is not None else context.page_limit,
        "include_photo": request.include_photo,
        "template": context.template,
        "template_html": context.template_html,
        "style_config": context.style_config or {},
        "format_config": effective_format_config(request, context),
        # 与 ``build_export`` 同一条覆盖规则：请求给了语言就是请求的，否则是记录的。
        # 两处必须一致，否则会出现"产物是英文、指纹却按中文算"的血缘错配。
        "language": request.language or context.language,
        # 「不限篇幅」与数字 10 是**两种产物**（前者一个字都不裁），必须进指纹，
        # 否则预览缓存会把"不限"的完整产物当成"10 页"的裁剪产物命中。
        "page_limit_is_unlimited": context.page_limit_is_unlimited,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_export_delivery(
    request: ExportRequest,
    resume: ResumeContent | dict,
    context: RenderContext,
    *,
    source_resume_id: int | None = None,
) -> ExportDelivery:
    """导出并附带交付标识：内容 sha256、来源简历 ID、渲染配置指纹。"""
    artifact = build_export(request, resume, context)
    return ExportDelivery(
        artifact=artifact,
        content_sha256=hashlib.sha256(artifact.content).hexdigest(),
        source_resume_id=source_resume_id,
        rendered_config_sha256=render_config_fingerprint(request, context),
    )


__all__ = [
    "ExportArtifact",
    "ExportDelivery",
    "ExportRequest",
    "FORMAT_RENDERERS",
    "RenderContext",
    "RenderedArtifact",
    "build_export",
    "build_export_delivery",
    "effective_format_config",
    "render_config_fingerprint",
]

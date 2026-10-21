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
from collections.abc import Callable
from dataclasses import asdict, dataclass

from ..schemas.resume import ResumeContent
from .docx_exporter import build_resume_docx
from .exporter import build_filename, export_json, export_markdown, render_html
from .pdf_exporter import build_resume_pdf
from .privacy import RedactionOptions, redact
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
    """

    format: str = "pdf"
    watermark: str = ""
    redact: bool = False
    redact_options: RedactionOptions | None = None
    margin_mm: float | None = None
    font_scale: str | None = None
    page_limit: int | None = None
    format_config: dict | None = None
    include_photo: bool = True


@dataclass(frozen=True)
class RenderContext:
    """渲染器所需、由调用方解析好的版式上下文。

    ``template`` / ``template_html`` 由 ``resume_template_store.resolve_style_template``
    解析一次后传入，避免每个渲染器各解析一次。``margin_mm`` 是页边距的**兼容回落值**
    （见 ``pdf_exporter.layout._resolve_margin_mm``）：``format_config.page_padding``
    在时它一律不生效。``include_photo`` 决定照片是否进入渲染（txt/md/json 本来就不含照片）。
    """

    template: str = "classic"
    template_html: str = ""
    style_config: dict | None = None
    page_limit: int = 1
    font_scale: str = "standard"
    format_config: dict | None = None
    margin_mm: float | None = None
    include_photo: bool = True


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
    """管线的最终产物。"""

    content: bytes
    filename: str
    media_type: str
    pages: int | None = None
    pages_needed: int | None = None
    page_limit: int | None = None
    overflow: bool = False


def _render_json(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_json(resume).encode("utf-8"),
        media_type="application/json; charset=utf-8",
    )


def _render_markdown(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_markdown(
            resume, section_order=resolved_section_order(context.format_config)
        ).encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
    )


def _render_html(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=render_html(
            resume,
            template=context.template,
            page_limit=context.page_limit,
            font_scale=context.font_scale,
            format_config=context.format_config,
            style_config=context.style_config,
            template_html=context.template_html,
        ).encode("utf-8"),
        media_type="text/html; charset=utf-8",
    )


def _render_pdf(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    pdf = build_resume_pdf(
        resume,
        template=context.template,
        page_limit=context.page_limit,
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
    )
    return RenderedArtifact(
        content=pdf.content,
        media_type="application/pdf",
        pages=pdf.pages,
        pages_needed=pdf.pages_needed,
        page_limit=context.page_limit,
        overflow=pdf.overflow,
    )


def _render_docx(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    docx = build_resume_docx(
        resume,
        template=context.template,
        page_limit=context.page_limit,
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
    )
    return RenderedArtifact(
        content=docx.content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pages=docx.pages,
        page_limit=context.page_limit,
        overflow=docx.overflow,
    )


def _render_txt(resume: ResumeContent, context: RenderContext) -> RenderedArtifact:
    return RenderedArtifact(
        content=export_txt(
            resume, section_order=resolved_section_order(context.format_config)
        ).encode("utf-8"),
        media_type="text/plain; charset=utf-8",
    )


# 格式渲染器注册表：新增格式（docx/txt）时在此挂一个渲染器即可，不改管线。
FORMAT_RENDERERS: dict[str, Callable[[ResumeContent, RenderContext], RenderedArtifact]] = {
    "json": _render_json,
    "md": _render_markdown,
    "html": _render_html,
    "pdf": _render_pdf,
    "docx": _render_docx,
    "txt": _render_txt,
}


def effective_format_config(request: ExportRequest, context: RenderContext) -> dict:
    """本次导出**实际生效**的版式配置：记录值 + 请求里的草稿覆盖。

    请求值过一遍 ``validated_format_config``（未知键丢弃、越界回退）——它来自 HTTP
    请求体，不能因为调用方多塞一个键就影响渲染。**合并方向是"请求覆盖记录"**：预览里
    拖出来的字号系数、行距正是靠这一条进入导出的。
    """
    merged = dict(context.format_config or {})
    merged.update(validated_format_config(request.format_config))
    return merged


def build_export(
    request: ExportRequest,
    resume: ResumeContent,
    context: RenderContext,
) -> ExportArtifact:
    """把一份简历按请求导出成最终产物（脱敏 → 格式渲染 → 可选水印）。"""
    renderer = FORMAT_RENDERERS.get(request.format)
    if renderer is None:
        raise ValueError(f"不支持的导出格式：{request.format}")

    # 脱敏是可组合的前置步骤（共享知识第 7 条：规则只在 privacy 一份实现）。
    effective_resume = redact(resume, request.redact_options) if request.redact else resume

    # 请求里显式给出的版式覆盖优先，否则沿用记录里存的值。
    effective_context = RenderContext(
        template=context.template,
        template_html=context.template_html,
        style_config=context.style_config,
        page_limit=request.page_limit if request.page_limit is not None else context.page_limit,
        font_scale=request.font_scale or context.font_scale,
        format_config=effective_format_config(request, context),
        margin_mm=request.margin_mm,
        include_photo=request.include_photo,
    )
    rendered = renderer(effective_resume, effective_context)
    content = rendered.content
    if request.watermark:
        content = apply_watermark(content, request.watermark, request.format)
    return ExportArtifact(
        content=content,
        filename=build_filename(effective_resume, request.format),
        media_type=rendered.media_type,
        pages=rendered.pages,
        pages_needed=rendered.pages_needed,
        page_limit=rendered.page_limit,
        overflow=rendered.overflow,
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
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_export_delivery(
    request: ExportRequest,
    resume: ResumeContent,
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

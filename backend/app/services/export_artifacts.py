# SPDX-License-Identifier: Apache-2.0
"""导出管线的数据结构：请求/渲染上下文/渲染产物/交付产物。

纯搬迁自 ``export_pipeline.py``：数据类只描述输入输出形状，管线算法
（``build_export`` / ``FORMAT_RENDERERS``）留在原模块。"""

from __future__ import annotations

from dataclasses import dataclass

from .privacy import RedactionOptions
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE


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
    #: 草稿预览专用（§7）：HTML 不按 page_limit 截断；只在 API 层 preview=true 时置真。
    include_overflow_pages: bool = False


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

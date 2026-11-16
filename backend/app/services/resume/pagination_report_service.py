# SPDX-License-Identifier: Apache-2.0
"""分页报告的**唯一编排**（``POST /api/resumes/{id}/pagination/report`` 的业务本体）。

从 ``api/resumes/layout_render_routes.py`` 原样搬入服务层（RF-03b）：该端点的 handler
与助手动作 ``get_resume_status`` 的 ``run`` 必须走同一段编排，而动作层按守卫不许
import ``app.api``。

分层关系：本模块只做**编排**（取记录、解析版式与页数上限、算快照指纹），真正的排版与
截断定位仍在 ``document_pagination.build_pagination_report``（它复用真实 PDF 渲染的
绘制日志——报告与下载的 PDF 必须同源）。搬移时逐条保留了原 handler 的注释，因为那些
注释描述的是"为什么不能写成 ``or``"这类踩过的坑：

- ``page_limit`` 有合法的 falsy 值 ``0``（不限篇幅），判空必须用 ``is not None``；
- 报告的 ``page_limit`` 是**渲染保护上限**，"用户选了不限"由布尔字段单独表达。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...schemas.export import PreviewPdfRequest
from ...schemas.resume import mode_page_limit
from ...schemas.resume_generation import UNLIMITED_PAGE_LIMIT
from ..export_pipeline import (
    ExportRequest,
    RenderContext,
    render_config_fingerprint,
)
from . import document_io
from .document_pagination import build_pagination_report
from .resume_delivery import canonical_content_sha256, page_limit_or_default
from .resume_labels import DEFAULT_RESUME_LANGUAGE
from .resume_read_service import live_resume_or_raise
from .resume_record import record_format_config
from .resume_template_store import (
    resolve_format_config,
    resolve_style_config,
    resolve_style_template,
)
from .resume_templates import validated_format_config


def resume_pagination_report(
    db: Session,
    resume_id: int,
    payload: PreviewPdfRequest,
) -> dict:
    """渲染一次 PDF，返回页数/截断定位/手动分页/两端指纹的报告字典。

    与精确预览**同一条边界**：可以带未保存正文（不落库、不冻结交付、不触发 AI），
    snapshot 两个指纹让前端丢弃过时响应。响应体就是 ``build_pagination_report`` 的字典
    （本端点没有 Pydantic response_model，字段即那份字典的键）。
    """
    record = live_resume_or_raise(db, resume_id)
    document = document_io.document_or_422(
        payload.content if payload.content is not None else record.content,
        db,
        language=record.language or DEFAULT_RESUME_LANGUAGE,
        format_config=record.format_config or {},
    )
    effective_style = payload.template or record.template
    export_template, export_html = resolve_style_template(db, effective_style)
    # 版式解析与精确预览/_export_record 同一条规则：草稿给了版式就只从"模板默认+预设"起步。
    if payload.format_name is None:
        base_format_config = record_format_config(db, record)
    else:
        base_format_config = dict(
            validated_format_config(resolve_style_config(db, effective_style))
        )
        base_format_config.update(resolve_format_config(db, payload.format_name))
    base_format_config.update(validated_format_config(payload.format_config))
    # 页数上限三层：草稿 → 记录 → 缺省。**判空用 ``is not None`` 而不是真值**：
    # 真实值里有一个合法的 falsy —— ``0``（不限篇幅）。写成 ``or`` 会把"用户选了不限"
    # 当成"没传"，回落成记录值；链条末端再 ``or 1`` 更是把不限折成最严的 1 页。
    page_limit_value = (
        payload.page_limit
        if payload.page_limit is not None
        else page_limit_or_default(record.page_limit)
    )
    # 报告的 ``page_limit`` 是**渲染上限**（pdf_exporter.fit 要一个正数 max_pages）：
    # 0 走 mode_page_limit 折成渲染保护上限（10），绝不折成 1；"不许裁剪"由
    # ``page_limit_is_unlimited`` 表达，报告里的 ``truncated_at`` 因此不会误报。
    document_mode = getattr(record, "document_mode", "resume") or "resume"
    page_limit = mode_page_limit(page_limit_value, document_mode)
    page_limit_is_unlimited = page_limit_value == UNLIMITED_PAGE_LIMIT
    font_scale = payload.font_scale or record.font_scale or "standard"
    language = payload.language or record.language or DEFAULT_RESUME_LANGUAGE
    context = RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, effective_style),
        page_limit=page_limit,
        font_scale=font_scale,
        format_config=base_format_config,
        language=language,
        include_photo=payload.include_photo,
        page_limit_is_unlimited=page_limit_is_unlimited,
    )
    return build_pagination_report(
        document,
        template=export_template,
        format_config=base_format_config,
        page_limit=page_limit,
        # 复用上面那份语义标记，**不在这里重算**：0 vs 10 的换算只允许有一处口径。
        # 前端据此把"上限 10 页"改说成"实际 N 页"。
        page_limit_is_unlimited=page_limit_is_unlimited,
        font_scale=font_scale,
        include_photo=payload.include_photo,
        language=language,
        snapshot={
            "content_sha256": canonical_content_sha256(document),
            "render_config_sha256": render_config_fingerprint(
                ExportRequest(
                    format="pdf",
                    page_limit=page_limit,
                    font_scale=font_scale,
                    format_config=base_format_config,
                    language=language,
                    include_photo=payload.include_photo,
                ),
                context,
            ),
        },
    )


__all__ = ["resume_pagination_report"]

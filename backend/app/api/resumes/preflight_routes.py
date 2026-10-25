# SPDX-License-Identifier: Apache-2.0
"""统一检查端点（W11 / P0-04、R03、D20）：POST /api/resumes/{id}/preflight。

只做四件事：加载记录 → 解析生效的正文/版式（草稿覆盖/岗位变体优先）→ 算同一快照指纹 →
交给 services/resume/preflight.run_preflight 编排。规则一律不在路由里写。

**只允许本机前端调用**（与导出同一隐私边界）：检查会把简历正文渲染成产物、把缺字
与正文摘要放进响应，不该暴露给跨站请求。判定复用导出端点的同一对 helper，不另写一份。

D20（purpose=export）额外做两件事：
1. 按前端导出请求（ExportBundleRequest 的投影字段）解析**与导出同一份**内容/排版快照：
   变体解析走 document_variants.resolve_variant_export（与导出路由同一入口），渲染上下文
   走 export_bundle 的同一组构造函数，指纹复用 render_config_fingerprint——这样预检看到
   的正文/版式就是马上要导出的那一份；
2. 响应带 export_summary（目标岗位/文件名/联系方式/版本/隐藏条目/文档模式）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as HTTPRequest
from sqlalchemy.orm import Session

from ...database import get_db
from ...middleware.loopback_origin import is_non_cross_site_request
from ...models.claim import ClaimRecord
from ...schemas.preflight import (
    ExportCheckSummary,
    PreflightOut,
    PreflightRequest,
    PreflightSnapshot,
)
from ...schemas.resume import ResumeContent
from ...services import trash
from ...services.export_pipeline import (
    ExportRequest,
    RenderContext,
    effective_format_config,
    render_config_fingerprint,
)
from ...services.resume import export_bundle as bundle_service
from ...services.resume.document_identity import ENTRY_FIELDS, sanitize_document_ids
from ...services.resume.preflight import run_preflight
from ...services.resume.resume_delivery import canonical_content_sha256
from ...services.resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from ...services.resume.resume_record import record_format_config
from ...services.resume.resume_template_format import validated_format_config
from ...services.resume.resume_template_store import (
    resolve_format_config,
    resolve_style_config,
    resolve_style_template,
)
from ...services.resume.resume_visibility import is_hidden_entry
from ...services.settings_service import get_llm_config
from .. import settings as settings_api
from ._shared import _get_live_resume

router = APIRouter()

# 前端导出请求（ExportBundleRequest）没有显式给 formats 时，导出服务按这个顺序兜底
# （见 export_bundle.build_bundle）；预检必须用同一份，否则指纹对不上。
_DEFAULT_BUNDLE_FORMATS: tuple[str, ...] = ("pdf", "docx", "html", "md", "txt")


def _require_local(request: HTTPRequest) -> None:
    """检查结果含正文摘要与产物文本，只允许本机前端访问（与导出同一口径）。"""
    if not settings_api._is_loopback_request(request) or not is_non_cross_site_request(request):
        raise HTTPException(status_code=403, detail="简历检查仅允许从本机前端访问")


def _resolve_style(db: Session, record, payload: PreflightRequest, variant_options: dict):
    """解析"这次检查按哪一版排版"：变体 → 草稿覆盖 → 记录值。"""
    layout = payload.layout
    template_override = (variant_options or {}).get("template") or (
        layout.template if layout else None
    )
    format_name_override = (variant_options or {}).get("format_name") or (
        layout.format_name if layout else None
    )
    effective_style = template_override or record.template
    export_template, export_html = resolve_style_template(db, effective_style)
    if variant_options:
        # 变体的 layout 是"派生/覆盖后的完整生效快照"（layout_snapshot 结构）：直接作为
        # 基底，不再叠记录里的 format_config——否则等于把变体自己的排版盖回去。
        base_config = dict(validated_format_config(variant_options.get("format_config") or {}))
    elif format_name_override is None:
        base_config = dict(record_format_config(db, record))
    else:
        base_config = dict(validated_format_config(resolve_style_config(db, effective_style)))
        base_config.update(resolve_format_config(db, format_name_override))
    if layout and layout.format_config is not None:
        base_config.update(validated_format_config(layout.format_config))
    # D20：导出请求的 flat 覆盖（前端把导出配置平铺在请求体里；编辑态请求不带这些字段）。
    if payload.format_config is not None:
        base_config.update(validated_format_config(payload.format_config))
    return export_template, export_html, base_config


def _resolve_display_layout(db: Session, record, payload: PreflightRequest, variant_options: dict):
    """响应快照里展示的版式参数：显式覆盖优先，其次变体/记录值。"""
    layout = payload.layout
    variant = variant_options or {}
    page_limit = (
        payload.page_limit
        or (layout.page_limit if layout and layout.page_limit else None)
        or variant.get("page_limit")
        or record.page_limit
    )
    font_scale = (
        payload.font_scale
        or (layout.font_scale if layout and layout.font_scale else None)
        or variant.get("font_scale")
        or record.font_scale
    )
    language = (
        payload.language
        or (layout.language if layout and layout.language else None)
        or variant.get("language")
        or record.language
        or DEFAULT_RESUME_LANGUAGE
    )
    return page_limit, font_scale, language


def _preset_config(db: Session, preset_id: int | None) -> dict:
    """导出预设的兜底配置（与 export_bundle.build_bundle 同一来源，不另写一份）。"""
    if preset_id is None:
        return {}
    from ...services.resume.export_presets import get_preset

    preset = get_preset(db, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="导出配置不存在")
    return dict(preset.config or {})


def _export_request_and_context(
    db: Session,
    record,
    payload: PreflightRequest,
    variant_options: dict,
) -> tuple[ExportRequest, RenderContext, dict]:
    """按导出服务的同一口径构造首个格式的请求与渲染上下文（D20 同快照）。

    这里刻意复用 export_bundle 的 _context / _variant_layout_context：预检要回答的是
    "马上导出的那一份会不会有问题"，两条路径各拼一套上下文必然漂移。
    """
    preset_config = _preset_config(db, payload.preset_id)
    formats = payload.formats or list(
        preset_config.get("formats") or _DEFAULT_BUNDLE_FORMATS
    )
    watermark = payload.watermark or str(preset_config.get("watermark") or "")
    redact = payload.redact if payload.redact is not None else bool(preset_config.get("redact"))
    include_photo = payload.include_photo if payload.include_photo is not None else True
    context = (
        bundle_service._variant_layout_context(db, record, variant_options["layout"])
        if variant_options
        else bundle_service._context(db, record)
    )
    request = ExportRequest(
        format=formats[0],
        watermark=watermark,
        redact=redact,
        margin_mm=payload.margin_mm,
        font_scale=variant_options.get("font_scale", payload.font_scale),
        page_limit=variant_options.get("page_limit", payload.page_limit),
        format_config=variant_options.get("format_config", payload.format_config),
        language=variant_options.get("language", payload.language),
        include_photo=include_photo,
    )
    options = {
        "formats": formats,
        "watermark": watermark,
        "redact": redact,
        "include_photo": include_photo,
    }
    return request, context, options


def _export_snapshot(
    content: ResumeContent, request: ExportRequest, context: RenderContext, record
) -> PreflightSnapshot:
    """D20 快照：content + 与导出首格式完全一致的渲染配置指纹。"""
    return PreflightSnapshot(
        content_sha256=canonical_content_sha256(content.model_dump()),
        render_config_sha256=render_config_fingerprint(request, context),
        template=context.template,
        page_limit=(
            request.page_limit if request.page_limit is not None else context.page_limit
        ),
        font_scale=request.font_scale or context.font_scale,
        language=request.language or context.language,
        document_mode=getattr(record, "document_mode", None) or "resume",
    )


def _hidden_entry_count(content: ResumeContent) -> int:
    """六类/科研条目里被隐藏的条数（D20：导出会排除它们）。"""
    return sum(
        1
        for field in ENTRY_FIELDS
        for entry in (getattr(content, field, None) or [])
        if is_hidden_entry(entry)
    )


def _export_summary(
    record, content: ResumeContent, payload: PreflightRequest
) -> ExportCheckSummary:
    """D20 核对摘要：字段取值与 export_bundle manifest 的 target 块同口径。"""
    revision = int(record.revision or 0)
    document_mode = getattr(record, "document_mode", None) or "resume"
    return ExportCheckSummary(
        target_company=(record.company or "").strip(),
        target_job_title=(record.job_title or "").strip(),
        resume_title=(record.title or "").strip(),
        contact_present=bool((content.phone or "").strip() or (content.email or "").strip()),
        document_mode="long_cv" if document_mode == "long_cv" else "resume",
        revision=revision,
        revision_changed=(
            payload.resume_revision is not None
            and int(payload.resume_revision) != revision
        ),
        hidden_count=_hidden_entry_count(content),
    )


def _resolve_variant_options(db: Session, record, payload: PreflightRequest) -> dict:
    """D20/W16：variant_id → 内容+排版覆盖；无 variant_id 返回空 dict。"""
    if payload.variant_id is None:
        return {}
    return bundle_service.resolve_variant_export_options(db, record, payload)


@router.post("/{resume_id}/preflight", response_model=PreflightOut)
def preflight_resume(
    request: HTTPRequest,
    resume_id: int,
    payload: PreflightRequest,
    db: Session = Depends(get_db),
):
    _require_local(request)
    record = _get_live_resume(db, resume_id)
    variant_options = _resolve_variant_options(db, record, payload)

    if payload.purpose == "export":
        # D20：内容与导出服务同一份（变体快照 / 草稿正文 / 记录正文），并先清理非法 id，
        # 与 build_bundle 的 content 解析逐字一致。
        if variant_options:
            content_source = variant_options.get("content") or {}
        elif payload.content is not None:
            content_source = payload.content.model_dump()
        else:
            content_source = record.content
        content = ResumeContent.model_validate(sanitize_document_ids(content_source) or {})
        export_request, export_context, export_options = _export_request_and_context(
            db, record, payload, variant_options
        )
        snapshot = _export_snapshot(content, export_request, export_context, record)
        template = export_context.template
        page_limit = snapshot.page_limit
        font_scale = snapshot.font_scale
        language = snapshot.language
        format_config = effective_format_config(export_request, export_context)
        redact = bool(export_options["redact"])
    else:
        # 编辑态：行为与 D20 之前逐字一致（不看导出字段，不返回 export_summary）。
        content = (
            ResumeContent.model_validate(payload.content)
            if payload.content is not None
            else ResumeContent.model_validate(record.content)
        )
        export_template, _export_html, format_config = _resolve_style(
            db, record, payload, variant_options
        )
        page_limit, font_scale, language = _resolve_display_layout(
            db, record, payload, variant_options
        )
        context = RenderContext(
            template=export_template,
            template_html=_export_html,
            style_config=resolve_style_config(db, export_template),
            page_limit=page_limit,
            font_scale=font_scale,
            format_config=format_config,
            language=language,
        )
        probe = ExportRequest(
            format="pdf",
            page_limit=page_limit,
            font_scale=font_scale,
            format_config=format_config,
            language=language,
            include_photo=True,
        )
        snapshot = PreflightSnapshot(
            content_sha256=canonical_content_sha256(content.model_dump()),
            render_config_sha256=render_config_fingerprint(probe, context),
            template=export_template,
            page_limit=page_limit,
            font_scale=font_scale,
            language=language,
            document_mode=getattr(record, "document_mode", None) or "resume",
        )
        template = export_template
        redact = False

    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    result = run_preflight(
        content,
        request=payload,
        snapshot=snapshot,
        template=template,
        page_limit=page_limit,
        font_scale=font_scale,
        language=language,
        format_config=format_config,
        claims=claims,
        # "配置了模型"= 有 base_url 与 model 名；只有一条空配置不算（否则界面会把"没配"说成"已查"）。
        model_configured=bool(
            (config := get_llm_config(db)) and config.base_url.strip() and config.model.strip()
        ),
        purpose=payload.purpose,
        redact=redact,
    )
    if payload.purpose != "export":
        return result
    return result.model_copy(
        update={"export_summary": _export_summary(record, content, payload)}
    )


__all__ = ["router"]

# SPDX-License-Identifier: Apache-2.0
"""统一检查端点（W11 / P0-04、R03）：`POST /api/resumes/{id}/preflight`。

只做四件事：加载记录 → 解析生效的正文/版式（草稿覆盖优先）→ 算同一快照指纹 →
交给 `services/resume/preflight.run_preflight` 编排。规则一律不在路由里写。

**只允许本机前端调用**（与导出同一隐私边界）：检查会把简历正文渲染成产物、把缺字
与正文摘要放进响应，不该暴露给跨站请求。判定复用导出端点的同一对 helper，不另写一份。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as HTTPRequest
from sqlalchemy.orm import Session

from ...database import get_db
from ...middleware.loopback_origin import is_non_cross_site_request
from ...models.claim import ClaimRecord
from ...schemas.preflight import PreflightOut, PreflightRequest, PreflightSnapshot
from ...schemas.resume import ResumeContent
from ...services import trash
from ...services.export_pipeline import (
    ExportRequest,
    RenderContext,
    render_config_fingerprint,
)
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
from ...services.settings_service import get_llm_config
from .. import settings as settings_api
from ._shared import _get_live_resume

router = APIRouter()


def _require_local(request: HTTPRequest) -> None:
    """检查结果含正文摘要与产物文本，只允许本机前端访问（与导出同一口径）。"""
    if not settings_api._is_loopback_request(request) or not is_non_cross_site_request(request):
        raise HTTPException(status_code=403, detail="简历检查仅允许从本机前端访问")


def _resolve_style(db: Session, record, payload: PreflightRequest):
    """解析"这次检查按哪一版排版"：草稿覆盖优先，否则记录值。"""
    layout = payload.layout
    template_override = layout.template if layout else None
    format_name_override = layout.format_name if layout else None
    effective_style = template_override or record.template
    export_template, export_html = resolve_style_template(db, effective_style)
    if format_name_override is None:
        base_config = dict(record_format_config(db, record))
    else:
        base_config = dict(validated_format_config(resolve_style_config(db, effective_style)))
        base_config.update(resolve_format_config(db, format_name_override))
    if layout and layout.format_config is not None:
        base_config.update(validated_format_config(layout.format_config))
    return export_template, export_html, base_config


@router.post("/{resume_id}/preflight", response_model=PreflightOut)
def preflight_resume(
    request: HTTPRequest,
    resume_id: int,
    payload: PreflightRequest,
    db: Session = Depends(get_db),
):

    _require_local(request)
    record = _get_live_resume(db, resume_id)
    content = (
        ResumeContent.model_validate(payload.content)
        if payload.content is not None
        else ResumeContent.model_validate(record.content)
    )
    layout = payload.layout
    page_limit = (layout.page_limit if layout and layout.page_limit else None) or record.page_limit
    font_scale = (layout.font_scale if layout and layout.font_scale else None) or record.font_scale
    language = (
        (layout.language if layout and layout.language else None)
        or record.language
        or DEFAULT_RESUME_LANGUAGE
    )
    export_template, export_html, format_config = _resolve_style(db, record, payload)
    context = RenderContext(
        template=export_template,
        template_html=export_html,
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
    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    return run_preflight(
        content,
        request=payload,
        snapshot=snapshot,
        template=export_template,
        page_limit=page_limit,
        font_scale=font_scale,
        language=language,
        format_config=format_config,
        claims=claims,
        # "配置了模型"= 有 base_url 与 model 名；只有一条空配置不算（否则界面会把"没配"说成"已查"）。
        model_configured=bool(
            (config := get_llm_config(db)) and config.base_url.strip() and config.model.strip()
        ),
    )


__all__ = ["router"]

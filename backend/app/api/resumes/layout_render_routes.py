"""简历版式与渲染端点（域⑦）：版式调整、版面诊断与 HTML 渲染。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_to_resume_out` 改从
``_shared`` 导入。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.resume import ResumeRecord
from ...schemas.resume import (
    LayoutAnalyzeOut,
    LayoutAnalyzeRequest,
    LayoutDiagnosisOut,
    LayoutFitCandidateOut,
    LayoutFitRoomOut,
    LayoutPageOut,
    LayoutSuggestionOut,
    ResumeLayoutUpdate,
    ResumeOut,
    ResumeRenderRequest,
)
from ...services import trash
from ...services.exporter import normalize_page_limit, render_html
from ...services.resume.resume_layout import (
    STATUS_OVERFLOW,
    build_fit_ladder,
    diagnose,
    fit_room_report,
)
from ...services.resume.resume_record import (
    record_format_config,
    resolved_format_name,
    resolved_style_name,
)
from ...services.resume.resume_template_store import (
    resolve_format_config,
    resolve_style_config,
    resolve_style_template,
)
from ...services.resume.resume_templates import (
    font_scale_spec,
    validated_format_config,
)
from ._shared import _to_resume_out

logger = logging.getLogger(__name__)

router = APIRouter()


@router.patch("/{resume_id}/layout", response_model=ResumeOut)
def update_resume_layout(
    resume_id: int, payload: ResumeLayoutUpdate, db: Session = Depends(get_db)
):
    """只调整版式参数（模板/页数/字号/按简历的覆盖），不重新生成内容。

    生成后内容偏多时，用户可以先增大页数或缩小字号再渲染，不必重跑模型。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    # 样式模板名按"内置优先，其次用户自制"解析；格式模板单独存一份名字，渲染时再解析成
    # 具体的覆盖配置——这样用户改了格式模板，引用它的简历跟着变。
    record.template = resolved_style_name(db, payload.template)
    record.format_name = resolved_format_name(db, payload.format_name)
    # None = 这次不涉及这一项，保持原样；空字典 = 明确清掉覆盖。
    if payload.format_config is not None:
        record.format_config = validated_format_config(payload.format_config)
    record.page_limit = normalize_page_limit(payload.page_limit)
    record.font_scale = font_scale_spec(payload.font_scale)["name"]
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.post("/{resume_id}/layout/analyze", response_model=LayoutAnalyzeOut)
def analyze_resume_layout(
    resume_id: int, payload: LayoutAnalyzeRequest, db: Session = Depends(get_db)
):
    """根据浏览器量到的实际高度给出版面诊断与逐档收紧方案。

    **高度必须由浏览器提供**：版面只有真正排版之后才存在，后端没有浏览器，也不该为了
    量一个高度去引一个无头浏览器依赖。所以这里的分工是——客户端负责量，规则全在这边。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")

    measure = payload.measure
    current_config = record_format_config(db, record)
    room = fit_room_report(record.template, record.font_scale, current_config)
    diagnosis = diagnose(
        used_height=measure.used_height,
        page_content_height=measure.page_content_height,
        page_limit=measure.page_limit,
        has_fit_room=room["has_room"],
    )
    # 只有真的塞不下才需要给收紧方案：放得下时给一堆"再收紧一点"只会让人白改。
    ladder = (
        build_fit_ladder(record.template, record.font_scale, current_config)
        if diagnosis.status == STATUS_OVERFLOW
        else []
    )
    return LayoutAnalyzeOut(
        diagnosis=LayoutDiagnosisOut(
            status=diagnosis.status,
            status_label=diagnosis.status_label,
            summary=diagnosis.summary,
            fill=diagnosis.fill,
            pages_needed=diagnosis.pages_needed,
            page_limit=diagnosis.page_limit,
            pages=[LayoutPageOut(page=item.page, fill=item.fill) for item in diagnosis.pages],
            suggestions=[
                LayoutSuggestionOut(kind=item.kind, title=item.title, detail=item.detail)
                for item in diagnosis.suggestions
            ],
        ),
        fit_ladder=[
            LayoutFitCandidateOut(
                key=item.key, label=item.label, config=item.config, css=item.css
            )
            for item in ladder
        ],
        fit_room=LayoutFitRoomOut(**room),
    )


@router.post("/render")
def render_resume(payload: ResumeRenderRequest, db: Session = Depends(get_db)):
    """渲染为 HTML（生成完成后、未落库前的即时预览也走这里）。

    传入的模板名既可以是内置模板，也可以是用户自制的样式模板；格式模板同理。
    ``format_config`` 是这次渲染的临时覆盖（叠加在 format_name 之上），
    「自动一页」逐档试版式时用它，试出结果之前不落库。
    """
    template_name, template_html = resolve_style_template(db, payload.template)
    config = dict(resolve_format_config(db, payload.format_name))
    config.update(validated_format_config(payload.format_config))
    return Response(
        render_html(
            payload.content,
            template=template_name,
            page_limit=payload.page_limit,
            font_scale=payload.font_scale,
            format_config=config,
            style_config=resolve_style_config(db, payload.template),
            template_html=template_html,
        ),
        media_type="text/html; charset=utf-8",
    )

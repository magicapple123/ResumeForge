# SPDX-License-Identifier: Apache-2.0
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
from ...services.resume.resume_labels import DEFAULT_RESUME_LANGUAGE
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
    # 模板名按"内置优先，其次用户自制"解析；版式单独存一份名字，渲染时再解析成
    # 具体的覆盖配置——这样用户改了版式，引用它的简历跟着变。
    record.template = resolved_style_name(db, payload.template)
    record.format_name = resolved_format_name(db, payload.format_name)
    # None = 这次不涉及这一项，保持原样；空字典 = 明确清掉覆盖。
    if payload.format_config is not None:
        record.format_config = validated_format_config(payload.format_config)
    record.page_limit = normalize_page_limit(payload.page_limit)
    record.font_scale = font_scale_spec(payload.font_scale)["name"]
    # 语言与本接口的其它字段一样是"整体替换"语义，所以**必须先判 None**：给默认值
    # 就等于"拖动一次字号滑杆把英文简历静默改回中文"，而用户完全看不出发生了什么。
    # None = 这次不涉及，保持原样（见 §9.1 R1）。
    if payload.language is not None:
        record.language = payload.language
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


def _analyzed_format_config(
    db: Session, record: ResumeRecord, payload: LayoutAnalyzeRequest
) -> dict:
    """诊断要看的版式：**草稿优先，记录兜底**。

    与 ``_export_record`` 的 ``template_override`` / ``format_name_override`` 是同一套规则：
    只要前端给了版式名，就从"模板默认 + 该预设"起步、再由草稿的完整覆盖叠加，
    **不再叠记录里的旧覆盖**——用户换预设时前端已经清掉了该预设管辖的键，旧覆盖会把新
    预设又盖回去。

    为什么必须这样：``fit_room`` / ``fit_ladder`` 回答的是"从**现在这一版**再往紧收一档"，
    基准取错就会给出一个用户没在看的版式（改完滑块点「自动一页」反而变松）。
    """
    style = payload.template or record.template
    if payload.format_name is None:
        config = record_format_config(db, record)
    else:
        config = dict(validated_format_config(resolve_style_config(db, style)))
        config.update(resolve_format_config(db, payload.format_name))
    if payload.format_config is not None:
        config.update(validated_format_config(payload.format_config))
    return config


@router.post("/{resume_id}/layout/analyze", response_model=LayoutAnalyzeOut)
def analyze_resume_layout(
    resume_id: int, payload: LayoutAnalyzeRequest, db: Session = Depends(get_db)
):
    """根据浏览器量到的实际高度给出版面诊断与逐档收紧方案。

    **高度必须由浏览器提供**：版面只有真正排版之后才存在，后端没有浏览器，也不该为了
    量一个高度去引一个无头浏览器依赖。所以这里的分工是——客户端负责量，规则全在这边。

    **版式由请求带上**（2026-10-21）：拖完滑块还没保存时，屏幕上那一版就是草稿值。按记录
    值算的话，诊断面板会与预览各说各话——用户改参数、诊断整块不动，或者给出的「自动一页」
    从一个他没在看的版式起步。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")

    measure = payload.measure
    style = payload.template or record.template
    # 字号按"能解析的名字"归一：非法值回落到该档默认，不让一个手写请求体换掉基准。
    font_scale = font_scale_spec(payload.font_scale or record.font_scale)["name"]
    current_config = _analyzed_format_config(db, record, payload)
    room = fit_room_report(style, font_scale, current_config)
    diagnosis = diagnose(
        used_height=measure.used_height,
        page_content_height=measure.page_content_height,
        page_limit=measure.page_limit,
        has_fit_room=room["has_room"],
    )
    # 只有真的塞不下才需要给收紧方案：放得下时给一堆"再收紧一点"只会让人白改。
    ladder = (
        build_fit_ladder(style, font_scale, current_config)
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

    传入的模板名既可以是内置的，也可以是用户自制的；版式同理。
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
            # 不落库的即时预览也要跟着草稿的语言走，否则"选了英文、预览还是中文"。
            # 这里没有记录可回落（本接口只吃请求体），None 就用默认语言。
            language=payload.language or DEFAULT_RESUME_LANGUAGE,
        ),
        media_type="text/html; charset=utf-8",
    )

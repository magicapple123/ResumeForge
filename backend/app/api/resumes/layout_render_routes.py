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
from ...schemas.export import PreviewPdfRequest
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
    mode_page_limit,
)
from ...services import trash
from ...services.export_pipeline import ExportRequest, RenderContext, render_config_fingerprint
from ...services.exporter import normalize_page_limit, render_html
from ...services.resume.content_relevance_hints import build_content_hints
from ...services.resume.document_pagination import build_pagination_report
from ...services.resume.document_save import (
    RevisionConflict,
    revision_conflict_response,
    save_layout,
)
from ...services.resume.resume_delivery import canonical_content_sha256
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
from ...services.resume.resume_sections import persistable_format_config
from ...services.resume.resume_template_store import (
    resolve_format_config,
    resolve_style_config,
    resolve_style_template,
)
from ...services.resume.resume_templates import (
    font_scale_spec,
    validated_format_config,
)
from ._shared import (
    _get_live_resume,
    _to_resume_out,
    document_or_422,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.patch("/{resume_id}/layout", response_model=ResumeOut)
def update_resume_layout(
    resume_id: int, payload: ResumeLayoutUpdate, db: Session = Depends(get_db)
):
    """只调整版式参数（模板/页数/字号/按简历的覆盖），不重新生成内容。

    生成后内容偏多时，用户可以先增大页数或缩小字号再渲染，不必重跑模型。

    **版本（W02）**：带 ``expected_revision`` 就条件写（不匹配 → 409，一个字节都不动），
    不带就无条件写并推进一版（旧行为）。版式与正文共用同一个 ``revision``——拖动滑杆
    也是"改了这份简历"，两个窗口各存一半版式同样会互相覆盖。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    # 模板名按"内置优先，其次用户自制"解析；版式单独存一份名字，渲染时再解析成
    # 具体的覆盖配置——这样用户改了版式，引用它的简历跟着变。
    # W14：文档模式先定，页数上限按模式夹紧（普通 1–3 / 长 CV 1–10；切回普通不静默丢页数）。
    document_mode = payload.document_mode or getattr(record, "document_mode", "resume") or "resume"
    values = {
        "template": resolved_style_name(db, payload.template),
        "format_name": resolved_format_name(db, payload.format_name),
        "page_limit": mode_page_limit(payload.page_limit, document_mode),
        "font_scale": font_scale_spec(payload.font_scale)["name"],
        "document_mode": document_mode,
    }
    # None = 这次不涉及这一项，保持原样；空字典 = 明确清掉覆盖。
    if payload.format_config is not None:
        # T7：v2 记录不再写 v1 的 section_order（唯一真相是 document.sections）。
        # 旧客户端/旧草稿仍可能带这个键：结构落位已由文档自身完成，保存时直接剥离。
        values["format_config"] = validated_format_config(
            persistable_format_config(payload.format_config)
        )
    # 语言与本接口的其它字段一样是"整体替换"语义，所以**必须先判 None**：给默认值
    # 就等于"拖动一次字号滑杆把英文简历静默改回中文"，而用户完全看不出发生了什么。
    # None = 这次不涉及，保持原样（见 §9.1 R1）。
    if payload.language is not None:
        values["language"] = payload.language
    # 版式保存成功 = 这份简历"存在了"：制作台草稿到这一步才进简历中心（0051）。
    # 转正与 revision+1 在 ``save_layout`` 的同一条 UPDATE 里，不会拆成两次写。
    try:
        outcome = save_layout(
            db,
            record_id=record.id,
            values=values,
            expected_revision=payload.expected_revision,
        )
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    if outcome is None:  # 竞态：读到之后被删
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return _to_resume_out(outcome.record)


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
    # W09 内容精简候选：本地确定性计算（不调模型、不落库）。没有岗位/没有稳定 id 时
    # 返回空列表；诊断本身不依赖它，读失败也不能拖垮版面诊断。
    try:
        content_hints = build_content_hints(db, record)
    except Exception:  # noqa: BLE001 - 提示是锦上添花，不能拖垮版面诊断
        logger.warning("内容精简候选计算失败 record_id=%s", resume_id, exc_info=True)
        content_hints = []
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
            LayoutFitCandidateOut(key=item.key, label=item.label, config=item.config, css=item.css)
            for item in ladder
        ],
        fit_room=LayoutFitRoomOut(**room),
        content_hints=content_hints,
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
    # 渲染入口收口：请求体可能是 v1 旧草稿或 v2 文档；渲染器自己负责唯一的
    # v1 -> v2 兼容转换，v2 草稿保持原样进入 planner，不能绕回 v1 分析视图。
    # 结构不合法（例如非法照片 data URL）统一 422 + 可读提示，不冒泡成 500。
    document = document_or_422(
        payload.content,
        db,
        language=payload.language or DEFAULT_RESUME_LANGUAGE,
        format_config=config,
    )
    return Response(
        render_html(
            document,
            template=template_name,
            page_limit=normalize_page_limit(payload.page_limit, payload.document_mode),
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


@router.post("/{resume_id}/pagination/report")
def pagination_report(resume_id: int, payload: PreviewPdfRequest, db: Session = Depends(get_db)):
    """分页报告（W08 §3.6）：复用真实 PDF 渲染的绘制日志，回答页数/截断定位/手动分页。

    与精确预览**同一条边界**：可以带未保存正文（不落库、不冻结交付、不触发 AI），
    snapshot 两个指纹让前端丢弃过时响应（W11 同一机制）。导出响应头不变。
    """
    record = _get_live_resume(db, resume_id)
    document = document_or_422(
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
    page_limit = payload.page_limit or record.page_limit or 1
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
    )
    return build_pagination_report(
        document,
        template=export_template,
        format_config=base_format_config,
        page_limit=page_limit,
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

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
    ResumeRenderRequest,
)
from ...services import trash
from ...services.actions import add_action_route
from ...services.actions.catalog import all_actions
from ...services.exporter import normalize_page_limit, render_html
from ...services.resume.content_relevance_hints import build_content_hints
from ...services.resume.document_save import (
    RevisionConflict,
    revision_conflict_response,
)
from ...services.resume.layout_update import apply_layout_update
from ...services.resume.pagination_report_service import resume_pagination_report
from ...services.resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from ...services.resume.resume_layout import (
    STATUS_OVERFLOW,
    build_fit_ladder,
    diagnose,
    fit_room_report,
)
from ...services.resume.resume_read_service import ResumeNotFound
from ...services.resume.resume_record import record_format_config
from ...services.resume.resume_template_store import (
    resolve_format_config,
    resolve_style_config,
    resolve_style_template,
)
from ...services.resume.resume_templates import (
    font_scale_spec,
    validated_format_config,
)
from ._shared import document_or_422

logger = logging.getLogger(__name__)


router = APIRouter()


add_action_route(router, all_actions()["update_resume_layout"], route_path="/{resume_id}/layout")


def update_resume_layout(
    resume_id: int, payload: ResumeLayoutUpdate, db: Session = Depends(get_db)
):
    """只调整版式参数（模板/页数/字号/按简历的覆盖），不重新生成内容。

    生成后内容偏多时，用户可以先增大页数或缩小字号再渲染，不必重跑模型。

    **版本（W02）**：带 ``expected_revision`` 就条件写（不匹配 → 409，一个字节都不动），
    不带就无条件写并推进一版（旧行为）。版式与正文共用同一个 ``revision``——拖动滑杆
    也是"改了这份简历"，两个窗口各存一半版式同样会互相覆盖。

    **局部 PATCH（2026-11）**：本接口是**真·局部更新**——只有本次请求体里真的带了的
    字段才会被写库，没带的保持库里原值（判据是 ``model_fields_set``，规则与踩过的坑见
    ``services/resume/layout_update.layout_values_from_payload``）。

    **RF-03b**：编排搬到 ``services/resume/layout_update.apply_layout_update``——
    助手动作 ``update_resume_layout`` 的 ``run`` 走同一个函数。本端点只剩错误翻译。
    """
    try:
        return apply_layout_update(db, resume_id=resume_id, payload=payload)
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    except ResumeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    # 用户设了最小页边距时，阶梯在阈值处截断（问题 17：边距是参数下界，不是筛选条件）。
    room = fit_room_report(style, font_scale, current_config, min_padding_mm=payload.min_padding_mm)
    diagnosis = diagnose(
        used_height=measure.used_height,
        page_content_height=measure.page_content_height,
        page_limit=measure.page_limit,
        has_fit_room=room["has_room"],
    )
    # 只有真的塞不下才需要给收紧方案：放得下时给一堆"再收紧一点"只会让人白改。
    ladder = (
        build_fit_ladder(style, font_scale, current_config, min_padding_mm=payload.min_padding_mm)
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


add_action_route(
    router, all_actions()["get_resume_status"], route_path="/{resume_id}/pagination/report"
)


def pagination_report(resume_id: int, payload: PreviewPdfRequest, db: Session = Depends(get_db)):
    """分页报告（W08 §3.6）：复用真实 PDF 渲染的绘制日志，回答页数/截断定位/手动分页。

    与精确预览**同一条边界**：可以带未保存正文（不落库、不冻结交付、不触发 AI），
    snapshot 两个指纹让前端丢弃过时响应（W11 同一机制）。导出响应头不变。

    响应体是 ``build_pagination_report`` 的字典（本端点**没有** Pydantic response_model，
    字段即那份字典的键）：``pages`` / ``pages_needed`` / ``overflow`` / ``page_limit`` /
    ``page_limit_is_unlimited`` / ``last_page_fill`` / ``truncated_at`` / ``manual_breaks`` /
    ``warnings`` / ``snapshot``。其中 ``page_limit`` 是渲染保护上限（数字，页标记按它过滤），
    "用户选的是不限篇幅"由布尔字段 ``page_limit_is_unlimited`` 表达，两者不能互相替代。

    **RF-03b**：编排搬到 ``services/resume/pagination_report_service``——助手动作
    ``get_resume_status`` 的 ``run`` 走同一个函数，两条入口的页数与截断位置必然同源。
    """
    try:
        return resume_pagination_report(db, resume_id, payload)
    except ResumeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

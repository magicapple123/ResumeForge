# SPDX-License-Identifier: Apache-2.0
"""简历模板工作台接口：版式模板的增删改查与模板预览。

自制样式模板（自己写 HTML 的那类）已于 2026-11 下线，本文件只保留"版式"这条链路；
下线的是**写路径**与**读路径**，DB 里的存量行一个都没删（零迁移）。
"""

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.resume import ResumeRecord
from ..schemas.resume import ResumeContent
from ..schemas.resume_template import (
    ResumeTemplateCreate,
    ResumeTemplateDetail,
    ResumeTemplateOut,
    ResumeTemplateUpdate,
    TemplatePreviewRequest,
)
from ..services.document_text import (
    extract_document_text,  # noqa: F401 - legacy monkeypatch surface
)
from ..services.exporter import render_html
from ..services.llm import create_provider  # noqa: F401 - legacy monkeypatch surface
from ..services.resume.resume_sample import sample_resume_content
from ..services.resume.resume_template_store import (
    TemplateError,
    create_user_template,
    delete_user_template,
    get_user_template,
    list_user_templates,
    resolve_format_config,
    update_user_template,
)
from ..services.resume.resume_templates import (
    font_scale_spec,
    template_options,
    template_spec,
    validated_format_config,
)
from ..services.settings_service import get_llm_config  # noqa: F401 - legacy monkeypatch surface

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume-templates", tags=["resume-templates"])

# 自制样式模板（kind='style'）已下线（2026-11）。错误文案只写**原因**，动作由前端拼
# （见 docs/ui-copy-guide.md §2.4 与 tests/test_detail_copy.py）。
STYLE_OFFLINE_DETAIL = "自制模板已下线，只能创建版式"

# Jinja 报错原文对用户没有意义（"…ResumeContent object has no attribute 'basic'"），
# 而这类错误在自制模板里最常见——写在右侧的字段名与真实字段名差一个词。所以把
# "属性不存在"翻译成"你写错的是哪个字段 + 正确的取法 + 可用字段清单"。
_MISSING_ATTRIBUTE_RE = re.compile(r"object has no attribute '([^']+)'")


def _template_error_detail(exc: Exception) -> str:
    """把模板渲染异常转成面向用户的提示。"""
    text = str(exc)
    matched = _MISSING_ATTRIBUTE_RE.search(text)
    if matched:
        field = matched.group(1)
        available = "、".join(ResumeContent.model_fields)
        return (
            f"模板里用到了不存在的字段「{field}」。简历内容都挂在 resume 上"
            f"（例如 {{{{ resume.name }}}}），可用字段：{available}；"
            '各分区正文建议直接用 {% include "_resume_sections.j2" %}。'
        )
    return f"模板渲染失败：{text}（请检查 Jinja 语法与 include 路径）"


def _to_detail(template) -> ResumeTemplateDetail:
    return ResumeTemplateDetail.model_validate(template)


def _template_or_404(db: Session, template_id: int):
    template = get_user_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="模板不存在或已被删除")
    return template


@router.get("/builtin")
def read_builtin_templates():
    """内置模板清单（只读，**只列可选的那 5 套**）。用户版式见 ``GET /api/resume-templates``。

    下线的三套（technical / editorial / split）不在这里出现：它们仍然可渲染（老简历
    按原样打开），只是不再参与"挑一个模板"这个决策。
    """
    return template_options()


@router.get("", response_model=list[ResumeTemplateOut])
def read_user_templates(
    kind: str | None = Query(default=None, pattern="^(style|format)$"),
    db: Session = Depends(get_db),
):
    """自制模板列表（可按类型筛选）。内置模板不在这里，见 ``/api/resumes/templates``。"""
    return [ResumeTemplateOut.model_validate(item) for item in list_user_templates(db, kind)]


@router.post("", response_model=ResumeTemplateDetail, status_code=201)
def create_template(payload: ResumeTemplateCreate, db: Session = Depends(get_db)):
    """新建**版式**模板（``kind='format'``）。

    自制样式模板（自己写 HTML 的那类）已下线，``kind='style'`` 直接 400。已存在的
    style 行不删：它们只是不再被读取，用户可以在列表里看到并删除。
    """
    if payload.kind != "format":
        raise HTTPException(status_code=400, detail=STYLE_OFFLINE_DETAIL)
    try:
        template = create_user_template(
            db,
            name=payload.name,
            kind=payload.kind,
            description=payload.description,
            html=payload.html,
            config=payload.config,
            source_name=payload.source_name,
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_detail(template)


@router.get("/{template_id}", response_model=ResumeTemplateDetail)
def read_template(template_id: int, db: Session = Depends(get_db)):
    return _to_detail(_template_or_404(db, template_id))


@router.put("/{template_id}", response_model=ResumeTemplateDetail)
def update_template(template_id: int, payload: ResumeTemplateUpdate, db: Session = Depends(get_db)):
    template = _template_or_404(db, template_id)
    # 存量自制样式模板不允许再编辑：它们已经不参与渲染，能改只会让人以为"改了有用"。
    # 删除与重命名列表展示仍然照旧（用户要能清理掉）。
    if template.kind == "style":
        raise HTTPException(status_code=400, detail=STYLE_OFFLINE_DETAIL)
    try:
        template = update_user_template(
            db,
            template,
            name=payload.name,
            description=payload.description,
            html=payload.html,
            config=payload.config,
            enabled=payload.enabled,
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_detail(template)


@router.delete("/{template_id}", status_code=204)
def remove_template(template_id: int, db: Session = Depends(get_db)):
    delete_user_template(db, _template_or_404(db, template_id))


def _preview_content(payload: TemplatePreviewRequest, db: Session) -> dict | ResumeContent:
    # T4b：render_html 内部 coerce_document 同时接 v1 dict 与 v2 文档，这里**原样透传**，
    # 不再折一次 v1 分析视图（折返会丢掉 v2 的字段位置/隐藏/自建板块）。
    if payload.content is not None:
        return payload.content
    if payload.resume_id is not None:
        record = db.get(ResumeRecord, payload.resume_id)
        if record is not None:
            return record.content or {}
    # 内置示例按档位给详略：小字号一页装得下更多字，示例就该更密——否则大字号档的
    # 缩略图里只剩半页内容，用户会以为"选大字号以后模板就变空了"。模板名一并传：
    # compact / scholar 的默认行高比其余模板低约 25%，同一份内容在它们里面会显得空。
    return sample_resume_content(payload.font_scale, payload.template_name)


@router.post("/preview")
def preview_template(payload: TemplatePreviewRequest, db: Session = Depends(get_db)):
    """渲染模板预览（模板卡片的缩略图与"每个模板一眼看效果"都走这里）。

    **自制模板已下线（2026-11）**：``html`` 与 ``style_config`` 两个字段仍留在
    schema 里（删字段会让还没更新的前端直接 422），但**不再生效**——渲染一律走
    ``template_name`` 对应的内置模板 + ``format_name`` / ``format_config`` 的版式参数。
    ``template_id`` 同样被忽略：库里那些 style 行已经不参与渲染。
    """
    # 与真实渲染同口径：`/api/resumes/render` 与记录落库都是"先 resolve(format_name)、
    # 再用 format_config 逐键覆盖"（见 api/resumes.py 的 render_resume 与
    # _record_format_config）。预览此前是"有 format_config 就整份顶替 format_name"，
    # 于是前端一旦把当前字号系数（在 format_config 里）传进来，就会把 format_name 的
    # 版式（如 compact 的行高/页边距）整个丢掉，缩略图与用户实际生成的简历不一致。
    format_config = dict(resolve_format_config(db, payload.format_name))
    format_config.update(validated_format_config(payload.format_config))

    content = _preview_content(payload, db)
    try:
        html = render_html(
            content,
            template=template_spec(payload.template_name)["name"],
            page_limit=payload.page_limit,
            font_scale=font_scale_spec(payload.font_scale)["name"],
            format_config=format_config,
            style_config={},
            template_html="",
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 模板写错时给出可读提示，而不是 500 堆栈
        logger.warning("模板预览渲染失败：%s", exc)
        raise HTTPException(status_code=400, detail=_template_error_detail(exc)) from exc
    return Response(html, media_type="text/html; charset=utf-8")

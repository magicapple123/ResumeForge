"""简历模板工作台接口：自制模板的增删改查与预览渲染。"""
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
    resolve_style_config,
    resolve_style_template,
    update_user_template,
)
from ..services.resume.resume_template_style import validated_style_config
from ..services.resume.resume_templates import (
    RESUME_TEMPLATES,
    TEMPLATES_DIR,
    font_scale_spec,
    template_spec,
    validated_format_config,
)
from ..services.settings_service import get_llm_config  # noqa: F401 - legacy monkeypatch surface
from .resume_template_import import router as template_import_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume-templates", tags=["resume-templates"])

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
    """内置模板清单（只读）。用户模板见 ``GET /api/resume-templates``。"""
    return [
        {"name": item["name"], "label": item["label"], "description": item["description"]}
        for item in RESUME_TEMPLATES.values()
    ]


@router.get("", response_model=list[ResumeTemplateOut])
def read_user_templates(
    kind: str | None = Query(default=None, pattern="^(style|format)$"),
    db: Session = Depends(get_db),
):
    """自制模板列表（可按类型筛选）。内置模板不在这里，见 ``/api/resumes/templates``。"""
    return [ResumeTemplateOut.model_validate(item) for item in list_user_templates(db, kind)]


@router.post("", response_model=ResumeTemplateDetail, status_code=201)
def create_template(payload: ResumeTemplateCreate, db: Session = Depends(get_db)):
    """新建模板。样式模板的 HTML 会被清洗（去掉脚本与外链）并补齐 CSP。"""
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


router.include_router(template_import_router)


@router.get("/builtin-source")
def read_builtin_source(name: str = Query(..., min_length=1, max_length=64)):
    """读取某个内置模板的源码，用于「从内置模板复制一份」开始自制。

    内置模板本身是随包的 Jinja 文件，只能读不能改；给用户一份可编辑的副本，比让
    他从空白页开始写要容易得多。
    """
    spec = RESUME_TEMPLATES.get(name.strip())
    if spec is None:
        raise HTTPException(status_code=404, detail="没有这个内置模板")
    path = TEMPLATES_DIR / spec["file"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="内置模板文件缺失，请重新安装应用")
    return {
        "name": spec["name"],
        "label": spec["label"],
        "html": path.read_text(encoding="utf-8"),
        "config": {},
    }


@router.get("/{template_id}", response_model=ResumeTemplateDetail)
def read_template(template_id: int, db: Session = Depends(get_db)):
    return _to_detail(_template_or_404(db, template_id))


@router.put("/{template_id}", response_model=ResumeTemplateDetail)
def update_template(
    template_id: int, payload: ResumeTemplateUpdate, db: Session = Depends(get_db)
):
    template = _template_or_404(db, template_id)
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


def _preview_content(payload: TemplatePreviewRequest, db: Session) -> "object":
    if payload.content is not None:
        return payload.content
    if payload.resume_id is not None:
        record = db.get(ResumeRecord, payload.resume_id)
        if record is not None:
            from ..schemas.resume import ResumeContent

            return ResumeContent.model_validate(record.content)
    return sample_resume_content()


@router.post("/preview")
def preview_template(payload: TemplatePreviewRequest, db: Session = Depends(get_db)):
    """渲染模板预览（工作台的实时预览与"每个模板一眼看效果"都走这里）。

    传 ``html`` 就渲染这段（未保存的编辑内容）；否则用已保存模板或内置模板。
    """
    template_name = payload.template_name
    template_html = payload.html
    style_config = validated_style_config(payload.style_config)
    if not template_html:
        if payload.template_id is not None:
            saved = _template_or_404(db, payload.template_id)
            if saved.kind == "style":
                template_name = saved.name
                style_config = {
                    **validated_style_config(saved.config),
                    **style_config,
                }
        template_name, template_html = resolve_style_template(db, template_name)
        if not style_config:
            style_config = resolve_style_config(db, payload.template_name)

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
            template=template_spec(template_name)["name"],
            page_limit=payload.page_limit,
            font_scale=font_scale_spec(payload.font_scale)["name"],
            format_config=format_config,
            style_config=style_config,
            template_html=template_html,
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 模板写错时给出可读提示，而不是 500 堆栈
        logger.warning("模板预览渲染失败：%s", exc)
        raise HTTPException(status_code=400, detail=_template_error_detail(exc)) from exc
    return Response(html, media_type="text/html; charset=utf-8")

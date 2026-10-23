# SPDX-License-Identifier: Apache-2.0
"""用户自制简历模板：持久化、清洗与校验。

自制模板是**用户自己写的 HTML**，比内置模板多两层保护：

1. **清洗**：去掉 `<script>` 与可能外链资源的标签。预览和导出都要在浏览器里打开，
   模板不需要脚本（页数自适应的脚本由我们追加），而脚本是最容易写坏的一环。
2. **沙箱渲染**：用 Jinja 的 ``SandboxedEnvironment``，模板里拿不到任意 Python 对象。

模板名与内置模板共用一个命名空间：重名时拒绝保存，否则"选择模板"会指向不确定的一版。
"""

from __future__ import annotations

import json
import logging
import re

from sqlalchemy.orm import Session

from ...models.resume_template import (
    TEMPLATE_KIND_FORMAT,
    TEMPLATE_KIND_STYLE,
    TEMPLATE_KINDS,
    ResumeTemplate,
)
from .resume_template_style import MAX_STYLE_CONFIG_CHARS, validated_style_config
from .resume_templates import (
    DEFAULT_TEMPLATE,
    FORMAT_PRESETS,
    RESUME_TEMPLATES,
    validated_format_config,
)
from .template_html_sanitizer import filter_template_html

logger = logging.getLogger(__name__)

MAX_USER_TEMPLATES = 40
MAX_TEMPLATE_HTML_CHARS = 200_000
MAX_TEMPLATE_NAME_CHARS = 40

# 模板名：中文、字母、数字、连字符与下划线，不能以符号开头。
_NAME_RE = re.compile(r"^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\- ]*$")
_CSP_META = (
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
    "img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-{{ csp_nonce }}'; "
    "base-uri 'none'; form-action 'none'\" />"
)


class TemplateError(ValueError):
    """模板不合法：消息直接展示给用户。"""


def _validated_style_config(raw: dict | None) -> dict:
    normalized = validated_style_config(raw)
    if (
        len(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")))
        > MAX_STYLE_CONFIG_CHARS
    ):
        raise TemplateError("模板视觉配置过大，请减少自定义图片或装饰后再保存")
    return normalized


def sanitize_template_html(html: str) -> str:
    """去掉会执行代码或发起网络请求的内容，并补齐 CSP 与字符集声明。"""
    return filter_template_html(html, _CSP_META)


def validate_template_name(name: str) -> str:
    """校验自制模板名：非空、长度上限、不与现有模板重名。"""
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise TemplateError("模板名称不能为空")
    if len(cleaned) > MAX_TEMPLATE_NAME_CHARS:
        raise TemplateError(f"模板名称不能超过 {MAX_TEMPLATE_NAME_CHARS} 个字符")
    if not _NAME_RE.match(cleaned):
        raise TemplateError("模板名称只能包含中文、字母、数字、空格、下划线与连字符")
    return cleaned


def validate_template_html(html: str) -> str:
    """校验自制模板 HTML：必须含占位符、拦截脚本注入。"""
    cleaned = (html or "").strip()
    if len(cleaned) < 40:
        raise TemplateError("模板内容太短，请提供完整的 HTML 模板")
    if len(cleaned) > MAX_TEMPLATE_HTML_CHARS:
        raise TemplateError("模板内容过大，请精简后再导入")
    body = cleaned.replace("</head>", "\n</head>", 1)
    if "</head>" not in body and "<body" not in cleaned.lower():
        raise TemplateError("模板必须是一个完整的 HTML 页面（含 <head> 与 <body>）")
    return cleaned


def find_by_name(db: Session, name: str) -> ResumeTemplate | None:
    return db.query(ResumeTemplate).filter(ResumeTemplate.name == name).first()


def list_user_templates(db: Session, kind: str | None = None) -> list[ResumeTemplate]:
    query = db.query(ResumeTemplate)
    if kind in TEMPLATE_KINDS:
        query = query.filter(ResumeTemplate.kind == kind)
    return query.order_by(ResumeTemplate.updated_at.desc()).all()


def get_user_template(db: Session, template_id: int) -> ResumeTemplate | None:
    return db.get(ResumeTemplate, template_id)


def create_user_template(
    db: Session,
    *,
    name: str,
    kind: str = TEMPLATE_KIND_STYLE,
    description: str = "",
    html: str = "",
    config: dict | None = None,
    source_name: str = "",
) -> ResumeTemplate:
    """落库一份自制模板：命名/重名/总量/类型校验与 HTML 消毒都在此。"""
    cleaned_name = validate_template_name(name)
    if find_by_name(db, cleaned_name) is not None:
        raise TemplateError(f"已存在同名模板「{cleaned_name}」，请换一个名称")
    count = db.query(ResumeTemplate).count()
    if count >= MAX_USER_TEMPLATES:
        raise TemplateError(f"自制模板最多 {MAX_USER_TEMPLATES} 个，请先删除不再使用的")
    if kind not in TEMPLATE_KINDS:
        raise TemplateError("模板类型只有「模板」与「版式」两种")

    if kind == TEMPLATE_KIND_STYLE:
        template_html = sanitize_template_html(validate_template_html(html))
        config = _validated_style_config(config)
    else:
        template_html = ""
        normalized = validated_format_config(config)
        if not normalized:
            raise TemplateError("版式至少需要设置一项参数")

    template = ResumeTemplate(
        name=cleaned_name,
        kind=kind,
        description=(description or "").strip()[:255],
        html=template_html,
        config=config or {},
        source_name=(source_name or "").strip()[:255],
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    logger.info("已创建简历模板 name=%s kind=%s", template.name, template.kind)
    return template


def update_user_template(
    db: Session,
    template: ResumeTemplate,
    *,
    name: str | None = None,
    description: str | None = None,
    html: str | None = None,
    config: dict | None = None,
    enabled: bool | None = None,
) -> ResumeTemplate:
    """更新自制模板：只改传入的字段，命名/HTML/参数各自按类型校验。"""
    if name is not None and name != template.name:
        cleaned_name = validate_template_name(name)
        existing = find_by_name(db, cleaned_name)
        if existing is not None and existing.id != template.id:
            raise TemplateError(f"已存在同名模板「{cleaned_name}」")
        template.name = cleaned_name
    if description is not None:
        template.description = description.strip()[:255]
    if html is not None and template.kind == TEMPLATE_KIND_STYLE:
        template.html = sanitize_template_html(validate_template_html(html))
    if config is not None:
        if template.kind == TEMPLATE_KIND_STYLE:
            template.config = _validated_style_config(config)
        elif template.kind == TEMPLATE_KIND_FORMAT:
            normalized = validated_format_config(config)
            if not normalized:
                raise TemplateError("版式至少需要设置一项参数")
            template.config = normalized
    if enabled is not None:
        template.enabled = enabled
    db.commit()
    db.refresh(template)
    logger.info("已更新简历模板 id=%s", int(template.id))
    return template


def delete_user_template(db: Session, template: ResumeTemplate) -> None:
    db.delete(template)
    db.commit()


def resolve_style_template(db: Session, name: str | None) -> tuple[str, str]:
    """解析模板名 → ``(内置模板名, 用户模板 HTML)``。

    **自制模板（``kind='style'``）的读路径已在 2026-11 下线**：本函数第二个返回值恒为
    空串，用户模板 HTML 不再参与渲染。DB 里的存量行**没有删**（零迁移），只是不再被读取。

    名字是内置模板就用它；其余一律退回默认内置模板——记录里的模板名可能指向一个已经
    下线的自制模板，渲染必须仍然可用（外观会变成经典款，这是这次下线的既定代价）。
    """
    key = (name or "").strip()
    if key in RESUME_TEMPLATES:
        return key, ""
    return DEFAULT_TEMPLATE, ""


def resolve_style_config(db: Session, name: str) -> dict:
    """视觉配置解析：恒返回空字典。

    自制模板下线后没有任何来源能提供 ``style_config``（内置模板的视觉参数走
    ``format_config``，那是另一条仍然有效的链路）。签名保留是为了让 8 个调用点
    （导出、预览、分享、版式指纹）不用各改一行。
    """
    return {}


def resolve_format_config(db: Session, name: str) -> dict:
    """解析版式名 → 受校验的覆盖配置（内置预设或用户模板）。"""
    key = (name or "").strip()
    if not key:
        return {}
    for preset in FORMAT_PRESETS:
        if preset["name"] == key:
            return validated_format_config(preset["config"])
    user = find_by_name(db, key)
    if user is not None and user.kind == TEMPLATE_KIND_FORMAT and user.enabled:
        return validated_format_config(user.config)
    return {}


def custom_template_options(db: Session) -> list[dict]:
    """「可选模板」清单里的自制模板部分：恒为空列表。

    自制模板下线后不再有任何自制样式模板可选项；函数与签名保留，是因为
    ``api/resumes/templates_routes.py`` 与 ``template_options_with_custom`` 都以
    "给一个列表"的形式拼接（传 ``[]`` 是合法调用）。
    """
    return []


def custom_format_options(db: Session) -> list[dict]:
    """列出用户自制的版式选项，供模板清单拼装。"""
    return [
        {
            "id": item.id,
            "name": item.name,
            "label": item.name,
            "description": item.description,
            "config": item.config or {},
        }
        for item in list_user_templates(db, kind=TEMPLATE_KIND_FORMAT)
        if item.enabled
    ]


__all__ = [
    "MAX_TEMPLATE_HTML_CHARS",
    "MAX_USER_TEMPLATES",
    "TemplateError",
    "create_user_template",
    "custom_format_options",
    "custom_template_options",
    "delete_user_template",
    "find_by_name",
    "get_user_template",
    "list_user_templates",
    "resolve_format_config",
    "resolve_style_template",
    "resolve_style_config",
    "sanitize_template_html",
    "update_user_template",
    "validate_template_html",
    "validate_template_name",
]

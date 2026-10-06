"""简历格式模板（format_templates）域的工具实现。

助手只能制作「格式模板」，不能改样式模板的 HTML。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ....models.resume_template import TEMPLATE_KIND_FORMAT, ResumeTemplate
from ...resume.resume_template_store import (
    TemplateError,
    create_user_template,
    get_user_template,
    list_user_templates,
    update_user_template,
)
from ...resume.resume_template_store import (
    find_by_name as find_template_by_name,
)
from ...resume.resume_templates import FORMAT_FIELDS, validated_format_config
from .._types import ToolResult


def _format_tool_properties() -> dict:
    """用 ``FORMAT_FIELDS`` 生成格式模板工具的参数声明。

    字段名、范围与说明都取自格式模板编辑器用的那一份清单，模型不必猜参数名；将来
    增删可调项时这里自动跟着变，不用在工具定义里另抄一遍（少一处人工同步）。
    """
    properties: dict = {}
    for spec in FORMAT_FIELDS:
        if spec["type"] == "color":
            properties[spec["key"]] = {
                "type": "string",
                "description": f"{spec['label']}，十六进制颜色，如 #2f6feb",
            }
        else:
            note = f"（{spec['description']}）" if spec.get("description") else ""
            properties[spec["key"]] = {
                "type": "number",
                "minimum": spec["min"],
                "maximum": spec["max"],
                "description": f"{spec['label']}，范围 {spec['min']}–{spec['max']}{note}",
            }
    return properties


_FORMAT_FIELD_LABELS = {spec["key"]: spec["label"] for spec in FORMAT_FIELDS}


def _format_config_from_arguments(arguments: dict) -> dict:
    """从入参里挑出格式模板参数，并**逐个**用 ``validated_format_config`` 校验。

    刻意不把整份直接丢给 ``validated_format_config``：那是"非法值静默丢弃"的语义，
    模型给错值时只会看到"一项都没设"，然后反复重试。逐个校验能明确指出是哪一项、
    允许范围是多少，模型一次就能改对——被拒的原因必须可见。
    """
    provided = {
        key: arguments[key]
        for key in _FORMAT_FIELD_LABELS
        if arguments.get(key) not in (None, "")
    }
    config: dict = {}
    for key, value in provided.items():
        normalized = validated_format_config({key: value})
        if key in normalized:
            config[key] = normalized[key]
            continue
        spec = next(item for item in FORMAT_FIELDS if item["key"] == key)
        if spec["type"] == "color":
            raise ValueError(
                f"{spec['label']}（{key}）必须是十六进制颜色（如 #2f6feb），收到「{value}」"
            )
        raise ValueError(
            f"{spec['label']}（{key}）必须在 {spec['min']} 到 {spec['max']} 之间，收到「{value}」"
        )
    return config


def _format_template_or_error(db: Session, arguments: dict) -> ResumeTemplate:
    """按 id 或名称取出要修改的**自制格式模板**；取不到就抛出可读原因。

    内置版式（standard/compact/...）不在数据库里，``find_by_name`` 查不到——这里要把
    "内置不能改"和"名字写错"区分开地讲清楚，模型才知道该让用户去工作台还是换个名字。
    """
    raw_id = arguments.get("template_id")
    if raw_id not in (None, ""):
        try:
            template = get_user_template(db, int(raw_id))
        except (TypeError, ValueError):
            template = None
        if template is None:
            raise ValueError(f"格式模板 {raw_id} 不存在；可以用 template_name 指名字再试")
    else:
        name = str(arguments.get("template_name") or "").strip()
        if not name:
            raise ValueError("需要提供 template_id 或 template_name 来指明要修改的格式模板")
        template = find_template_by_name(db, name)
        if template is None:
            raise ValueError(
                f"没有找到自制格式模板「{name}」；内置版式不能修改，"
                "如果是要新建一个可以用 create_format_template"
            )
    if template.kind != TEMPLATE_KIND_FORMAT:
        raise ValueError(
            f"「{template.name}」是样式模板；助手只能改格式模板（版式参数），"
            "样式模板的 HTML 请到「工作台」页修改"
        )
    return template


def _tool_list_format_templates(db: Session, _arguments: dict) -> ToolResult:
    """列出**自制格式模板**的清单（id/名称/说明/版式参数），只读。

    用户问「我有哪些格式模板」「之前调的行高在哪个模板里」时先看这份清单再决定
    ``update_format_template`` 改哪一个。内置版式不在数据库里，列不出来——
    这里如实说明，免得模型把内置版式当成可改的自制模板。
    """
    templates = list_user_templates(db, kind=TEMPLATE_KIND_FORMAT)
    rows = [
        {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "enabled": template.enabled,
            "config": template.config or {},
            "updated_at": template.updated_at.isoformat() if template.updated_at else None,
        }
        for template in templates
    ]
    payload = {
        "总数": len(rows),
        "格式模板": rows,
        "说明": "这里只列自制的格式模板（版式参数）；样式模板（完整 HTML）与内置版式不在此列，"
        "后者只能在「工作台」页查看。",
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了 {len(rows)} 个格式模板",
        link="/skills",
    )


def _tool_create_format_template(db: Session, arguments: dict) -> ToolResult:
    name = str(arguments.get("name") or "").strip()
    if not name:
        raise ValueError("创建格式模板需要 name（模板名称）")
    config = _format_config_from_arguments(arguments)
    if not config:
        raise ValueError(
            "格式模板至少需要设置一项参数（强调色 accent / 行高 line_height / 页边距 page_padding / "
            "区块间距 section_gap / 字号系数 font_scale_adjust 等）"
        )
    try:
        # 复用工作台那套落库逻辑：命名、重名、总量上限与参数校验都在 create_user_template 里，
        # 工具只负责把参数凑齐，绝不另写一份写入路径（否则两处约束会各自漂移）。
        template = create_user_template(
            db,
            name=name,
            kind=TEMPLATE_KIND_FORMAT,
            description=str(arguments.get("description") or "")[:255],
            config=config,
            source_name="求职助手",
        )
    except TemplateError as exc:
        raise ValueError(str(exc)) from None
    return ToolResult(
        text=json.dumps(
            {"id": template.id, "name": template.name, "config": template.config},
            ensure_ascii=False,
        ),
        summary=f"新建了格式模板「{template.name}」",
        link="/skills",
        changed=True,
    )


def _tool_update_format_template(db: Session, arguments: dict) -> ToolResult:
    template = _format_template_or_error(db, arguments)
    fields: dict = {}
    if arguments.get("name") not in (None, ""):
        fields["name"] = str(arguments["name"]).strip()
    if arguments.get("description") is not None:
        fields["description"] = str(arguments["description"])
    provided_config = _format_config_from_arguments(arguments)
    if provided_config:
        # config 是整份替换语义：先把模型给的项合并进现有配置再提交。只改一项时若直接
        # 顶替，会把其它已经调好的参数悄悄清空——那正是用户最难发现的一类数据丢失。
        fields["config"] = {**(template.config or {}), **provided_config}
    if not fields:
        raise ValueError("没有给出要修改的内容（可改 name/description，或至少设置一项版式参数）")
    try:
        template = update_user_template(db, template, **fields)
    except TemplateError as exc:
        raise ValueError(str(exc)) from None
    return ToolResult(
        text=json.dumps(
            {
                "id": template.id,
                "name": template.name,
                "config": template.config,
                "updated": sorted(fields),
            },
            ensure_ascii=False,
        ),
        summary=f"修改了格式模板「{template.name}」",
        link="/skills",
        changed=True,
    )

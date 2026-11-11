# SPDX-License-Identifier: Apache-2.0
"""话术库（14D）：``AppSetting`` 里的 JSON 数组 + 花括号变量的安全渲染。

**零迁移**：模板存在 ``AppSetting['apply_greeting_templates']``，与 ``assistant_limits``
同一条路。等 14C 的联动数据积累到能算效果再考虑建表——先建表只会多一份要迁移的空结构。

变量只有三个：``{company}`` / ``{job_title}`` / ``{name}``。

渲染刻意**不用** ``str.format_map``：用户的招呼语正文里完全可能出现别的花括号
（「熟悉 {Python}」「{C++}」），``format_map`` 会把这些当成占位符——缺键回落空串时
等于**悄悄删掉用户写的字**，而这个后果在发出去之后才被发现。这里只替换三个已知变量，
其余花括号原样保留；缺值回落空串（与"安全字典"的约定一致）。
"""

from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy.orm import Session

from ...schemas.apply import (
    GreetingTemplateListOut,
    GreetingTemplateOut,
    GreetingTemplateSaveIn,
)
from ..settings_service import get_apply_greeting_templates, save_apply_greeting_templates

logger = logging.getLogger(__name__)

# 只有这三个占位符会被替换；其余花括号一律原样保留。
PLACEHOLDERS: tuple[str, ...] = ("company", "job_title", "name")
_PLACEHOLDER_RE = re.compile(r"\{(" + "|".join(PLACEHOLDERS) + r")\}")


def render_greeting_template(
    body: str,
    *,
    company: str = "",
    job_title: str = "",
    name: str = "",
) -> str:
    """把模板变量替换成实际值；缺值回落空串，未知花括号原样保留。"""
    values = {"company": company or "", "job_title": job_title or "", "name": name or ""}

    def _replace(match: re.Match[str]) -> str:
        return str(values.get(match.group(1), "")).strip()

    return _PLACEHOLDER_RE.sub(_replace, body or "")


def _new_id() -> str:
    """模板 id：短随机串即可（单机单人使用，不需要全局唯一性保证）。"""
    return uuid.uuid4().hex[:12]


def list_templates(db: Session) -> GreetingTemplateListOut:
    """读取话术库；单条坏数据只丢这一条，不让整个库读空。"""
    templates: list[GreetingTemplateOut] = []
    for raw in get_apply_greeting_templates(db):
        try:
            # 值是 JSON 里的任意类型：先收窄再转换，坏形状按「缺省」处理而不是让
            # 整个库读空（单条坏数据只丢这一条，见上面的 docstring）。
            raw_tags = raw.get("tags")
            raw_uses = raw.get("uses")
            templates.append(
                GreetingTemplateOut(
                    id=str(raw.get("id") or "") or _new_id(),
                    name=str(raw.get("name") or ""),
                    body=str(raw.get("body") or ""),
                    tags=(
                        [str(tag) for tag in raw_tags if str(tag).strip()]
                        if isinstance(raw_tags, list)
                        else []
                    ),
                    uses=int(raw_uses) if isinstance(raw_uses, int | float) else 0,
                )
            )
        except (TypeError, ValueError):
            logger.warning("话术模板数据损坏，已跳过这一条")
    return GreetingTemplateListOut(templates=templates)


def save_templates(db: Session, payload: GreetingTemplateSaveIn) -> GreetingTemplateListOut:
    """整表覆盖（PUT 语义）。

    ``uses`` 省略（``None``）时**保留原计数**：前端编辑正文时不必先读计数再写回，
    否则一次编辑就会把"用过几次"清零，而那个数字正是首版唯一的统计口径。
    """
    existing = {item.id: item.uses for item in list_templates(db).templates}
    saved: list[GreetingTemplateOut] = []
    seen: set[str] = set()
    for entry in payload.templates:
        template_id = (entry.id or "").strip() or _new_id()
        if template_id in seen:
            # 同一次提交里 id 撞车就换一个：id 是前端"套用/累加"的锚点，重复会让计数错乱。
            template_id = _new_id()
        seen.add(template_id)
        uses = entry.uses if entry.uses is not None else existing.get(template_id, 0)
        saved.append(
            GreetingTemplateOut(
                id=template_id,
                name=entry.name.strip(),
                body=entry.body.strip(),
                tags=[tag.strip() for tag in entry.tags if tag.strip()],
                uses=int(uses),
            )
        )
    save_apply_greeting_templates(db, [item.model_dump() for item in saved])
    return GreetingTemplateListOut(templates=saved)


__all__ = [
    "PLACEHOLDERS",
    "list_templates",
    "render_greeting_template",
    "save_templates",
]

# SPDX-License-Identifier: Apache-2.0
"""knowledge 域的 action 契约（T28 Batch B：report 类域）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_knowledge   ↔ GET  /api/knowledge（只读；limit 仅工具侧截断，路由保持全量列表）
- get_knowledge    ↔ GET  /api/knowledge/{knowledge_id}（只读）
- create_knowledge ↔ POST /api/knowledge（可逆写，带 preview；工具默认来源「助手录入」用 tool_defaults）
- update_knowledge ↔ PUT  /api/knowledge/{knowledge_id}（可逆写，带 preview）

行为差异（已记录）：
1. list_knowledge 的 input_model 多了 limit（路由旧端点没有该参数）：只影响工具文案条数，
   路由响应仍是全量列表（与 T27 list_claims 同一处理）。
2. update_knowledge：旧工具是"未提供的字段沿用现值"（合并语义），旧 PUT 是整份替换
   （缺省字段被重置为 schema 默认值）。这里统一成**合并语义**：提交的字段覆盖、未提交字段
   从现值补齐——对整份提交的旧前端完全等价，对部分 PUT 更安全（不会把没提交的字段清空）。
   title 仍是必填（与旧 PUT 的 KnowledgeUpdate 一致），所以空 body 两侧都是 invalid_input。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ....schemas.knowledge import (
    MAX_KNOWLEDGE_CATEGORY_CHARS,
    MAX_KNOWLEDGE_CONTENT_CHARS,
    MAX_KNOWLEDGE_SOURCE_CHARS,
    MAX_KNOWLEDGE_TAGS,
    MAX_KNOWLEDGE_TITLE_CHARS,
    KnowledgeCreate,
    KnowledgeEntrySummary,
    KnowledgeOut,
    KnowledgeUpdate,
)
from ..legacy import tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

_DEFAULT_TOOL_LIST_LIMIT = 20
#: 工具历史行为：新增知识库条目时把来源默认标注为助手，方便用户溯源。
_TOOL_CREATE_SOURCE = "助手录入"


class ListKnowledgeInput(BaseModel):
    """list_knowledge 两侧共用入参：路由是 GET 查询参数，工具用 limit 截断文案。"""

    model_config = ConfigDict(extra="forbid")

    q: str = Field(default="", description="可选，标题/正文里的关键词")
    category: str = Field(default="", description="可选，分类，如 面经/简历技巧/求职策略")
    limit: int | None = Field(
        default=None, ge=1, le=500, description="可选，最多返回多少条，默认 20"
    )


class GetKnowledgeInput(BaseModel):
    """get_knowledge 两侧共用入参：路由的 knowledge_id 来自路径，工具来自 JSON。"""

    model_config = ConfigDict(extra="forbid")

    knowledge_id: int = Field(ge=1, description="知识库条目 id")


class CreateKnowledgeInput(KnowledgeCreate):
    """create_knowledge 两侧共用入参（继承 KnowledgeCreate，校验器只有一份）。

    覆盖字段只为保住工具 schema 里给模型看的说明文案；tool_defaults 单独保留工具侧
    历史默认来源「助手录入」（路由侧仍是 KnowledgeCreate 的「手动录入」）。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(
        ...,
        min_length=1,
        max_length=MAX_KNOWLEDGE_TITLE_CHARS,
        description="标题，必填",
    )
    category: str = Field(
        default="其他",
        max_length=MAX_KNOWLEDGE_CATEGORY_CHARS,
        description="分类，如 面经/简历技巧/求职策略/其他",
    )
    tags: list[str] = Field(
        default_factory=list, max_length=MAX_KNOWLEDGE_TAGS, description="标签，可选"
    )
    content: str = Field(
        default="",
        max_length=MAX_KNOWLEDGE_CONTENT_CHARS,
        description="正文（Markdown），可选",
    )
    source: str = Field(
        default="手动录入",
        max_length=MAX_KNOWLEDGE_SOURCE_CHARS,
        description="来源，默认「助手录入」",
    )

    @model_validator(mode="after")
    def normalize_and_require_title(self) -> CreateKnowledgeInput:
        """覆盖 KnowledgeCreate 的整份归一化：只对确实需要归一的字段赋值。

        父类在 after-validator 里无条件给 title/category/source 赋值，Pydantic 会把
        未提供的默认字段也记进 model_fields_set，于是 model_dump(exclude_unset=True)
        把默认值当成"用户显式提交"——preview 会多出用户没要求的行，合并更新也会把
        未提交的分类/来源覆盖回默认值。这里只在需要 strip/兜底时赋值。
        """
        title = self.title.strip()
        if not title:
            raise ValueError("请填写标题")
        if title != self.title:
            self.title = title
        category = self.category.strip()
        if category != self.category:
            self.category = category
        if not category:
            self.category = "其他"
        source = self.source.strip()
        if source != self.source:
            self.source = source
        if not source:
            self.source = "手动录入"
        return self


class UpdateKnowledgeInput(CreateKnowledgeInput):
    """update_knowledge 两侧共用入参：knowledge_id 在路由侧来自路径、工具侧来自 JSON。"""

    model_config = ConfigDict(extra="forbid")

    knowledge_id: int = Field(ge=1, description="知识库条目 id")


def _run_list_knowledge(db: Session, payload: ListKnowledgeInput) -> ActionOutcome:
    from ....api.knowledge import _knowledge_summary
    from ...assistant_tools.report_tools import _tool_list_knowledge
    from ...knowledge_service import list_knowledge

    rows = list_knowledge(db, q=payload.q, category=payload.category)
    legacy = _tool_list_knowledge(
        db,
        {"q": payload.q, "category": payload.category, "limit": payload.limit},
    )
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=[_knowledge_summary(entry) for entry in rows],
    )


def _run_get_knowledge(db: Session, payload: GetKnowledgeInput) -> ActionOutcome:
    from ...assistant_tools.report_tools import _tool_get_knowledge
    from ...knowledge_service import knowledge_or_none

    entry = knowledge_or_none(db, payload.knowledge_id)
    if entry is None:
        raise ActionError("not_found", f"知识库条目 {payload.knowledge_id} 不存在")
    legacy = _tool_get_knowledge(db, {"knowledge_id": payload.knowledge_id})
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=entry,
    )


def _preview_create_knowledge(db: Session, payload: CreateKnowledgeInput) -> WritePreview:
    from ...assistant_tools.previews import preview_create_knowledge

    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_create_knowledge(db, arguments)


def _run_create_knowledge(db: Session, payload: CreateKnowledgeInput) -> ActionOutcome:
    from ...knowledge_service import create_knowledge

    entry = create_knowledge(db, payload)
    return ActionOutcome(
        summary=f"新增了知识库条目「{entry.title}」",
        text=json.dumps({"id": entry.id, "title": entry.title}, ensure_ascii=False),
        link="/knowledge",
        changed=True,
        data=entry,
    )


def _preview_update_knowledge(db: Session, payload: UpdateKnowledgeInput) -> WritePreview:
    from ...assistant_tools.previews import preview_update_knowledge

    # 预览需要 knowledge_id 才能显示"目标：知识库条目「xxx」"；它不当字段改动展示。
    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_update_knowledge(db, arguments)


def _run_update_knowledge(db: Session, payload: UpdateKnowledgeInput) -> ActionOutcome:
    """路由语义：PUT 整份替换（未传字段落回 KnowledgeUpdate 默认值，与迁移前一致）。"""
    from ...knowledge_service import knowledge_or_none, update_knowledge

    entry = knowledge_or_none(db, payload.knowledge_id)
    if entry is None:
        raise ActionError("not_found", f"知识库条目 {payload.knowledge_id} 不存在")
    update_payload = KnowledgeUpdate.model_validate(
        payload.model_dump(
            exclude={
                "knowledge_id",
            }
        )
    )
    updated = update_knowledge(db, entry, update_payload)
    return ActionOutcome(
        summary=f"更新了知识库条目「{updated.title}」",
        text=json.dumps({"id": updated.id, "updated": []}, ensure_ascii=False),
        link="/knowledge",
        changed=True,
        data=updated,
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def knowledge_actions() -> dict[str, ActionSpec]:
    """构建（并注册）knowledge 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_knowledge = define_action(
        ActionSpec(
            name="list_knowledge",
            description=(
                "列出知识库条目（面经总结/简历技巧/求职策略等成文内容），可按关键词或分类筛选。"
                "用户问「知识库里有什么」「有没有关于 XX 的笔记」时用它。"
            ),
            input_model=ListKnowledgeInput,
            permission=Permission.READ_ONLY,
            run=_run_list_knowledge,
            service_entry="knowledge_service.list_knowledge",
            tool_defaults=(("limit", _DEFAULT_TOOL_LIST_LIMIT),),
            http=HttpRoute(
                "GET", "/api/knowledge", list[KnowledgeEntrySummary], tags=("knowledge",)
            ),
        )
    )
    get_knowledge = define_action(
        ActionSpec(
            name="get_knowledge",
            description="按 id 读取知识库里某一条的完整正文（支持 Markdown）。",
            input_model=GetKnowledgeInput,
            permission=Permission.READ_ONLY,
            run=_run_get_knowledge,
            service_entry="knowledge_service.knowledge_or_none",
            http=HttpRoute(
                "GET", "/api/knowledge/{knowledge_id}", KnowledgeOut, tags=("knowledge",)
            ),
        )
    )
    create_knowledge = define_action(
        ActionSpec(
            name="create_knowledge",
            description=(
                "把一段成文内容新增进知识库（标题必填，正文支持 Markdown）。"
                "只在用户明确要求保存/记录时调用。"
            ),
            input_model=CreateKnowledgeInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_knowledge,
            preview=_preview_create_knowledge,
            service_entry="knowledge_service.create_knowledge",
            tool_defaults=(("source", _TOOL_CREATE_SOURCE),),
            http=HttpRoute(
                "POST", "/api/knowledge", KnowledgeOut, status_code=201, tags=("knowledge",)
            ),
        )
    )
    update_knowledge = define_action(
        ActionSpec(
            name="update_knowledge",
            description="修改知识库里已有的一条（只传要改的字段，其余保持不变）。",
            input_model=UpdateKnowledgeInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_knowledge,
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_update_knowledge"
            ),
            preview=_preview_update_knowledge,
            service_entry="knowledge_service.update_knowledge",
            tool_fields=("knowledge_id", "title", "category", "tags", "content", "source"),
            http=HttpRoute(
                "PUT", "/api/knowledge/{knowledge_id}", KnowledgeOut, tags=("knowledge",)
            ),
        )
    )
    _ACTIONS = {
        spec.name: spec
        for spec in (
            list_knowledge,
            get_knowledge,
            create_knowledge,
            update_knowledge,
        )
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return knowledge_actions()


__all__ = [
    "CreateKnowledgeInput",
    "GetKnowledgeInput",
    "ListKnowledgeInput",
    "UpdateKnowledgeInput",
    "actions",
    "knowledge_actions",
]

# SPDX-License-Identifier: Apache-2.0
"""资料箱（materials）域的 action 契约（T28 Batch B）。

迁移对（工具 ↔ 路由，全部真实成对存在；附件走 JSON body 而不是 multipart，所以能迁）：

- list_materials ↔ GET  /api/materials（只读；路由全量列表，limit 只截断工具文案）
- get_material   ↔ GET  /api/materials/{material_id}（只读）
- create_material ↔ POST /api/materials（可逆写；路由保留附件落盘副作用）
- update_material ↔ PUT  /api/materials/{material_id}（可逆写；路由保留附件落盘副作用）

**行为保持与两侧历史语义的差异**（旧工具 handler 与旧路由对同一入参的解释不同）：

- 旧工具 create/update 只认 title/category/content/url/note 五个字段，附件（files）被刻意
  过滤（旧注释：留着它只会让人以为助手能给资料挂附件）；旧路由则是 MaterialCreate 整体
  替换。契约层只能有一个 input_model，因此用 **隐藏的 tool_call 标记**（由 tool_adapter
  的 tool_defaults 仅对工具调用注入）在 run 里保留旧工具语义：工具侧忽略附件、update 做
  局部合并；路由侧仍是整体替换 + 落盘副本。标记字段用 SkipJsonSchema 从两侧 JSON
  schema 里隐去（它不该出现在工具参数或 OpenAPI 里），由 tool_defaults 注入。
- 因同一原因，files 字段用 SkipJsonSchema 隐去：工具 schema 与迁移前的工具声明一致
  （旧声明没有附件参数），代价是路由 OpenAPI 的请求体也不再列出 files（运行时仍接受并
  校验，响应 MaterialOut 仍带 files）——已记入 T28 证据。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ....schemas.material import (
    MAX_MATERIAL_CONTENT_CHARS,
    MAX_MATERIAL_NOTE_CHARS,
    MAX_MATERIAL_TITLE_CHARS,
    MaterialCreate,
    MaterialOut,
    MaterialSummary,
    MaterialUpdate,
)
from ..legacy import tool_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

# 与 assistant_tools/_shared.py 的列表上限一致；tests/test_actions_materials_claims_batch.py 钉住。
_DEFAULT_LIST_LIMIT = 20
_MAX_LIST_LIMIT = 50
#: 旧工具 update_material 只允许修改这五个字段（附件由既有记录原样保留）。
_TOOL_UPDATE_FIELDS = ("title", "category", "content", "url", "note")


class ListMaterialsInput(BaseModel):
    """list_materials 两侧共用入参：路由侧是 query，工具侧是 JSON 参数。"""

    model_config = ConfigDict(extra="forbid")

    keyword: str = Field(default="", description="可选，标题/正文/备注里的关键词")
    category: str = Field(default="", description="可选，分类名，如 证书、作品、链接")
    limit: int | None = Field(default=None, ge=0, description="可选，最多返回多少条，默认 20")


class GetMaterialInput(BaseModel):
    """get_material 两侧共用入参：material_id 来自路由路径 / 工具参数。"""

    model_config = ConfigDict(extra="forbid")

    material_id: int = Field(description="资料 id")


class CreateMaterialInput(MaterialCreate):
    """create_material 两侧共用入参（继承 MaterialCreate，校验器只有一份）。

    工具侧字段由 ActionSpec.tool_fields 限制为旧声明字段（不含 files）；路由侧仍可传附件。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=MAX_MATERIAL_TITLE_CHARS, description="标题")
    category: str = Field(
        default="其他", max_length=64, description="分类，如 证书/作品/链接/笔记/其他"
    )
    content: str = Field(default="", max_length=MAX_MATERIAL_CONTENT_CHARS, description="正文内容")
    url: str = Field(default="", max_length=1024, description="相关链接（可选）")
    note: str = Field(default="", max_length=MAX_MATERIAL_NOTE_CHARS, description="备注（可选）")

    # 覆盖父类的跨字段校验（同名 no-op）：工具侧先合并记录现值再校验，路由侧在 run 里复核。
    @model_validator(mode="after")
    def require_something(self):
        return self


class UpdateMaterialInput(MaterialUpdate):
    """update_material 两侧共用入参：路由整份替换、工具只合并显式字段（run_tool 分流）。"""

    model_config = ConfigDict(extra="forbid")

    material_id: int = Field(description="资料 id")

    # 覆盖父类 after-validator（同名 no-op）：工具侧先合并记录现值再校验，路由侧在 run 里复核。
    @model_validator(mode="after")
    def require_something(self):
        return self


def _run_list_materials(db: Session, payload: ListMaterialsInput) -> ActionOutcome:
    from ...materials import list_materials, material_brief

    records = list_materials(db, keyword=payload.keyword, category=payload.category)
    # limit 只影响给模型看的条数：GET /api/materials 的响应一直是全量列表
    # （与 T27 list_claims 的 limit 处理同口径）。
    limit = min(payload.limit or _DEFAULT_LIST_LIMIT, _MAX_LIST_LIMIT)
    shown = records[:limit]
    return ActionOutcome(
        summary=f"查看了资料箱里的 {len(shown)} 条资料",
        text=json.dumps(
            {
                "总数": len(records),
                "返回": len(shown),
                "资料": [material_brief(record) for record in shown],
            },
            ensure_ascii=False,
        ),
        link="/materials",
        data=[MaterialSummary.model_validate(record) for record in records],
    )


def _run_get_material(db: Session, payload: GetMaterialInput) -> ActionOutcome:
    from ...material_files import enrich_material_file_ids
    from ...materials import material_detail_text, material_or_none

    material = material_or_none(db, payload.material_id)
    if material is None:
        raise ActionError("not_found", "资料不存在或已被删除")
    return ActionOutcome(
        summary=f"读取了资料「{material.title or material.category}」",
        text=material_detail_text(material),
        link="/materials",
        # 历史图片附件没有 file_id：响应里按来源反查补上（只读），前端才能给「另存为」。
        data=enrich_material_file_ids(db, material),
    )


_ModelT = TypeVar("_ModelT", bound=BaseModel)


def _validate_business_payload(model: type[_ModelT], fields: dict) -> _ModelT:
    """用业务 schema 复核同一份校验器；失败统一转 invalid_input（两侧同码）。

    契约层 input_model 为了保住工具侧的部分合并语义跳过了跨字段校验（见类文档），
    真正的业务校验在这里做——不复制规则，直接复用 MaterialCreate/MaterialUpdate。
    """
    try:
        return model.model_validate(fields)
    except ValidationError as exc:
        details = "；".join(
            f"{'.'.join(str(item) for item in error.get('loc', ())) or 'arguments'}: "
            f"{error.get('msg', '参数不合法')}"
            for error in exc.errors()
        )
        raise ActionError("invalid_input", details or "参数校验失败") from exc


def _create_payload(payload: CreateMaterialInput) -> MaterialCreate:
    """把契约入参还原成业务 payload（路由/工具共用；工具侧的 files 由 tool_fields 剥离）。"""
    return _validate_business_payload(MaterialCreate, payload.model_dump())


def _run_create_material(db: Session, payload: CreateMaterialInput) -> ActionOutcome:
    """路由语义：整份 MaterialCreate + 附件落盘副本。"""
    from ...material_files import save_file_copies as _save_file_copies
    from ...materials import create_material as create_material_record

    material = create_material_record(db, _create_payload(payload))
    _save_file_copies(db, material)
    return ActionOutcome(
        summary=f"把「{material.title or material.category}」收进了资料箱",
        text=json.dumps({"id": material.id, "title": material.title}, ensure_ascii=False),
        link="/materials",
        changed=True,
        data=MaterialOut.model_validate(material),
    )


def _merged_update_payload(material, payload: UpdateMaterialInput):
    """工具侧历史语义：只改显式给出的五个字段，其余（含附件）保留原值。"""
    fields = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if key in _TOOL_UPDATE_FIELDS
    }
    if not fields:
        raise ActionError("invalid_request", "没有给出要修改的字段")
    merged = {
        "title": material.title,
        "category": material.category,
        "content": material.content,
        "url": material.url,
        "files": material.files or [],
        "note": material.note,
        **fields,
    }
    return _validate_business_payload(MaterialUpdate, merged), sorted(fields)


def _run_update_material(db: Session, payload: UpdateMaterialInput) -> ActionOutcome:
    """路由语义：PUT 整份替换 + 每次保存都落附件副本。工具侧走 run_tool（旧合并语义）。"""
    from ...material_files import save_file_copies as _save_file_copies
    from ...materials import material_or_none
    from ...materials import update_material as update_material_record

    material = material_or_none(db, payload.material_id)
    if material is None:
        raise ActionError("not_found", "资料不存在或已被删除")
    update_payload = _validate_business_payload(
        MaterialUpdate, payload.model_dump(exclude={"material_id"})
    )
    updated = update_material_record(db, material, update_payload)
    _save_file_copies(db, updated)
    return ActionOutcome(
        summary=f"更新了资料「{updated.title or updated.category}」",
        text=json.dumps({"id": updated.id, "updated": []}, ensure_ascii=False),
        link="/materials",
        changed=True,
        data=MaterialOut.model_validate(updated),
    )


def _run_tool_update_material(db: Session, payload: UpdateMaterialInput) -> ActionOutcome:
    """工具语义：先合并记录现值再校验（旧 handler 行为），不落附件副本。"""
    from ...materials import material_or_none
    from ...materials import update_material as update_material_record

    material = material_or_none(db, payload.material_id)
    if material is None:
        raise ActionError("not_found", "资料不存在或已被删除")
    update_payload, updated_fields = _merged_update_payload(material, payload)
    updated = update_material_record(db, material, update_payload)
    return ActionOutcome(
        summary=f"更新了资料「{updated.title or updated.category}」",
        text=json.dumps({"id": updated.id, "updated": updated_fields}, ensure_ascii=False),
        link="/materials",
        changed=True,
        data=MaterialOut.model_validate(updated),
    )


def _preview_create_material(db: Session, payload: CreateMaterialInput) -> WritePreview:
    from ...assistant_tools.previews import preview_create_material

    return preview_create_material(db, payload.model_dump(exclude_unset=True, mode="json"))


def _preview_update_material(db: Session, payload: UpdateMaterialInput) -> WritePreview:
    from ...assistant_tools.previews import preview_update_material

    return preview_update_material(db, payload.model_dump(exclude_unset=True, mode="json"))


_ACTIONS: dict[str, ActionSpec] | None = None


def material_actions() -> dict[str, ActionSpec]:
    """构建（并注册）materials 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_materials = define_action(
        ActionSpec(
            name="list_materials",
            description=(
                "列出资料箱里的资料（找工作与面试相关的材料：证书、作品、链接、笔记、"
                "面试总结、实习材料等）。用户提到「我之前存过…」「资料箱里有什么」时用它。"
            ),
            input_model=ListMaterialsInput,
            permission=Permission.READ_ONLY,
            run=_run_list_materials,
            service_entry="materials.list_materials",
            tool_fields=("keyword", "category", "limit"),
            tool_defaults=(("limit", _DEFAULT_LIST_LIMIT),),
            # 旧 GET /api/materials 走 FastAPI query 参数，未知 query 一律忽略；保持兼容。
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/materials", list[MaterialSummary], tags=("materials",)),
        )
    )
    get_material = define_action(
        ActionSpec(
            name="get_material",
            description="按 id 读取资料箱里某一条资料的完整内容（含附件里提取出的文字）。",
            input_model=GetMaterialInput,
            permission=Permission.READ_ONLY,
            run=_run_get_material,
            service_entry="materials.material_detail_text",
            tool_fields=("material_id",),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/materials/{material_id}", MaterialOut, tags=("materials",)),
        )
    )
    create_material = define_action(
        ActionSpec(
            name="create_material",
            description=(
                "把一段资料收进资料箱。只在用户明确要求保存时调用。"
                "适合存的是与找工作/面试相关的东西：证书、作品、面经、公司信息、面试复盘等。"
            ),
            input_model=CreateMaterialInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_create_material,
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.materials", "_tool_create_material"
            ),
            preview=_preview_create_material,
            service_entry="materials.create_material",
            tool_fields=("title", "category", "content", "url", "note"),
            http=HttpRoute(
                "POST", "/api/materials", MaterialOut, status_code=201, tags=("materials",)
            ),
        )
    )
    update_material = define_action(
        ActionSpec(
            name="update_material",
            description="修改资料箱里已有的一条资料（只传要改的字段，其余保持不变）。",
            input_model=UpdateMaterialInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_material,
            run_tool=_run_tool_update_material,
            preview=_preview_update_material,
            service_entry="materials.update_material",
            tool_fields=("material_id", "title", "category", "content", "url", "note"),
            http=HttpRoute("PUT", "/api/materials/{material_id}", MaterialOut, tags=("materials",)),
        )
    )
    _ACTIONS = {
        spec.name: spec for spec in (list_materials, get_material, create_material, update_material)
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return material_actions()


__all__ = [
    "CreateMaterialInput",
    "GetMaterialInput",
    "ListMaterialsInput",
    "UpdateMaterialInput",
    "actions",
    "material_actions",
]

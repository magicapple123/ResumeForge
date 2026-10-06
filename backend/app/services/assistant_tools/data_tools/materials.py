"""资料箱（materials）域的工具实现。"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ....models.material import Material
from ....schemas.material import MaterialCreate, MaterialUpdate
from ... import trash
from ...materials import (
    create_material as create_material_record,
)
from ...materials import (
    list_materials,
    material_brief,
    material_detail_text,
)
from ...materials import (
    update_material as update_material_record,
)
from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult


def _material_or_error(db: Session, arguments: dict) -> Material:
    try:
        material_id = int(arguments.get("material_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供资料 id（可以先用 list_materials 查）") from None
    material = trash.get_live(db, Material, material_id)
    if material is None:
        raise ValueError(f"资料 {material_id} 不存在")
    return material


def _tool_list_materials(db: Session, arguments: dict) -> ToolResult:
    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    materials = list_materials(
        db,
        keyword=str(arguments.get("keyword") or ""),
        category=str(arguments.get("category") or ""),
    )
    shown = materials[:limit]
    payload = {
        "总数": len(materials),
        "返回": len(shown),
        "资料": [material_brief(item) for item in shown],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了资料箱里的 {len(shown)} 条资料",
        link="/materials",
    )


def _tool_get_material(db: Session, arguments: dict) -> ToolResult:
    material = _material_or_error(db, arguments)
    return ToolResult(
        text=material_detail_text(material),
        summary=f"读取了资料「{material.title or material.category}」",
        link="/materials",
    )


def _tool_create_material(db: Session, arguments: dict) -> ToolResult:
    # 只放行工具**声明过**的字段：附件（files）不在 create_material 的参数里，
    # 留着它只会让人以为助手能给资料挂附件。
    payload = MaterialCreate.model_validate(
        {
            key: value
            for key, value in arguments.items()
            if key in {"title", "category", "content", "url", "note"}
        }
    )
    material = create_material_record(db, payload)
    return ToolResult(
        text=json.dumps({"id": material.id, "title": material.title}, ensure_ascii=False),
        summary=f"把「{material.title or material.category}」收进了资料箱",
        link="/materials",
        changed=True,
    )


def _tool_update_material(db: Session, arguments: dict) -> ToolResult:
    material = _material_or_error(db, arguments)
    fields = {
        key: value
        for key, value in arguments.items()
        if key in {"title", "category", "content", "url", "note"}
    }
    if not fields:
        raise ValueError("没有给出要修改的字段")
    payload = MaterialUpdate.model_validate(
        {
            "title": material.title,
            "category": material.category,
            "content": material.content,
            "url": material.url,
            "files": material.files or [],
            "note": material.note,
            **fields,
        }
    )
    updated = update_material_record(db, material, payload)
    return ToolResult(
        text=json.dumps({"id": updated.id, "updated": sorted(fields)}, ensure_ascii=False),
        summary=f"更新了资料「{updated.title or updated.category}」",
        link="/materials",
        changed=True,
    )

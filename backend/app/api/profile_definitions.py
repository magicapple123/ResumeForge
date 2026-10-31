# SPDX-License-Identifier: Apache-2.0
"""资料定义接口：自建大字段下的小字段管理，以及字段偏好（hidden / collapsed_override）。

薄路由：参数校验、调 service、返回 schema。字段序列化函数 field_out / section_out
**也放在这里**：工作区读取与定义写入返回的是同一个字段形状，如果两处各拼一份，
迟早出现"一个入口有 collapsed_override、另一个没有"的漂移。

错误映射由 application.py 统一注册的 StoreError 处理器完成：响应体固定
{detail, code, ...extra}，409 额外带 revision，前端 ApiError.businessCode 直接消费，
不在这几个路由里各写一套 HTTPException 文案。

偏好更新的三态：hidden / collapsed_override 都是"没传=不改"，而 collapsed_override
还多一个"传 null=恢复跟随代码默认"；两者都由 PreferencePatchIn.model_fields_set 区分，
服务层不依赖"None 等于不改"的模糊约定。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.profile_field_catalog import (
    CatalogFieldOut,
    CatalogSectionOut,
    FieldPlacementCatalogOut,
    HeaderCatalogFieldOut,
)
from ..schemas.profile_workspace import (
    CustomFieldCreateIn,
    CustomFieldUpdateIn,
    FieldDeletionImpactOut,
    FieldDeletionIn,
    FieldOut,
    PreferencePatchIn,
    SectionOut,
)
from ..services.profile import (
    definition_catalog,
    definition_store,
    field_placement,
    field_preferences,
    workspace_bootstrap,
)
from ..services.resume import document_catalog
from ..services.resume.resume_labels import field_labels, normalize_language

router = APIRouter(prefix="/api/profile", tags=["profile-definitions"])


def field_out(field: Any) -> FieldOut:
    """字段只读形状：定义 + 用户偏好（hidden / collapsed_override）一次给全。"""
    return FieldOut(
        field_id=field.field_id,
        section_key=field.section_key,
        key=field.key,
        label=field.label,
        field_type=field.field_type,
        order=field.order,
        default_collapsed=field.default_collapsed,
        enum_suggestions=list(field.enum_suggestions),
        is_builtin=field.is_builtin,
        private=field.private,
        default_placement=field.default_placement,
        effective_placement=field.effective_placement,
        material_only=field.material_only,
        llm_allowed=field.llm_allowed,
        webform_allowed=field.webform_allowed,
        hidden=field.hidden,
        collapsed_override=field.collapsed_override,
        preference_revision=field.preference_revision,
        revision=field.revision,
    )


def section_out(section: Any) -> SectionOut:
    """分区只读形状：字段顺序即界面顺序（默认字段在前、自建字段在后）。"""
    return SectionOut(
        key=section.key,
        name=section.name,
        form=section.form,
        is_builtin=section.is_builtin,
        carrier_field_id=section.carrier_field_id,
        material_only=section.material_only,
        provenance=list(section.provenance),
        fields=[field_out(item) for item in section.fields],
        revision=section.revision,
        deleted_at=getattr(section, "deleted_at", None),
    )


_FIELD_TYPE_BY_FORMAT: dict[str, str] = {
    "date": "date_text",
    "date_range": "date_text",
    "list": "multi_line",
    "text": "single_line",
    "enum": "single_line",
    "url": "single_line",
    "authors": "single_line",
    "number": "single_line",
}


def _custom_catalog_field(row: dict[str, Any], *, placement: str | None = None) -> CatalogFieldOut:
    """自定义字段的目录项：默认位置/仅素材来自 0069 的定义列（已算成有效位置）。"""
    field_id = str(row["field_id"])
    return CatalogFieldOut(
        key="custom:" + field_id,
        label=str(row["label"]),
        format="text",
        field_type=str(row["field_type"]),
        default_placement=placement or str(row["default_placement"]),
        material_only=bool(row["material_only"]),
        is_builtin=False,
        source_field_id=field_id,
        field_id=field_id,
    )


@router.get("/field-placement-catalog", response_model=FieldPlacementCatalogOut)
def read_field_placement_catalog(language: str = "zh-CN", db: Session = Depends(get_db)):
    """资料字段的纸面位置目录（标签 / 格式 / 默认位置 / 仅素材 / 资料字段 id）。

    资料页与制作台共用这一份，避免前端复制 type→placement 的映射。自定义字段的默认
    位置来自 0069 的定义列；仅素材字段的 placement 恒为 hidden（D6）。
    """
    lang = normalize_language(language)
    labels = field_labels(lang)
    custom = field_placement.custom_field_definitions(db)

    # 页眉目录：契约名 header_fields（header 保留同值别名，兼容旧读法）。
    header_fields = [
        HeaderCatalogFieldOut(
            key=spec.key,
            label=labels.get(spec.label_key, spec.key),
            placement=spec.placement,
            format=spec.fmt,
            source_field_id=spec.profile_key,
        )
        for spec in document_catalog.HEADER_FIELDS
    ]
    # 基本信息上的自定义字段是"仅素材"（R-43）：不上纸面，只进生成/网申素材。
    header_fields.extend(
        HeaderCatalogFieldOut(
            key="custom:" + str(row["field_id"]),
            label=str(row["label"]),
            placement="hidden",
            format="text",
            source_field_id=str(row["field_id"]),
        )
        for row in custom.get("basic_info", [])
    )

    sections: list[CatalogSectionOut] = []
    for spec in document_catalog.sections():
        profile_spec = definition_catalog.SECTION_BY_KEY.get(spec.profile_key)
        fields = [
            CatalogFieldOut(
                key=field.key,
                label=labels.get(field.label_key, field.key),
                format=field.fmt,
                field_type=_FIELD_TYPE_BY_FORMAT.get(field.fmt, "single_line"),
                default_placement=field.default_placement,
                material_only=field.material_only,
                is_builtin=True,
                source_field_id=document_catalog.profile_field_id(spec.key, field.key),
                field_id=document_catalog.profile_field_id(spec.key, field.key),
                private=field.private,
            )
            for field in spec.fields
        ]
        fields.extend(
            _custom_catalog_field(row) for row in custom.get(spec.profile_key, [])
        )
        sections.append(
            CatalogSectionOut(
                key=spec.key,
                title=document_catalog.resolve_section_title(spec.key, "", lang),
                title_key=spec.title_key,
                kind=spec.kind,
                profile_section_key=spec.profile_key,
                material_only=bool(profile_spec.material_only) if profile_spec else False,
                fields=fields,
            )
        )
    for row in workspace_bootstrap.active_custom_sections(db):
        sections.append(
            CatalogSectionOut(
                key=row.key,
                title=row.name,
                title_key="",
                kind="entries",
                profile_section_key=row.key,
                fields=[_custom_catalog_field(item) for item in custom.get(row.key, [])],
            )
        )
    return FieldPlacementCatalogOut(
        language=lang, header_fields=header_fields, header=header_fields, sections=sections
    )


@router.post("/sections/{section_key}/fields", response_model=FieldOut, status_code=201)
def create_custom_field(
    section_key: str, payload: CustomFieldCreateIn, db: Session = Depends(get_db)
) -> FieldOut:
    """新建自定义小字段（任意活动分区；每分区 ≤20 个）。

    ``default_placement`` / ``material_only`` 可选：不传时按字段类型自动
    （单行/日期 → 正文后灰字、多行 → 正文）且上纸面，与旧客户端行为一致。
    """
    field = definition_store.create_custom_field(
        db,
        section_key,
        payload.label,
        payload.field_type,
        default_placement=payload.default_placement,
        material_only=bool(payload.material_only),
        expected_revision=payload.expected_revision,
    )
    return field_out(field)


@router.patch("/sections/{section_key}/fields/{field_id}", response_model=FieldOut)
def update_custom_field(
    section_key: str,
    field_id: str,
    payload: CustomFieldUpdateIn,
    db: Session = Depends(get_db),
) -> FieldOut:
    """改名 / 调整自建字段顺序 / 改纸面位置；默认字段不能走这里（只能改偏好）。

    纸面属性用 ``model_fields_set`` 区分"没传"与"清空为按类型自动"：
    显式传 ``default_placement: null`` 才恢复自动，不传则保持原值。
    """
    update_kwargs: dict[str, Any] = {
        "label": payload.label,
        "sort_order": payload.sort_order,
        "expected_revision": payload.expected_revision,
    }
    if "default_placement" in payload.model_fields_set:
        update_kwargs["default_placement"] = payload.default_placement
    if "material_only" in payload.model_fields_set:
        update_kwargs["material_only"] = payload.material_only
    field = definition_store.update_custom_field(db, section_key, field_id, **update_kwargs)
    return field_out(field)


@router.delete("/sections/{section_key}/fields/{field_id}", response_model=FieldDeletionImpactOut)
def delete_custom_field(
    section_key: str,
    field_id: str,
    payload: FieldDeletionIn,
    db: Session = Depends(get_db),
) -> FieldDeletionImpactOut:
    """软删自定义字段（值保留在条目 JSON）。含值且未确认 → 409 field_has_values。"""
    result = definition_store.delete_custom_field(
        db,
        section_key,
        field_id,
        expected_revision=payload.expected_revision,
        confirm_with_values=payload.confirm_with_values,
    )
    return FieldDeletionImpactOut(**result)


@router.get(
    "/sections/{section_key}/fields/{field_id}/deletion-impact",
    response_model=FieldDeletionImpactOut,
)
def read_field_deletion_impact(
    section_key: str, field_id: str, db: Session = Depends(get_db)
) -> FieldDeletionImpactOut:
    """删除前的影响面：多少条记录已填写、恢复位置、当前 revision（R-14）。"""
    return FieldDeletionImpactOut(
        **definition_store.field_deletion_impact(db, section_key, field_id)
    )


@router.patch("/field-preferences/{field_id}", response_model=FieldOut)
def patch_field_preference(
    field_id: str, payload: PreferencePatchIn, db: Session = Depends(get_db)
) -> FieldOut:
    """hidden 与 collapsed_override 局部独立更新；恢复 hidden 后折叠记忆仍在（R-67）。"""
    updates: dict[str, Any] = {}
    if "hidden" in payload.model_fields_set and payload.hidden is not None:
        updates["hidden"] = payload.hidden
    if "collapsed_override" in payload.model_fields_set:
        # 显式 null = 恢复"跟随代码默认"，与"没传"（保持原值）严格区分。
        updates["collapsed_override"] = payload.collapsed_override
    field_preferences.patch_preference(
        db,
        field_id,
        section_key=payload.section_key,
        expected_revision=payload.expected_revision,
        **updates,
    )
    section = definition_store.get_section(db, payload.section_key)
    if section is None:  # patch_preference 已校验分区存在；这里是类型收窄 + 防御性出口
        raise LookupError("分区不存在")
    field = next(
        (item for item in section.fields if item.field_id == field_id),
        None,
    )
    if field is None:  # 服务层已校验所属分区，这里只是防御性出口
        raise LookupError("字段不属于该分区")
    return field_out(field)

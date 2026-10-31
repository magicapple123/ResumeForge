# SPDX-License-Identifier: Apache-2.0
"""资料字段的纸面位置目录（GET /api/profile/field-placement-catalog）。

为什么由后端下发（计划 §9.6）：v2 里"某个资料字段默认落在哪个抽屉"的唯一来源是
services/resume/document_catalog.py；如果前端再复制一份 type→placement 映射，改一次
默认位置就要改两处，且必然漂移。资料页（我的资料）与制作台（添加字段菜单）共用本接口。

目录只描述**定义与默认值**，不含用户数据：内置字段来自代码目录，自定义字段来自当前
方案的活动定义（含 0069 的 default_placement / material_only）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field

__all__ = [
    "CatalogFieldOut",
    "CatalogSectionOut",
    "FieldPlacementCatalogOut",
    "HeaderCatalogFieldOut",
]


class HeaderCatalogFieldOut(BaseModel):
    """页眉字段目录项：placement 是 header 位置（name/name_meta/subtitle/contact/photo）。"""

    key: str
    label: str = ""
    placement: str = "contact"
    format: str = "text"
    source_field_id: str = ""


class CatalogFieldOut(BaseModel):
    """一个条目字段的纸面目录：位置 / 格式 / 是否仅素材 / 资料字段稳定 id。"""

    # v2 item key：内置字段与 v1 属性名对齐；自定义字段为 custom:<field_id>。
    key: str
    label: str = ""
    # 纸面格式（text/date/date_range/list/enum/url/authors/number）；自定义字段为 text。
    format: str = "text"
    # 资料字段类型（single_line/multi_line/date_text/enum/number）：编辑器控件类型依据。
    field_type: str = "single_line"
    # 纸面默认位置（D6）：title/meta/lead/trail/body/hidden。
    default_placement: str = "trail"
    material_only: bool = False
    private: bool = False
    is_builtin: bool = True
    # 资料字段稳定 id（内置如 educations.education_school，自定义如 fld_xxx）。
    source_field_id: str = ""
    # 兼容别名（旧调用方/测试用过 field_id）：与 source_field_id 同值。
    field_id: str = ""


class CatalogSectionOut(BaseModel):
    """一个板块的字段目录；key 是 v2 板块 key，profile_section_key 是资料分区 key。"""

    key: str
    title: str
    # 系统板块的标题 key（前端可自行翻译）；自建板块为空串（用 title）。
    title_key: str = ""
    kind: str = "entries"
    profile_section_key: str = ""
    material_only: bool = False
    fields: list[CatalogFieldOut] = Field(default_factory=list)


class FieldPlacementCatalogOut(BaseModel):
    """资料页与制作台共用的字段位置目录。"""

    language: str = "zh-CN"
    # 页眉目录（基本信息）：header_fields 是契约名；header 保留为同值兼容别名。
    header_fields: list[HeaderCatalogFieldOut] = Field(default_factory=list)
    header: list[HeaderCatalogFieldOut] = Field(default_factory=list)
    sections: list[CatalogSectionOut] = Field(default_factory=list)
    # 页面提示："仅素材字段不上纸面"的统一文案依据（前端不硬编码）。
    material_only_note: str = "仅素材字段只用于生成与网申，不出现在纸面上"

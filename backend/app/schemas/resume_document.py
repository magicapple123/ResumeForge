# SPDX-License-Identifier: Apache-2.0
"""简历文档模型 v2（字段级文档模型）。

为什么要有这个模型（v1 的问题）：v1 把正文拆成 11 个按分区写死的数组，每个分区还有
"承载区文本 + 固定灰行"两套规则；同一个字段在 HTML / PDF / Word / Markdown 四个出口各有
一份拼装代码，用户想调字段位置只能改到"有槽位的字段"，自定义字段只能塞进正文变成
"标签：值"字符串。v2 把每个字段变成一条 item：

- items 是一条有序列表，位置（title/meta/lead/trail/body/hidden）是 item 上的数据
  （D1/D2）；拖拽 = 改顺序 + 改 placement，hidden = 数据保留但不上纸面；
- header / section / entry 三层容器；自建板块与系统板块同构（D9）；
- 模板只负责外壳 + CSS，字段拼装/排序/换行/分页由 document_plan 统一决定（D10）；
- 字段存规范值 + format，显示时再格式化（D7）：切语言不迁数据。

兼容策略（D11/D12）：v2 是唯一存储/渲染/编辑格式；v1 ResumeContent 只作为
document_converter 的输入存在（读旧简历时一次性转换）。本模块不 import services
（schemas 是叶子层，见 tests/test_import_direction.py），所以转换逻辑不在 schema 里。

id 口径（W01）：所有 id 匹配 OBJECT_ID_PATTERN（8-32 位字母/数字/_/-）。旧内容没有 id
时由 ensure_document_ids 补；TextItem.id 沿用 v1 point id，这样大纲/隐藏/复制这些既有
能力在 v2 下仍能按 id 定位。
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .resume_entries import (
    MAX_RESUME_LIST_ITEMS,
    MAX_RESUME_SECTION_ITEMS,
    MAX_RESUME_TEXT_CHARS,
)
from .resume_research import MAX_AUTHORS, ResumeAuthor

# ===== 枚举（D1/D3/D4）=====

Placement = Literal["title", "meta", "lead", "trail", "body", "hidden"]
HeaderPlacement = Literal["name", "name_meta", "subtitle", "contact", "photo", "hidden"]
Format = Literal["text", "date", "date_range", "list", "enum", "url", "authors", "number"]
SectionKind = Literal["entries", "inline", "text"]
HeadLayout = Literal["split", "stacked", "meta_first"]
Wrap = Literal["none", "paren"]
Join = Literal["comma", "semicolon", "dot", "inline"]
BodyStyle = Literal["bullet", "paragraph"]

# 与 services/resume/document_identity.OBJECT_ID_PATTERN 逐字相同；schemas 不能 import
# services，所以这里再声明一份，由 tests/test_document_model.py 钉住两者一致。
OBJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,32}$")

# 值长度：沿用 v1 的上限口径（schema 兜底；服务层/转换器负责截断并给 warning）。
MAX_ITEM_VALUE_CHARS = MAX_RESUME_TEXT_CHARS
MAX_ITEM_LABEL_CHARS = 64
MAX_ITEM_KEY_CHARS = 128
MAX_LIST_VALUES = MAX_RESUME_LIST_ITEMS
MAX_HEADER_ITEMS = 40
MAX_HEADER_VALUE_CHARS = 2_000_000
MAX_CONTACT_BREAKS = 10

__all__ = [
    "AuthorsItem",
    "BodyStyle",
    "DocumentValidationError",
    "EntryLayout",
    "FieldItem",
    "FieldSource",
    "Format",
    "HeadLayout",
    "HeaderItem",
    "HeaderPlacement",
    "Join",
    "ListItem",
    "MAX_AUTHORS",
    "MAX_CONTACT_BREAKS",
    "MAX_HEADER_ITEMS",
    "MAX_HEADER_VALUE_CHARS",
    "MAX_ITEM_KEY_CHARS",
    "MAX_ITEM_LABEL_CHARS",
    "MAX_ITEM_VALUE_CHARS",
    "MAX_LIST_VALUES",
    "OBJECT_ID_PATTERN",
    "Placement",
    "ResumeDocument",
    "ResumeEntry",
    "ResumeHeader",
    "ResumeItem",
    "ResumeSection",
    "SectionKind",
    "SectionLayout",
    "TextItem",
    "Wrap",
]


def new_object_id(prefix: str = "ob_") -> str:
    """生成一个符合 W01 口径的新对象 id（前缀 + 16 位 hex，共 19-20 位）。"""
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def _optional_id(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if not OBJECT_ID_PATTERN.fullmatch(text):
        raise ValueError("对象标识不合法（需 8-32 位字母/数字/_/-）")
    return text


# ===== item（discriminated union，kind）=====


class FieldSource(BaseModel):
    """字段来源（D8）：这条 item 来自资料库哪个分区字段；手动新增的字段为 None。"""

    model_config = ConfigDict(extra="ignore")

    section_key: str = Field(default="", max_length=64)
    field_id: str = Field(default="", max_length=64)


class _ItemBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default="", max_length=32)
    placement: Placement = "trail"
    show_label: bool = True
    solo: bool = False
    # 编辑态辅助：隐藏前的位置；隐藏后再显示由前端恢复到此处。
    # 归 item 一起持久化（document_to_json 只在非 None 时写出），planner 不消费。
    hidden_from: Placement | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _clean_id(cls, value: object) -> str:
        # 空串/None 表示"待补"，由 ensure_document_ids 生成；非法值在写入校验阶段拒绝。
        return "" if value is None else str(value).strip()

    @field_validator("id")
    @classmethod
    def _id_pattern(cls, value: str) -> str:
        if value and not OBJECT_ID_PATTERN.fullmatch(value):
            raise ValueError("对象标识不合法（需 8-32 位字母/数字/_/-）")
        return value


class FieldItem(_ItemBase):
    """一个标量字段（学校/绩点/日期/枚举/链接等）。"""

    kind: Literal["field"] = "field"
    key: str = Field(default="", max_length=MAX_ITEM_KEY_CHARS)
    label: str = Field(default="", max_length=MAX_ITEM_LABEL_CHARS)
    value: str = Field(default="", max_length=MAX_ITEM_VALUE_CHARS)
    format: Format = "text"
    wrap: Wrap = "none"
    source: FieldSource | None = None
    body_style: BodyStyle = "bullet"


class ListItem(_ItemBase):
    """一个列表字段（核心课程/技术栈）：保持结构化，不拍平成字符串。"""

    kind: Literal["list"] = "list"
    key: str = Field(default="", max_length=MAX_ITEM_KEY_CHARS)
    label: str = Field(default="", max_length=MAX_ITEM_LABEL_CHARS)
    values: list[str] = Field(default_factory=list, max_length=MAX_LIST_VALUES)
    # v1 hidden_points 里的列表要点：数据保留、不上纸面（v1 要点级隐藏的 v2 等价物）。
    hidden_values: list[str] = Field(default_factory=list, max_length=MAX_LIST_VALUES)
    join: Join = "semicolon"
    body_style: BodyStyle = "bullet"


class AuthorsItem(_ItemBase):
    """作者类字段（论文作者/专利发明人）：本人加粗与通讯作者星号由渲染器处理。"""

    kind: Literal["authors"] = "authors"
    key: str = Field(default="", max_length=MAX_ITEM_KEY_CHARS)
    label: str = Field(default="", max_length=MAX_ITEM_LABEL_CHARS)
    authors: list[ResumeAuthor] = Field(default_factory=list, max_length=MAX_AUTHORS)


class TextItem(BaseModel):
    """正文文本块（原 v1 要点/段落）：不参与位置拖拽，只有 hidden 开关。

    id 沿用 v1 point id（大纲/隐藏/复制兼容）；没有则由 normalize 生成。
    """

    model_config = ConfigDict(extra="ignore")

    kind: Literal["text"] = "text"
    id: str = Field(default="", max_length=32)
    style: BodyStyle = "bullet"
    text: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    hidden: bool = False

    @field_validator("id", mode="before")
    @classmethod
    def _clean_id(cls, value: object) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("id")
    @classmethod
    def _id_pattern(cls, value: str) -> str:
        if value and not OBJECT_ID_PATTERN.fullmatch(value):
            raise ValueError("对象标识不合法（需 8-32 位字母/数字/_/-）")
        return value


ResumeItem = Annotated[FieldItem | ListItem | AuthorsItem | TextItem, Field(discriminator="kind")]


# ===== header / layout / section / entry =====


class HeaderItem(BaseModel):
    """页眉字段：位置为 name / name_meta / subtitle / contact / photo / hidden。"""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["field"] = "field"
    id: str = Field(default="", max_length=32)
    key: str = Field(default="", max_length=MAX_ITEM_KEY_CHARS)
    label: str = Field(default="", max_length=MAX_ITEM_LABEL_CHARS)
    # 页眉的 photo 是 data URL（可到数百 KB），不能套正文值的 5 万字符上限；
    # 其余页眉字段的实际长度由 converter/校验层按字段目录限制。
    value: str = Field(default="", max_length=MAX_HEADER_VALUE_CHARS)
    placement: HeaderPlacement = "contact"
    format: Format = "text"

    @field_validator("id", mode="before")
    @classmethod
    def _clean_id(cls, value: object) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("id")
    @classmethod
    def _id_pattern(cls, value: str) -> str:
        if value and not OBJECT_ID_PATTERN.fullmatch(value):
            raise ValueError("对象标识不合法（需 8-32 位字母/数字/_/-）")
        return value


class ResumeHeader(BaseModel):
    model_config = ConfigDict(extra="ignore")

    items: list[HeaderItem] = Field(default_factory=list, max_length=MAX_HEADER_ITEMS)
    # 沿用 v1 format_config.contact_breaks：这些字段之后强制换行（白名单在 planner 收口）。
    contact_breaks: list[str] = Field(default_factory=list, max_length=MAX_CONTACT_BREAKS)


class SectionLayout(BaseModel):
    """分区级默认版式：lead/trail 列布局 + 分页/标题开关（条目可覆盖列布局）。"""

    model_config = ConfigDict(extra="ignore")

    columns: Literal[1, 2, 3] = 1
    align: Literal["equal", "flow"] = "equal"
    gap: float | None = Field(default=None, ge=0, le=30)
    hide_title: bool = False
    keep_together: bool = False
    start_on_new_page: bool = False
    # 系统板块标题可覆盖；空 = 用语言包里的目录标题（自建板块标题永远用 section.title）。
    title_override: str = Field(default="", max_length=64)


class EntryLayout(BaseModel):
    """条目级覆盖：None = 继承分区（D4 两组灰字段同一套列布局）。"""

    model_config = ConfigDict(extra="ignore")

    head: HeadLayout = "split"
    columns: Literal[1, 2, 3] | None = None
    align: Literal["equal", "flow"] | None = None
    gap: float | None = Field(default=None, ge=0, le=10)
    # 条目级分页（计划 §6.2）：True = 该条目另起一页 / 尽量整条不跨页；
    # 与分区级取「或」得到生效值（planner 的 _effective_layout 负责合并）。
    start_on_new_page: bool = False
    keep_together: bool = False


class ResumeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = Field(default=None, max_length=32)
    hidden: bool = False
    lock_content: bool = False
    lock_layout: bool = False
    layout: EntryLayout = Field(default_factory=EntryLayout)
    # 单条目 item 上限沿用 v1 列表字段上限（500 行正文/要点）；更大是异常数据，
    # converter 负责合并/截断并给 warning（计划 §3.4 不静默丢文字）。
    items: list[ResumeItem] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)

    @field_validator("id")
    @classmethod
    def _id_pattern(cls, value: str | None) -> str | None:
        return _optional_id(value)


class ResumeSection(BaseModel):
    """一个板块：系统板块 key 见 document_catalog；自建板块 key = custom:<uuid>。"""

    model_config = ConfigDict(extra="ignore")

    key: str = Field(default="", max_length=64)
    title: str = Field(default="", max_length=64)
    kind: SectionKind = "entries"
    layout: SectionLayout = Field(default_factory=SectionLayout)
    entries: list[ResumeEntry] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)


class ResumeDocument(BaseModel):
    """一份简历的完整内容（存在 resumes.content JSON 列里）。"""

    model_config = ConfigDict(extra="ignore")

    version: Literal[2] = 2
    language: Literal["zh-CN", "en-US"] = "zh-CN"
    header: ResumeHeader = Field(default_factory=ResumeHeader)
    sections: list[ResumeSection] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)


class DocumentValidationError(ValueError):
    """v2 文档结构不合法；API 层翻成 422 + 可读路径（不静默修复）。"""


# 操作函数在 schemas/resume_document_ops.py，计划输出在 schemas/resume_document_plan.py；
# 都用模块级 __getattr__ 懒加载 re-export，保持既有导入路径不变、避免循环 import。
_OPS_EXPORT_NAMES = frozenset(
    (
        "block_index",
        "document_item_count",
        "document_to_json",
        "ensure_document_ids",
        "iter_entries",
        "iter_items",
        "new_object_id",
        "normalize_document",
        "parse_document",
        "validate_document_ids_v2",
    )
)
_PLAN_EXPORT_NAMES = frozenset(
    (
        "BlockPlan",
        "CellPlan",
        "DocumentPlan",
        "EntryPlan",
        "HeadPlan",
        "HeaderPlan",
        "Inline",
        "SectionPlan",
    )
)


def __getattr__(name: str):
    if name in _OPS_EXPORT_NAMES:
        from . import resume_document_ops

        return getattr(resume_document_ops, name)
    if name in _PLAN_EXPORT_NAMES:
        from . import resume_document_plan

        return getattr(resume_document_plan, name)
    raise AttributeError(name)

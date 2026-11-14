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

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .resume_entries import (
    MAX_RESUME_LIST_ITEMS,
    MAX_RESUME_SECTION_ITEMS,
    MAX_RESUME_TEXT_CHARS,
)
from .resume_research import MAX_AUTHORS, ResumeAuthor

# ===== 枚举（D1/D3/D4）=====

Placement = Literal["title", "meta", "lead", "trail", "body", "hidden"]
HeaderPlacement = Literal["name", "name_meta", "subtitle", "contact", "photo", "hidden"]
#: F20：页眉字段名的三态。`auto` 是默认值，也是存量文档的等价行为。
LabelMode = Literal["auto", "show", "hide"]
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
    "RowLayout",
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
    #: 兼容字段：新代码只读 `label_mode`，这里保留是为了旧文档/旧客户端能照常反序列化。
    show_label: bool = True
    #: F20 三态：auto = 按字段类型自动决定（默认，现状逐字节不变）；show = 印「电话：」；
    #: hide = 只印值。**旧文档**没有这个键时按 `show_label === false ? "hide" : "auto"` 回落。
    label_mode: LabelMode = "auto"

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


MAX_COLUMN_GAP = 30.0
"""逐间隔上限（字号倍数），与制作台「列间距」同一个口径。

任务 10 从 4 放宽到 8；本轮（问题 4）配合 UI 的 `MAX_GAP` 再放宽到 16——"两端"分布下
`gap` 会退化为最小间距，用户需要更大的取值空间。**只放宽不下调**：已有文档可能有 12，
下调会让旧内容校验失败。
"""

MAX_ENTRY_GAP = 30.0
"""条目级「列间距」上限（字号倍数）。分区级仍是 30（`SectionLayout.gap`），不下调。"""

WIDTH_SUM_TOLERANCE = 0.5
"""逐列宽度合计的容差（百分比）。前端会按 0.1 取整，浮点累加难免 99.99/100.01。"""


def _check_column_geometry(widths: list[float] | None, gaps: list[float] | None) -> None:
    """逐列宽度 / 逐间隔的自洽性校验（模型层只管自身，列数是否匹配交给 planner）。

    为什么不在模型里校验"长度 == columns"：条目级 `columns` 常为 `None`（继承分区），
    这里根本不知道生效列数。长度对不上时 planner 会**整体忽略**这两个字段（回落到等宽），
    所以宽松校验不会产生"半个宽度生效"的坏状态。
    """
    if widths is not None:
        if len(widths) < 2:
            raise ValueError("逐列宽度至少要两列")
        if any((width <= 0 or width > 100) for width in widths):
            raise ValueError("逐列宽度必须在 0 到 100 之间")
        if abs(sum(widths) - 100.0) > WIDTH_SUM_TOLERANCE:
            raise ValueError("逐列宽度合计必须为 100")
    if gaps is not None:
        if not gaps:
            raise ValueError("逐间隔不能为空列表")
        if any((gap < 0 or gap > MAX_COLUMN_GAP) for gap in gaps):
            raise ValueError(f"逐间隔必须在 0 到 {MAX_COLUMN_GAP:g} 之间（字号倍数）")
        if widths is not None and len(gaps) != len(widths) - 1:
            raise ValueError("逐间隔数量必须比列数少一")


class RowLayout(BaseModel):
    """一组灰字段（正文前 lead / 正文后 trail）的列布局（问题 4）。

    为什么要拆出来：v2 的 `EntryLayout` 只有一套 `columns / align / gap`，正文前与正文后
    被迫共用同一套列数——"正文前排 2 列、正文后排 3 列"做不到。`RowLayout` 让两侧各带
    一份；**逐列宽度 / 逐间隔也一起搬进来**，否则分侧之后共享的 `column_widths` 长度必然
    与另一侧的列数对不上，`resolved_column_geometry()` 会整体作废回落等宽，表现为"我明明
    设了宽度却没生效"。

    全部字段可空：`None` = 该层没设置，继续往继承链的上一层找（见 planner 的
    `_effective_row_layout`）。旧文档里没有这两块，解析出来是 `None`，产物逐字节不变。
    """

    model_config = ConfigDict(extra="ignore")

    columns: Literal[1, 2, 3] | None = None
    align: Literal["equal", "flow"] | None = None
    # 分布：start = 列宽按内容、整体靠左（现状）；between = 剩余空白均分到列之间，
    # 最后一列的右缘落在内容区右边界（HTML `justify-content: space-between`）。
    justify: Literal["start", "between"] | None = None
    gap: float | None = Field(default=None, ge=0, le=30)
    column_widths: list[float] | None = Field(default=None, max_length=3)
    column_gaps: list[float] | None = Field(default=None, max_length=2)

    @model_validator(mode="after")
    def _check_row_geometry(self) -> RowLayout:
        _check_column_geometry(self.column_widths, self.column_gaps)
        return self


class SectionLayout(BaseModel):
    """分区级默认版式：lead/trail 列布局 + 分页/标题开关（条目可覆盖列布局）。"""

    model_config = ConfigDict(extra="ignore")

    columns: Literal[1, 2, 3] = 1
    align: Literal["equal", "flow"] = "equal"
    gap: float | None = Field(default=None, ge=0, le=30)
    # 逐列宽度（百分比，合计 100）与逐间隔（字号倍数，长度 = 列数−1）。
    # 都为 None = 沿用 `columns` + `gap` 的等宽口径，历史文档逐像素不变。
    column_widths: list[float] | None = Field(default=None, max_length=3)
    column_gaps: list[float] | None = Field(default=None, max_length=2)
    # 分布（问题 4）：start = 现状靠左；between = 剩余空白均分到列之间（最后一列贴右边界）。
    # 只在 align=equal、columns>1、且没有显式 column_widths 时生效（宽度合计 100% 时没有
    # 剩余空间，此时开关无效——UI 负责禁用并说明）。
    justify: Literal["start", "between"] = "start"
    # 正文前 / 正文后各自一套列布局（问题 4）。None = 完全跟随上面的共用字段。
    lead: RowLayout | None = None
    trail: RowLayout | None = None
    hide_title: bool = False
    keep_together: bool = False
    start_on_new_page: bool = False
    # 系统板块标题可覆盖；空 = 用语言包里的目录标题（自建板块标题永远用 section.title）。
    title_override: str = Field(default="", max_length=64)

    @model_validator(mode="after")
    def _check_column_widths(self) -> SectionLayout:
        _check_column_geometry(self.column_widths, self.column_gaps)
        return self


class EntryLayout(BaseModel):
    """条目级覆盖：None = 继承分区。

    共用字段（`columns / align / justify / gap / column_widths / column_gaps`）是"两侧
    同一套"的旧口径，仍然有效；`lead` / `trail` 是问题 4 新增的分侧覆盖。继承顺序
    （scope 由近到远）：

        entry.lead.X ?? entry.X ?? section.lead.X ?? section.X ?? 默认值

    即"条目共用值优先于板块分侧值"——条目自己说了算的范围更近。
    """

    model_config = ConfigDict(extra="ignore")

    head: HeadLayout = "split"
    columns: Literal[1, 2, 3] | None = None
    align: Literal["equal", "flow"] | None = None
    justify: Literal["start", "between"] | None = None
    gap: float | None = Field(default=None, ge=0, le=MAX_ENTRY_GAP)
    # 与分区级同口径；条目级只校验自身（列数可能是继承来的，长度是否匹配交给 planner）。
    column_widths: list[float] | None = Field(default=None, max_length=3)
    column_gaps: list[float] | None = Field(default=None, max_length=2)
    # 正文前 / 正文后各自一套列布局（问题 4）；None = 完全跟随上面的共用字段。
    lead: RowLayout | None = None
    trail: RowLayout | None = None
    # 条目级分页（计划 §6.2）：True = 该条目另起一页 / 尽量整条不跨页；
    # 与分区级取「或」得到生效值（planner 的 _effective_layout 负责合并）。
    start_on_new_page: bool = False
    keep_together: bool = False

    @model_validator(mode="after")
    def _check_column_widths(self) -> EntryLayout:
        _check_column_geometry(self.column_widths, self.column_gaps)
        return self


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

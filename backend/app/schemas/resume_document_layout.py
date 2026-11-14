# SPDX-License-Identifier: Apache-2.0
"""简历文档的列布局模型（从 ``schemas/resume_document.py`` 迁出，导入路径保持兼容）。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


HeadLayout = Literal["split", "stacked", "meta_first"]


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

# SPDX-License-Identifier: Apache-2.0
"""网申填表的填充记录 / 网申资料 Schema（从 ``schemas/webform.py`` 迁出，导入路径保持兼容）。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# ===== 填充记录（回看用）=====


class WebFormRecordItemOut(BaseModel):
    """记录里的一条：当时填的是哪个框、认成什么字段、写了什么值、成没成。"""

    index: int
    field: str = ""
    field_label: str = ""
    control_label: str = ""
    value: str = ""
    # filled | unverified | failed | skipped | conflict
    status: str = ""
    detail: str = ""
    source: str = ""


class WebFormRecordSnapshotOut(BaseModel):
    """填完后那个控件的可读快照。``filled`` = 这一轮是不是我们填的。"""

    index: int
    label: str = ""
    value: str = ""
    filled: bool = False


class WebFormFillRecordOut(BaseModel):
    """一条填充记录（列表与详情共用，详情里 ``items``/``page_snapshot`` 才非空）。"""

    # 直接从 ORM 对象序列化；``items``/``page_snapshot`` 是 JSON 列，形状已在服务层收窄过。
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str = ""
    page_title: str = ""
    filled: int = 0
    unverified: int = 0
    failed: int = 0
    # batch | live
    source: str = "batch"
    created_at: datetime
    items: list[WebFormRecordItemOut] = Field(default_factory=list)
    page_snapshot: list[WebFormRecordSnapshotOut] = Field(default_factory=list)


class WebFormRecordSummary(BaseModel):
    """填充记录列表行的摘要视图（RF-08 分页端点 ``GET /api/apply/webform/records/page`` 专用）。

    **不含 ``items``（填写值明细）与 ``page_snapshot``（页面正文快照）**：这两块含用户
    填进页面的真实值，随列表下发既慢又没必要——回看单条时走既有详情端点
    ``GET /api/webform/records/{id}``。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str = ""
    page_title: str = ""
    filled: int = 0
    unverified: int = 0
    failed: int = 0
    # batch | live
    source: str = "batch"
    created_at: datetime


class WebFormExtraFieldOut(BaseModel):
    """「网申资料」里的一条可录字段（只含 ``source="extra"`` 的那些）。

    与 ``WebFormFieldOut`` 分开而不是复用：那个是**填表的字段目录**（含从简历资料取值的
    字段），这个是**要用户自己录的字段清单**。混在一起的话，前端会把"学校""专业"这些
    也渲染成「网申资料」的输入框，而它们本来就该在简历资料里录。
    """

    key: str
    label: str
    group: str
    kind: str
    sensitive: bool = False
    # 能不能被自动匹配填进页面。目录字段都是 True；用户自己攒的**自定义字段是 False**
    # （理由见 services/webform/extra_profile.py 的模块说明）。界面据此**不要**对它们承诺
    # "下次自动填"——那是句假话，比不显示更糟。
    matchable: bool = True


class WebFormExtraEntryOut(BaseModel):
    """某一条「网申资料」的**来源与档位**，供界面区分"手录的 / 学到的"。"""

    value: str = ""
    # manual | learned
    source: str = "manual"
    # general | scenario | once —— once 只记不填（见 models/web_form_profile.py）。
    reuse: str = "general"
    # 界面上的字段名。空串表示"从目录取名"，由读取端回落到 ``FIELD_LABELS``。
    label: str = ""


class WebFormRepeatedFieldOut(BaseModel):
    """一组可重复网申资料中的字段。"""

    key: str
    label: str
    kind: str = "text"
    options: list[str] = Field(default_factory=list)
    sensitive: bool = False


class WebFormRepeatedRecordOut(BaseModel):
    """一条可重复网申资料记录。"""

    id: int
    values: dict[str, str] = Field(default_factory=dict)


class WebFormRepeatedGroupOut(BaseModel):
    """一组可新增多条的网申资料。"""

    key: str
    label: str
    family: str
    fields: list[WebFormRepeatedFieldOut] = Field(default_factory=list)
    records: list[WebFormRepeatedRecordOut] = Field(default_factory=list)


class WebFormRepeatedRecordIn(BaseModel):
    """前端提交的一条重复资料；id 只用于兼容回显，不作为写入依据。"""

    id: int | None = None
    values: dict[str, str] = Field(default_factory=dict)


class WebFormExtraProfileOut(BaseModel):
    """「网申资料」的读取结果：要录的字段清单 + 已填的值。"""

    fields: list[WebFormExtraFieldOut] = Field(default_factory=list)
    # 分区顺序即此列表顺序（与 ``WebFormFieldsOut.groups`` 同规则）。
    groups: list[str] = Field(default_factory=list)
    # 只含**有值**的项：没有这一项与"这一项是空的"在这里是同一件事。
    values: dict[str, str] = Field(default_factory=dict)
    # 与 ``values`` 同键的补充信息。**分开一个字段而不是把 values 改成对象**：``values``
    # 的形状（key→字符串）已经被保存流程用着，改它会让每次保存都要适配一层。
    details: dict[str, WebFormExtraEntryOut] = Field(default_factory=dict)
    # 可重复网申资料（教育补充、实习和工作补充、论文、证书等）。
    repeated_groups: list[WebFormRepeatedGroupOut] = Field(default_factory=list)


class WebFormExtraProfileIn(BaseModel):
    """整份覆盖写入。没提到的 key 会被删除——这一屏就是「网申资料」的全部。

    ``details`` 可选，只用于给**学到的**那几条指定来源与档位；没提到的按"手录的、默认档位"。
    """

    values: dict[str, str] = Field(default_factory=dict)
    details: dict[str, WebFormExtraEntryOut] = Field(default_factory=dict)
    # ``None`` 表示旧客户端没有提交这一部分，服务端必须保留已有重复记录。
    repeated: dict[str, list[WebFormRepeatedRecordIn]] | None = None

"""网申填表的请求/响应结构。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .apply import BrowserStatusOut

MAX_FILL_ITEMS = 500


class WebFormFieldOut(BaseModel):
    """字段目录里的一条。前端据此渲染录入界面——**加字段不用改前端**。"""

    key: str
    label: str
    group: str
    kind: str
    sensitive: bool = False


class WebFormFieldsOut(BaseModel):
    fields: list[WebFormFieldOut] = Field(default_factory=list)
    # 分区顺序即此列表顺序。
    groups: list[str] = Field(default_factory=list)


class WebFormPageOut(BaseModel):
    url: str = ""
    title: str = ""
    control_count: int = 0


class WebFormSnapshotOut(BaseModel):
    snapshot_id: str
    page: WebFormPageOut


class PreviewItemOut(BaseModel):
    """一条"将填入"的映射。"""

    index: int
    field: str
    field_label: str
    value: str
    control_label: str
    control_type: str
    # ready | low_confidence | conflict
    status: str
    # rule | ai。**与 status 正交**：AI 命中的行照样可能是 ready 或 conflict。
    # 前端据此打「AI 建议」标签，并且**不默认勾选**。
    source: str = "rule"
    current_value: str = ""
    options: list[dict[str, str]] = Field(default_factory=list)
    note: str = ""


class PendingItemOut(BaseModel):
    """页面要求、但这一轮不会自动填的控件。"""

    index: int
    label: str
    required: bool = False
    field: str = ""
    field_label: str = ""


class LearningCandidateOut(BaseModel):
    """填表时发现的、**简历通里没有**的一条——问用户要不要记下来。"""

    key: str
    label: str
    value: str
    # rule | ai。**ai 的要单独标出来**：它比规则更可能认错字段，用户核对时的怀疑程度不同。
    from_: str = Field(default="rule", alias="from")

    model_config = ConfigDict(populate_by_name=True)


class WebFormLearningOut(BaseModel):
    """这次填充里值得记下来的那些。空列表表示没有可记的（界面就不弹提示）。"""

    candidates: list[LearningCandidateOut] = Field(default_factory=list)


class WebFormPreviewOut(BaseModel):
    snapshot_id: str
    page: WebFormPageOut
    items: list[PreviewItemOut] = Field(default_factory=list)
    # 认得出字段但资料为空 —— 每行给"去我的资料补"的入口。
    missing_data: list[PendingItemOut] = Field(default_factory=list)
    # 规则认不出的控件。**配了模型且开着 AI 时，其中一部分会被识别出来移进 ``items``**，
    # 剩下的（模型也说都不像的，以及它答对了但页面选项装不下的）仍留在这里。
    unrecognized: list[PendingItemOut] = Field(default_factory=list)
    # 永不自动填的（验证码 / 密码类 / 简历附件 / 他人信息）。
    blocked: list[PendingItemOut] = Field(default_factory=list)
    # 默认勾选（冲突项与 AI 建议不在其中）——前端初始化的依据。
    default_indexes: list[int] = Field(default_factory=list)
    # 这次填充里"简历通里没有"的那些，填完问用户要不要记下来。
    #
    # **在这里返回而不是等填完再问一次**：判断所需的 ``field`` / ``value`` / ``source``
    # 都已经在 ``items`` 里了，再开一个接口就是让后端把同一件事算两遍、还要靠前端把
    # "刚才填了什么"传回来（那份东西是不可信的）。
    learning: WebFormLearningOut = Field(default_factory=WebFormLearningOut)


class WebFormPreviewIn(BaseModel):
    snapshot_id: str
    # 认不出的控件要不要交给模型识别。没配模型时后端会忽略它（拿不到 provider）。
    ai: bool = True


class WebFormFillItemIn(BaseModel):
    index: int
    field: str = ""
    value: str = ""


class WebFormFillIn(BaseModel):
    snapshot_id: str
    items: list[WebFormFillItemIn] = Field(default_factory=list, max_length=MAX_FILL_ITEMS)


class WebFormOutcomeOut(BaseModel):
    index: int
    field: str
    # filled | skipped | failed | conflict | unverified
    status: str
    detail: str = ""


class WebFormLiveAlternativeOut(BaseModel):
    """主推之外的候选之一（目前只有 AI 会给）。每一条在面板上自带「填入」按钮。"""

    label: str = ""
    value: str = ""


class WebFormLiveIn(BaseModel):
    # 规则认不出来时要不要交给模型识别。没配模型时后端会忽略它（拿不到 provider）。
    ai: bool = True


class WebFormRememberPendingOut(BaseModel):
    """等待用户选择存到哪一份资料的详情。"""

    field_key: str = ""
    field_label: str = ""
    value: str = ""
    control_label: str = ""
    source: str = "rule"


class WebFormLiveOut(BaseModel):
    """「点哪个填哪个」模式的当前状态（界面据此显示它在做什么）。"""

    running: bool = False
    field_label: str = ""
    value: str = ""
    # thinking | ai_thinking | matched | blocked | unmatched | filled | failed
    status: str = ""
    note: str = ""
    # rule | ai —— 这条建议是规则给的还是模型给的。空串表示还没有建议（或已填完）。
    source: str = ""
    # 主推之外的候选，按模型的把握从大到小。**不含主推那一条**（它在 field_label/value 里）。
    alternatives: list[WebFormLiveAlternativeOut] = Field(default_factory=list)
    filled: int = 0
    # 点「记住这条」后不直接覆盖，先让用户选目标。
    remember_pending: WebFormRememberPendingOut | None = None


class WebFormMemoryTargetOut(BaseModel):
    """可被「记住这条」写入的一个目标。

    **只可能是「网申资料」**：简历资料会被生成进简历正文，在网申页面上按一下就改掉它
    代价太大（完整理由见 ``services/webform/profile_targets.py``）。``source`` 写成
    ``Literal`` 而不是 ``str`` 是为了让"又冒出一种落点"在这里就撞墙——响应模型会校验，
    多一种来源直接 500，而不是悄悄发给前端渲染出来。
    """

    target_id: str
    source: Literal["extra"]
    group: str
    label: str
    value: str = ""
    kind: str = "text"
    field_key: str = ""


class WebFormMemoryTargetsOut(BaseModel):
    targets: list[WebFormMemoryTargetOut] = Field(default_factory=list)


class WebFormRememberIn(BaseModel):
    target_id: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=100_000)
    label: str = Field(default="", max_length=128)
    reuse: str = "general"


class WebFormRememberOut(BaseModel):
    saved: bool = False
    live: WebFormLiveOut


class WebFormFillOut(BaseModel):
    outcomes: list[WebFormOutcomeOut] = Field(default_factory=list)
    filled: int = 0
    unverified: int = 0
    failed: int = 0


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


class WebFormExtraProfileIn(BaseModel):
    """整份覆盖写入。没提到的 key 会被删除——这一屏就是「网申资料」的全部。

    ``details`` 可选，只用于给**学到的**那几条指定来源与档位；没提到的按"手录的、默认档位"。
    """

    values: dict[str, str] = Field(default_factory=dict)
    details: dict[str, WebFormExtraEntryOut] = Field(default_factory=dict)


__all__ = [
    "MAX_FILL_ITEMS",
    "BrowserStatusOut",
    "LearningCandidateOut",
    "PendingItemOut",
    "PreviewItemOut",
    "WebFormExtraEntryOut",
    "WebFormExtraFieldOut",
    "WebFormExtraProfileIn",
    "WebFormExtraProfileOut",
    "WebFormFieldOut",
    "WebFormFieldsOut",
    "WebFormFillRecordOut",
    "WebFormLearningOut",
    "WebFormLiveAlternativeOut",
    "WebFormLiveIn",
    "WebFormLiveOut",
    "WebFormMemoryTargetOut",
    "WebFormMemoryTargetsOut",
    "WebFormRememberIn",
    "WebFormRememberOut",
    "WebFormRememberPendingOut",
    "WebFormFillIn",
    "WebFormFillItemIn",
    "WebFormFillOut",
    "WebFormOutcomeOut",
    "WebFormPageOut",
    "WebFormPreviewIn",
    "WebFormPreviewOut",
    "WebFormRecordItemOut",
    "WebFormRecordSnapshotOut",
    "WebFormSnapshotOut",
]

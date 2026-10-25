# SPDX-License-Identifier: Apache-2.0
"""补充事实（ProfileFact）的出入参 schema：九类固定 kind，payload 按 kind 严格校验。

**为什么 payload 全部 extra="forbid"**（契约 §3.1）：未知字段静默忽略会表现成
"保存成功但内容丢了"——前端写错一个字段名，用户看到的是保存成功、重开却少了一项。
宁可 422 让它当场暴露。

**日期**统一走 normalize_partial_date（YYYY / YYYY-MM / YYYY-MM-DD / 至今）；
认不出来的旧值原样保留，与旧资料同一口径，不在写入边界猜日期。

**链接只允许 http(s) 或空串**：这些值最终会被渲染成可点击链接，javascript: /
file: 之类协议一律拒绝（不是"校验但不影响使用"，是根本不让进库）。

**列表长度**上限来自契约；单条要点另设上限，避免一条事实把请求体/备份包撑爆。

**证号** credential_number 是私密字段：本地 CRUD 原样保存并返回（用户自己的库），
但生成候选由 services/profile/fact_mapping.py 剔除，绝不进提示词/日志/纸面。

**kind 判别联合**：POST 请求体顶层 kind 决定 payload 模型，用 discriminated union
直接校验；PATCH 请求体不带 kind（kind 是事实的固有属性），由 validate_fact_payload
按库里的既有 kind 重新校验整份 payload。

**自定义字段**（灵活化契约 §2）：每个 payload 都可带 custom_fields（key+label+value
快照）。这里只做**结构**校验（key 形如 cf_<12hex>、label 1..40、值 ≤2000、≤20 条、
同一条事实内 key/label 不重复）；label 不能与默认字段中文标签重名需要"按类型的默认
标签表"，而 schemas 不能反向依赖 services，故由 services/profile/fact_field_schema.py
在创建/更新时补这一条（失败仍是 422）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from .common import Page
from .date_format import normalize_partial_date

# 结构版本：未来 payload 形状不兼容变更时递增；与迁移/场景的 schema_version 不共用。
PROFILE_FACT_SCHEMA_VERSION = 1

# 列表接口的默认值与硬上限（契约 §3.2：limit=200）。
FACT_LIST_LIMIT_DEFAULT = 200
FACT_LIST_LIMIT_MAX = 200

FACT_AUTHOR_LIMIT = 50
FACT_DETAIL_LINES_LIMIT = 200
FACT_TECH_STACK_LIMIT = 50
# 单条要点的字符上限：与科研项目契约给的最宽一档对齐，统一压住所有 list[str] 项。
FACT_DETAIL_LINE_CHARS = 20_000
# 排序值只是一个展示序号，给一个宽松但有界的上限防溢出（SQLite INTEGER 是 64 位）。
FACT_SORT_ORDER_MAX = 1_000_000_000

# 自定义字段（契约 §2）：每条事实最多 20 项；key 由服务端生成（cf_ + 12 位小写 hex）；
# label 去空白后 1..40；value 可空、最长 2000。
FACT_CUSTOM_FIELD_LIMIT = 20
FACT_CUSTOM_FIELD_KEY_PATTERN = r"^cf_[0-9a-f]{12}$"
FACT_CUSTOM_FIELD_LABEL_MAX = 40
FACT_CUSTOM_FIELD_VALUE_MAX = 2000

PublicationStatus = Literal[
    "published", "accepted", "in_press", "under_review", "preprint", "other"
]
PatentStatus = Literal["filed", "pending", "granted", "expired", "other"]
CredentialStatus = Literal["unknown", "pending", "active", "expired"]
PracticeKind = Literal[
    "unset",
    "full_time",
    "part_time",
    "contract",
    "self_employed",
    "internship",
    "volunteer",
    "other",
]
ProfileFactKind = Literal[
    "publication",
    "research_project",
    "patent",
    "credential",
    "work_project",
    "practice",
    "award",
    "training",
    "language",
]
PROFILE_FACT_KIND_VALUES: tuple[str, ...] = (
    "publication",
    "research_project",
    "patent",
    "credential",
    "work_project",
    "practice",
    "award",
    "training",
    "language",
)

DetailText = Annotated[str, StringConstraints(max_length=FACT_DETAIL_LINE_CHARS)]


def _normalize_date_value(value: str) -> str:
    """把可识别的部分日期统一成短横线格式；认不出来就原样保留。"""
    return normalize_partial_date(value)


def _validate_http_url(value: str) -> str:
    """链接只接受 http(s)（空串允许）；别的协议拒绝，避免渲染成可点击的危险链接。"""
    text = (value or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        raise ValueError("链接只允许 http(s)")
    return text


class FactCustomField(BaseModel):
    """一条自定义字段的值快照：key 由字段定义生成，label 冗余保存以便定义删除后仍可读。

    label 在这里做去空白与非空校验；与默认字段中文标签重名的规则需要按类型的标签表，
    由 services/profile/fact_field_schema.py 在写入时补查（见模块 docstring）。
    """

    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=FACT_CUSTOM_FIELD_KEY_PATTERN)
    label: str = Field(min_length=1, max_length=FACT_CUSTOM_FIELD_LABEL_MAX)
    value: str = Field(default="", max_length=FACT_CUSTOM_FIELD_VALUE_MAX)

    @field_validator("label", "value", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class _PayloadBase(BaseModel):
    """全部 payload 模型的共同约束：不允许未知字段；额外支持自定义字段值快照。"""

    model_config = ConfigDict(extra="forbid")

    custom_fields: list[FactCustomField] = Field(
        default_factory=list, max_length=FACT_CUSTOM_FIELD_LIMIT
    )

    @model_validator(mode="after")
    def custom_field_identities_unique(self):
        """同一事实内 key 与 label 都不允许重复（契约 §2）。"""
        labels = [field.label for field in self.custom_fields]
        if len(set(labels)) != len(labels):
            raise ValueError("自定义字段名在同一事实内不能重复")
        keys = [field.key for field in self.custom_fields]
        if len(set(keys)) != len(keys):
            raise ValueError("自定义字段 key 在同一事实内不能重复")
        return self


class FactAuthor(BaseModel):
    """作者/发明人：列表下标即署名顺序，is_self 标本人，corresponding 标通讯作者。

    顺序与标记都**原样保存**（契约 §3.3）；不推断谁是第一作者、不把标记写进 name。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=128)
    is_self: bool = False
    corresponding: bool = False


class PublicationPayload(_PayloadBase):
    """论文/发表记录。status 是事实：不由关键词或模型推断真实有效性。"""

    title: str = Field(default="", max_length=512)
    authors: list[FactAuthor] = Field(default_factory=list, max_length=FACT_AUTHOR_LIMIT)
    venue: str = Field(default="", max_length=256)
    year: str = Field(default="", max_length=8)
    status: PublicationStatus = "other"
    doi: str = Field(default="", max_length=256)
    url: str = Field(default="", max_length=512)
    volume_pages: str = Field(default="", max_length=64)
    note: str = Field(default="", max_length=2000)

    _validate_url = field_validator("url")(_validate_http_url)


class ResearchProjectPayload(_PayloadBase):
    """科研项目。经费只作为事实文本保存，不做金额解析。"""

    name: str = Field(default="", max_length=256)
    role: str = Field(default="", max_length=128)
    organization: str = Field(default="", max_length=256)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    funding: str = Field(default="", max_length=256)
    description: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)
    outcomes: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)

    _normalize_dates = field_validator("start_date", "end_date")(_normalize_date_value)


class PatentPayload(_PayloadBase):
    """专利。申请/授权日期与状态是事实字段，原样保留。"""

    title: str = Field(default="", max_length=512)
    inventors: list[FactAuthor] = Field(default_factory=list, max_length=FACT_AUTHOR_LIMIT)
    patent_number: str = Field(default="", max_length=64)
    country: str = Field(default="", max_length=32)
    status: PatentStatus = "other"
    filed_date: str = Field(default="", max_length=32)
    granted_date: str = Field(default="", max_length=32)
    url: str = Field(default="", max_length=512)

    _normalize_dates = field_validator("filed_date", "granted_date")(_normalize_date_value)
    _validate_url = field_validator("url")(_validate_http_url)


class CredentialPayload(_PayloadBase):
    """资格证照。credential_number 是私密字段：本地保存，生成候选剔除。"""

    name: str = Field(default="", max_length=128)
    issuer: str = Field(default="", max_length=256)
    issue_date: str = Field(default="", max_length=32)
    expiry_date: str = Field(default="", max_length=32)
    status: CredentialStatus = "unknown"
    # **私密**：证号只在用户本地库里保存与展示；不渲染到纸面、不进任何提示词。
    credential_number: str = Field(default="", max_length=128)
    verify_url: str = Field(default="", max_length=512)
    note: str = Field(default="", max_length=2000)

    _normalize_dates = field_validator("issue_date", "expiry_date")(_normalize_date_value)
    _validate_url = field_validator("verify_url")(_validate_http_url)


class WorkProjectPayload(_PayloadBase):
    """作品项目。公开链接只校验协议，不抓取内容（契约 §8.1 的边界）。"""

    name: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    tech_stack: list[DetailText] = Field(default_factory=list, max_length=FACT_TECH_STACK_LIMIT)
    description: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)
    highlights: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)
    public_url: str = Field(default="", max_length=512)
    artifact_type: str = Field(default="", max_length=64)

    _normalize_dates = field_validator("start_date", "end_date")(_normalize_date_value)
    _validate_url = field_validator("public_url")(_validate_http_url)


class PracticePayload(_PayloadBase):
    """实践/服务经历。organization 是中性称谓（机构或客户），不猜雇佣关系。"""

    organization: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    experience_kind: PracticeKind = "unset"
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)

    _normalize_dates = field_validator("start_date", "end_date")(_normalize_date_value)


class AwardPayload(_PayloadBase):
    """荣誉与获奖。级别只作为事实文本保存，不推断含金量。"""

    name: str = Field(default="", max_length=256)
    issuer: str = Field(default="", max_length=256)
    date: str = Field(default="", max_length=32)
    level: str = Field(default="", max_length=64)
    description: str = Field(default="", max_length=2000)

    _normalize_dates = field_validator("date")(_normalize_date_value)


class TrainingPayload(_PayloadBase):
    """培训与课程。学时是事实文本，不做数字解析。"""

    name: str = Field(default="", max_length=256)
    organization: str = Field(default="", max_length=256)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    hours: str = Field(default="", max_length=32)
    description: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)
    outcomes: list[DetailText] = Field(default_factory=list, max_length=FACT_DETAIL_LINES_LIMIT)

    _normalize_dates = field_validator("start_date", "end_date")(_normalize_date_value)


class LanguagePayload(_PayloadBase):
    """语言能力。level 是自述水平，不是任何认证结论。"""

    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)
    certificate: str = Field(default="", max_length=256)
    score: str = Field(default="", max_length=64)
    date: str = Field(default="", max_length=32)

    _normalize_dates = field_validator("date")(_normalize_date_value)


KIND_TO_PAYLOAD_MODEL: dict[str, type[_PayloadBase]] = {
    "publication": PublicationPayload,
    "research_project": ResearchProjectPayload,
    "patent": PatentPayload,
    "credential": CredentialPayload,
    "work_project": WorkProjectPayload,
    "practice": PracticePayload,
    "award": AwardPayload,
    "training": TrainingPayload,
    "language": LanguagePayload,
}


def validate_fact_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    """按 kind 严格校验整份 payload 并返回规范化后的 JSON dict。

    失败抛 ValueError（pydantic ValidationError 是它的子类）：API 层把它翻译成 422，
    服务层直接抛给调用方——校验只有这一处实现，不写第二份规则。
    """
    model = KIND_TO_PAYLOAD_MODEL.get(kind)
    if model is None:
        raise ValueError(f"不支持的补充事实类型：{kind}")
    return model.model_validate(payload).model_dump(mode="json")


class _FactCreateBase(BaseModel):
    """创建请求的公共字段；kind/payload 由各分支模型给出（判别联合）。"""

    model_config = ConfigDict(extra="forbid")

    # 缺省时由服务追加到末尾；显式传入时按给定值保存。
    sort_order: int | None = Field(default=None, ge=0, le=FACT_SORT_ORDER_MAX)


class PublicationFactCreate(_FactCreateBase):
    kind: Literal["publication"]
    payload: PublicationPayload


class ResearchProjectFactCreate(_FactCreateBase):
    kind: Literal["research_project"]
    payload: ResearchProjectPayload


class PatentFactCreate(_FactCreateBase):
    kind: Literal["patent"]
    payload: PatentPayload


class CredentialFactCreate(_FactCreateBase):
    kind: Literal["credential"]
    payload: CredentialPayload


class WorkProjectFactCreate(_FactCreateBase):
    kind: Literal["work_project"]
    payload: WorkProjectPayload


class PracticeFactCreate(_FactCreateBase):
    kind: Literal["practice"]
    payload: PracticePayload


class AwardFactCreate(_FactCreateBase):
    kind: Literal["award"]
    payload: AwardPayload


class TrainingFactCreate(_FactCreateBase):
    kind: Literal["training"]
    payload: TrainingPayload


class LanguageFactCreate(_FactCreateBase):
    kind: Literal["language"]
    payload: LanguagePayload


ProfileFactCreate = Annotated[
    PublicationFactCreate
    | ResearchProjectFactCreate
    | PatentFactCreate
    | CredentialFactCreate
    | WorkProjectFactCreate
    | PracticeFactCreate
    | AwardFactCreate
    | TrainingFactCreate
    | LanguageFactCreate,
    Field(discriminator="kind"),
]


class ProfileFactUpdate(BaseModel):
    """条件更新：payload 是**整份替换**（不是字段级合并），服务按事实的 kind 重新校验。"""

    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=FACT_SORT_ORDER_MAX)
    expected_revision: int | None = Field(default=None, ge=1)


class ProfileFactOut(BaseModel):
    """一条事实的读取形状（契约 §3.2）。payload 按 kind 是完整规范化后的 dict。"""

    model_config = ConfigDict(from_attributes=True)

    fact_id: str
    kind: str
    schema_version: int
    revision: int
    payload: dict[str, Any]
    sort_order: int
    created_at: datetime
    updated_at: datetime | None = None
    deleted_at: datetime | None = None


class ProfileFactListOut(Page[ProfileFactOut]):
    """列表响应：items/total；total 是过滤条件命中的总条数（不受分页影响）。"""


class ProfileFactDeleteOut(BaseModel):
    """软删响应：删除是幂等的，重复删同一事实仍然返回 deleted=true。"""

    deleted: bool = True


# ===== 字段设置（契约 §3-4）=====


class FactCustomFieldDefinitionIn(BaseModel):
    """PUT 字段设置里的一条自定义字段定义；不带 key 表示新增（服务端生成）。"""

    model_config = ConfigDict(extra="forbid")

    key: str | None = None
    label: str = ""


class ProfileFactFieldSchemaUpdate(BaseModel):
    """PUT /api/profile/facts/schema/{kind} 请求体（未设上限，超限由服务层回 400）。"""

    model_config = ConfigDict(extra="forbid")

    hidden_fields: list[str] = Field(default_factory=list)
    custom_fields: list[FactCustomFieldDefinitionIn] = Field(default_factory=list)
    expected_revision: int = Field(ge=0)


class ProfileFactFieldSchemaReset(BaseModel):
    """POST /api/profile/facts/schema/{kind}/reset 请求体。"""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)


class FactCustomFieldDefinitionOut(BaseModel):
    """下发的自定义字段定义（不含任何值）。"""

    key: str
    label: str


class KindFieldSchemaOut(BaseModel):
    """一种事实类型的字段设置：默认字段全集、隐藏项、自定义字段定义与 revision。"""

    kind: str
    revision: int
    default_fields: list[str]
    hidden_fields: list[str]
    custom_fields: list[FactCustomFieldDefinitionOut]
    max_custom_fields: int


class ProfileFactFieldSchemasOut(BaseModel):
    """GET /api/profile/facts/schema 的完整响应。"""

    kinds: list[KindFieldSchemaOut]
    max_custom_field_value_chars: int

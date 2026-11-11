# SPDX-License-Identifier: Apache-2.0
"""知识库条目（E4）的请求/响应结构。

知识库与资料箱的区别：资料箱是「还没归档的零散材料」，知识库是「整理好、愿意反复查阅的
成文内容」——面经总结、简历技巧、求职策略、行业笔记等。正文允许 Markdown 长文，列表检索
按标题/正文命中，分类给一组内置常量作起点、仍允许自定义。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 与 ``models/knowledge_entry.py`` 的列定义保持一致（服务端 schema 仍是权威校验）。
MAX_KNOWLEDGE_TITLE_CHARS = 200
MAX_KNOWLEDGE_CATEGORY_CHARS = 32
MAX_KNOWLEDGE_SOURCE_CHARS = 64
# 正文是 Markdown 长文，上限给得比资料箱更宽松，但仍在请求体上限之内。
MAX_KNOWLEDGE_CONTENT_CHARS = 200_000
# 标签数量与单条长度：标签是检索维度，不是自由文本，限长避免列表被撑爆。
MAX_KNOWLEDGE_TAGS = 20
MAX_KNOWLEDGE_TAG_CHARS = 32
# 0014（#29C/#29D/#29E）：意图字段、关联实体与蒸馏结果的长度上限。
# 「我为什么存这条」是一句话（调研结论：这句话比正文更值钱），所以只给 120 字；
# summary 是列表卡片直接显示的蒸馏结果，300 字足够；key_points 是要点清单。
MAX_KNOWLEDGE_REASON_CHARS = 120
MAX_KNOWLEDGE_COMPANY_CHARS = 128
MAX_KNOWLEDGE_SUMMARY_CHARS = 300
MAX_KNOWLEDGE_KEY_POINTS = 20
MAX_KNOWLEDGE_KEY_POINT_CHARS = 200

# 内置分类：**建议而非约束**（#29G）。新建时分类可留空（归「未分类」），自定义分类与
# 内置同权——调研结论明确反对"追求完美分类"：分类体系一旦复杂就没人维护。
# 注意：改这个常量要同步三处（常量 / 前端语言包 / 表单校验），见问题清单 #29G。
KNOWLEDGE_CATEGORIES = (
    "面经",
    "简历技巧",
    "求职策略",
    "面试问答",
    "公司信息",
    "行业知识",
    "其他",
)


def _clean_tags(value: list[str]) -> list[str]:
    """标签清洗：去空白、去空项、去重（保序），超长单个标签直接拒绝。"""
    cleaned: list[str] = []
    for tag in value:
        item = (tag or "").strip()
        if not item:
            continue
        if len(item) > MAX_KNOWLEDGE_TAG_CHARS:
            raise ValueError(f"单个标签不能超过 {MAX_KNOWLEDGE_TAG_CHARS} 字")
        if item not in cleaned:
            cleaned.append(item)
    return cleaned


class KnowledgeCreate(BaseModel):
    """新增一条知识库条目。标题必填，其余字段给合理默认值。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_KNOWLEDGE_TITLE_CHARS)
    # 空串 = 未分类（#29G：分类是建议，不是必填）。
    category: str = Field(default="", max_length=MAX_KNOWLEDGE_CATEGORY_CHARS)
    tags: list[str] = Field(default_factory=list, max_length=MAX_KNOWLEDGE_TAGS)
    content: str = Field(default="", max_length=MAX_KNOWLEDGE_CONTENT_CHARS)
    source: str = Field(default="手动录入", max_length=MAX_KNOWLEDGE_SOURCE_CHARS)
    # 0014（#29C）：我为什么存这条（一句话）。
    reason: str = Field(default="", max_length=MAX_KNOWLEDGE_REASON_CHARS)
    # 0014（#29D）：关联公司与岗位（都可空；岗位彻底删除后由外键 SET NULL）。
    company: str = Field(default="", max_length=MAX_KNOWLEDGE_COMPANY_CHARS)
    job_id: int | None = Field(default=None, ge=1)
    # 0014（#29E）：蒸馏出的摘要与要点（列表卡片与 RAG 命中优先用它们，省 token）。
    summary: str = Field(default="", max_length=MAX_KNOWLEDGE_SUMMARY_CHARS)
    key_points: list[str] = Field(
        default_factory=list, max_length=MAX_KNOWLEDGE_KEY_POINTS
    )

    @field_validator("tags")
    @classmethod
    def tags_must_be_clean(cls, value: list[str]) -> list[str]:
        return _clean_tags(value)

    @field_validator("key_points")
    @classmethod
    def key_points_must_be_clean(cls, value: list[str]) -> list[str]:
        """要点清洗：去空白、去空项、去重（保序），单条超长直接拒绝。"""
        cleaned: list[str] = []
        for point in value:
            item = (point or "").strip()
            if not item:
                continue
            if len(item) > MAX_KNOWLEDGE_KEY_POINT_CHARS:
                raise ValueError(f"单个要点不能超过 {MAX_KNOWLEDGE_KEY_POINT_CHARS} 字")
            if item not in cleaned:
                cleaned.append(item)
        return cleaned

    @model_validator(mode="after")
    def normalize_and_require_title(self) -> "KnowledgeCreate":
        self.title = self.title.strip()
        # #29G：空分类是合法状态（未分类），不再兜成「其他」——把"用户没选"
        # 伪装成"用户选了其他"会让「未分类」筛选永远为空。
        self.category = self.category.strip()
        self.source = self.source.strip() or "手动录入"
        self.reason = self.reason.strip()
        self.company = self.company.strip()
        self.summary = self.summary.strip()
        if not self.title:
            raise ValueError("请填写标题")
        return self


class KnowledgeUpdate(KnowledgeCreate):
    """PUT 语义：整体替换一条知识库条目。"""


class KnowledgeOut(KnowledgeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


# 列表摘要的截断长度（RF-08）：正文最长 20 万字符，随列表下发等于把翻页拖成大响应。
KNOWLEDGE_CONTENT_EXCERPT_CHARS = 200


class KnowledgeEntrySummary(BaseModel):
    """知识库列表行的摘要视图（RF-08 分页端点 ``GET /api/knowledge/page`` 专用）。

    **不含 ``content`` 全文**：正文是 Markdown 长文（上限 20 万字符），列表只给
    ``content_excerpt`` 截断摘要，全文走既有详情端点 ``GET /api/knowledge/{id}``。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    category: str
    tags: list[str] = Field(default_factory=list)
    source: str = ""
    content_excerpt: str = Field(default="", max_length=KNOWLEDGE_CONTENT_EXCERPT_CHARS)
    # 0014：列表卡片直接显示 reason（#29C）与 summary（#29E），不读正文全文。
    reason: str = ""
    company: str = ""
    job_id: int | None = None
    summary: str = ""
    key_points: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


#: #29B 知识回流来源（三个入口共用同一服务/端点）。
KnowledgeSource = Literal["interview_report", "apply_failure", "resume_diagnosis"]


class KnowledgeFromSourceRequest(BaseModel):
    """从业务数据生成知识条目：只带来源类型与来源 id，正文由服务端取。"""

    model_config = ConfigDict(extra="forbid")

    source: KnowledgeSource
    source_id: int = Field(ge=1)


class KnowledgeFromSourceOut(BaseModel):
    """回流结果：created=False 表示已有同内容条目，前端提示「已存在」。"""

    id: int
    title: str
    category: str
    source: str
    created: bool = True


class KnowledgeSearchHit(BaseModel):
    """混合检索的一条命中（#29A）：只给定位与摘要，正文仍走详情端点。"""

    id: int
    title: str
    snippet: str = ""
    score: float = 0.0
    matched_heading: str = ""
    used_vector: bool = False


class KnowledgeSearchOut(BaseModel):
    """检索结果 + 诊断（哪一路命中多少、是否回退关键词）。"""

    items: list[KnowledgeSearchHit] = Field(default_factory=list)
    keyword_count: int = 0
    vector_count: int = 0
    fallback_reason: str = ""


class KnowledgeRelatedOut(BaseModel):
    """与一家公司 / 一条岗位相关的知识条目（#29D）：total 用于「N 条」文案。"""

    total: int = 0
    items: list[KnowledgeEntrySummary] = Field(default_factory=list)


class KnowledgeReviewPromptOut(BaseModel):
    """#29F 复习提醒候选：长期没更新的条目（每周最多提示一次由前端去重）。"""

    count: int = 0
    items: list[KnowledgeEntrySummary] = Field(default_factory=list)


class KnowledgeTagsOut(BaseModel):
    """``GET /api/knowledge/tags`` 的响应：全库标签下拉选项（去重、字典序）。"""

    tags: list[str] = Field(default_factory=list)


class KnowledgeBatchRequest(BaseModel):
    """批量删除请求：与 ``schemas.resume.ResumeBatchRequest`` 同款口径（去重 + 上限 500）。"""

    knowledge_ids: list[int] = Field(max_length=500)

    @field_validator("knowledge_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("请至少选择一份知识库条目")
        return list(dict.fromkeys(value))


class KnowledgeBatchDeleteResult(BaseModel):
    deleted: int


__all__ = [
    "KNOWLEDGE_CATEGORIES",
    "KNOWLEDGE_CONTENT_EXCERPT_CHARS",
    "MAX_KNOWLEDGE_CATEGORY_CHARS",
    "MAX_KNOWLEDGE_COMPANY_CHARS",
    "MAX_KNOWLEDGE_CONTENT_CHARS",
    "MAX_KNOWLEDGE_KEY_POINTS",
    "MAX_KNOWLEDGE_KEY_POINT_CHARS",
    "MAX_KNOWLEDGE_REASON_CHARS",
    "MAX_KNOWLEDGE_SOURCE_CHARS",
    "MAX_KNOWLEDGE_SUMMARY_CHARS",
    "MAX_KNOWLEDGE_TAG_CHARS",
    "MAX_KNOWLEDGE_TAGS",
    "MAX_KNOWLEDGE_TITLE_CHARS",
    "KnowledgeCreate",
    "KnowledgeEntrySummary",
    "KnowledgeFromSourceOut",
    "KnowledgeFromSourceRequest",
    "KnowledgeOut",
    "KnowledgeSource",
    "KnowledgeRelatedOut",
    "KnowledgeReviewPromptOut",
    "KnowledgeSearchHit",
    "KnowledgeSearchOut",
    "KnowledgeTagsOut",
    "KnowledgeUpdate",
    "KnowledgeBatchDeleteResult",
    "KnowledgeBatchRequest",
]

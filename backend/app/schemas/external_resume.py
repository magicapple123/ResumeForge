# SPDX-License-Identifier: Apache-2.0
"""外部简历的请求/响应结构（清单 `21.3–21.5）。

三个边界刻意用结构表达，而不是靠调用方记得：

- **只读快照**：回显里没有可编辑正文、没有版式参数，只有原件引用与提取文本；
- **扫描件允许没有文字**：`has_text=False` 是一个合法的上传结果（行照样创建），
  界面据此标「未提取到文字」；正文为空时绝不能被当成"检查通过"；
- **检查项是条目化结论、没有总分**：`checks` 里每个 key 是稳定协议值（前端按它取
  语言包文案），长度/比例/覆盖率按 key 解释，不提供任何汇总分数。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# 单份外部简历文件上限：与面试材料链路同一个数（10 MB）。一份简历远用不到这个量级，
# 它只是"别把整本手册传上来"的闸。
MAX_EXTERNAL_RESUME_BYTES = 10 * 1024 * 1024
# 文件名的展示上限（与模型 name 列一致）。
MAX_NAME_CHARS = 256
# 检查项 key 的闭集（协议值，永不翻译）。顺序即界面展示顺序；`keywords` 只在有 JD
# 时出现（没有该分项 ≠ 0 分）。
ANALYSIS_CHECK_KEYS: tuple[str, ...] = (
    "placeholder",
    "quantification",
    "contact",
    "length",
    "weak_wording",
    "keywords",
)


class ExternalResumeBrief(BaseModel):
    """列表/上传回显的一行（不含正文，列表不需要 20k 字）。"""

    id: int
    file_id: int
    name: str
    # 原件的 MIME（由 user_file 带出）：前端据此决定"原件"标签是 iframe 预览还是下载。
    mime: str = ""
    text_chars: int
    # 上传时是否提取到了文字。false = 扫描件/无文字层：原件可预览，但不能做文本检查、
    # 也不能直接"用于面试"（面试材料正文要求非空）。
    has_text: bool
    job_id: int | None = None
    job_title: str = ""
    created_at: datetime
    updated_at: datetime
    # 上传接口的警告（如"没有文字层"）；列表/详情默认空——警告属于"这次上传的结果"。
    warnings: list[str] = Field(default_factory=list)


class ExternalResumeDetail(ExternalResumeBrief):
    """详情：在列表字段之上带提取到的正文（界面「查看文本」直接用）。"""

    text: str = ""


class ExternalResumeListOut(BaseModel):
    items: list[ExternalResumeBrief]
    total: int
    page: int
    page_size: int


class ExternalResumeUpdateInput(BaseModel):
    """PATCH：改名 / 关联岗位。

    `job_id` 用 `model_fields_set` 区分"没传"与"显式传 null（取消关联）"：只用
    `None` 当默认值会让"取消关联"永远做不到。
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_CHARS)
    job_id: int | None = Field(default=None, ge=1)


class AnalysisHit(BaseModel):
    """一条原文证据：1 基行号 + 截断后的原文片段。"""

    line: int
    text: str


class KeywordCoverage(BaseModel):
    """关键词覆盖（只有 JD 抽得出目标词时才出现）。"""

    target: list[str]
    matched: list[str]
    missing: list[str]
    # 命中词数 / 目标词数；与 `count`/`sample_size` 同一口径，单独给一份便于前端直接显示。
    coverage_ratio: float


class AnalysisCheck(BaseModel):
    """一类文本检查的结论。

    按 key 解释数字：

    - `placeholder`：count = 命中占位符的行数；
    - `quantification`：count = 含数字/百分号的行数，ratio = count / sample_size；
    - `contact`：count = 手机号与邮箱出现的总次数；
    - `length`：count = 正文字数，sample_size = 内容行数（估算页数在顶层）；
    - `weak_wording`：count = 弱表述开头的行数，ratio = count / sample_size；
    - `keywords`：count = 命中的目标词数，sample_size = 目标词总数，ratio = 覆盖率，
      `keywords` 字段给出逐词清单。
    """

    key: str
    count: int = 0
    ratio: float | None = None
    sample_size: int = 0
    # 最多 10 条原文证据（count 才是全量）；不做分页——这是"抽查几条"的视图。
    items: list[AnalysisHit] = Field(default_factory=list)
    keywords: KeywordCoverage | None = None


class ExternalResumeAnalysisOut(BaseModel):
    """一次文本检查的完整结果：**没有总分**，只有条目化结论与篇幅事实。"""

    resume_id: int
    text_chars: int
    line_count: int
    # 按每页约 1200 字估算，仅展示用（不做版式检查）。
    estimated_pages: float
    has_text: bool
    checks: list[AnalysisCheck] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "ANALYSIS_CHECK_KEYS",
    "MAX_EXTERNAL_RESUME_BYTES",
    "MAX_NAME_CHARS",
    "AnalysisCheck",
    "AnalysisHit",
    "ExternalResumeAnalysisOut",
    "ExternalResumeBrief",
    "ExternalResumeDetail",
    "ExternalResumeListOut",
    "ExternalResumeUpdateInput",
    "KeywordCoverage",
]

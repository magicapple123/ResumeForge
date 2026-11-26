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


# 单块 / 单段的新文字上限：够改一整段，也挡得住"手滑把整份简历粘进一个块"。
MAX_EDIT_TEXT_CHARS = 4000
# 编辑单元类型（协议值，永不翻译）：PDF 文本块 / Word 段落 / 整篇纯文本。
EDIT_KINDS: tuple[str, ...] = ("pdf", "docx", "text")


class ExternalResumeBlockOut(BaseModel):
    """一个可点选的编辑单元。

    PDF 的块带 bbox / 字号 / 行距 / 对齐（前端据此画点选热区并按原参数显示）；
    DOCX 段落与整篇文本没有纸面坐标，几何字段全为 0。
    """

    block_id: str
    # 1 基页码；docx / text 恒为 0（不分页）。
    page: int = 0
    text: str = ""
    editable: bool = True
    # 不可编辑的原因码（可编辑时为空串）：pdf_block_rotated / docx_paragraph_not_editable …
    reason: str = ""
    x0: float = 0.0
    y0: float = 0.0
    x1: float = 0.0
    y1: float = 0.0
    size: float = 0.0
    leading: float = 0.0
    # left / center / right / justify
    align: str = ""


class ExternalResumeBlocksOut(BaseModel):
    """一份外部简历的编辑视图：格式 + 编辑单元 + 页面尺寸（PDF 才有）。"""

    resume_id: int
    kind: str
    page_count: int = 0
    page_width: float = 0.0
    page_height: float = 0.0
    blocks: list[ExternalResumeBlockOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExternalResumeEditInput(BaseModel):
    """一次改字：改哪一块、改成什么、要不要顺手把下方内容下移。

    ``shift_below`` 是用户点「下移下方内容 Δpt」时才传的量（pt，正数向下）；
    默认 0 = 什么都不动（与 Acrobat 的文本框行为一致）。
    """

    model_config = ConfigDict(extra="forbid")

    block_id: str = Field(min_length=1, max_length=64)
    text: str = Field(default="", max_length=MAX_EDIT_TEXT_CHARS)
    # 上限取"一页高度"的量级：块变高几百 pt 是正常情形，卡太紧会把合法的下移挡成 422。
    shift_below: float = Field(default=0.0, ge=0.0, le=1000.0)


class ExternalResumeRevisionOut(BaseModel):
    """历史版本列表的一行（不复制正文：字节在各 `user_file` 里）。"""

    id: int
    file_id: int
    text_chars: int
    has_text: bool
    # upload / edit / restore
    source: str
    created_at: datetime
    # 是否当前版本（`file_id` 与简历当前 file_id 相同）。
    current: bool = False


class ExternalResumeRevisionsOut(BaseModel):
    resume_id: int
    items: list[ExternalResumeRevisionOut] = Field(default_factory=list)
    total: int = 0


class ExternalResumeRevisionTextOut(BaseModel):
    """某一版历史版本的正文（T12：点「对比」时才取，列表里不带）。

    正文按需从那一版自己的文件重新提取，所以 `text` 可能与 ``text_chars`` 对不上
    （提取是启发式的：同一份 PDF 用不同库版本读，行数可能差几处）。界面只用它做
    **行级对比**，字数仍以列表里的 `text_chars` 为准——那一个数是当初落库时算的。
    """

    revision_id: int
    text: str = ""
    text_chars: int = 0
    has_text: bool = False


class ExternalResumeEditOut(BaseModel):
    """编辑结果：新的简历详情 + 新版本 + 几何变化（前端画红框 / 提示用）。"""

    resume: ExternalResumeDetail
    revision: ExternalResumeRevisionOut
    kind: str
    block_id: str
    page: int = 0
    # 块高变化（pt，> 0 = 变高）。docx / text 恒为 0。
    delta_pt: float = 0.0
    # 新文字是否压到下方内容 / 是否缩过字号 / 是否执行了下移。
    overflow: bool = False
    scaled: bool = False
    shifted: bool = False
    lines_before: int = 0
    lines_after: int = 0
    warnings: list[str] = Field(default_factory=list)


class ExternalResumeRestoreOut(BaseModel):
    """恢复到某个历史版本的结果：返回刷新后的详情 + 新写入的那条版本。"""

    resume: ExternalResumeDetail
    revision: ExternalResumeRevisionOut
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "ANALYSIS_CHECK_KEYS",
    "EDIT_KINDS",
    "MAX_EDIT_TEXT_CHARS",
    "MAX_EXTERNAL_RESUME_BYTES",
    "MAX_NAME_CHARS",
    "AnalysisCheck",
    "AnalysisHit",
    "ExternalResumeAnalysisOut",
    "ExternalResumeBlockOut",
    "ExternalResumeBlocksOut",
    "ExternalResumeBrief",
    "ExternalResumeDetail",
    "ExternalResumeEditInput",
    "ExternalResumeEditOut",
    "ExternalResumeListOut",
    "ExternalResumeRestoreOut",
    "ExternalResumeRevisionOut",
    "ExternalResumeRevisionTextOut",
    "ExternalResumeRevisionsOut",
    "ExternalResumeUpdateInput",
    "KeywordCoverage",
]

# SPDX-License-Identifier: Apache-2.0
"""岗位匹配的**文本级**口径（R-31 / T34）。

为什么单独一个 schema，而不是复用 ``schemas.job_match.JobMatchResult``：

1. **口径不同**。结构化匹配把 JD 与「我的资料 + 内部简历的结构化字段 / 版式」对齐，由模型
   逐条判断"到没到"（五类状态 + 准入闸门）；文本级只做一件事——**JD 里抽出来的词，在外部
   简历的正文字里出现了没有**。两者回答的不是同一个问题。
2. **不可混排**。外部简历没有 ``content``（条目 / 字段 / 纸面位置），拿它去算结构化分项
   等于给一个不存在的结构打分。所以这里**不产出** ``admission`` / ``hard_gate`` /
   ``MatchCondition``，也不产出五类状态——前端因此不可能把它渲染进结构化那张列表。
3. **不落库**。文本级结果是确定性纯函数（同样的 JD + 同样的正文 → 同样的词表），每次现算
   只要几毫秒；不写 ``job_match_analysis`` 表，也就不存在"外部结论覆盖内部结论"的路径。

**没有评分字段**（与结构化匹配同一条硬约束）：只有 ``target_count`` / ``matched_count``
两个计数，比例由界面自己算并写成「字面覆盖 x/y」。给一个 0-100 的分数会让人误以为它可以
和结构化匹配的参考分比较——它们的分母根本不是一回事。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# 口径标识：前端据此始终显示「文本级」标记，不靠"用户刚点了哪个按钮"来推断。
MATCH_METHOD_TEXT_LEVEL = "text_level"

MAX_WORD_CHARS = 64
MAX_WORDS = 60
MAX_HIGHLIGHT_CHARS = 200
MAX_HIGHLIGHTS = 3
MAX_NOTE_CHARS = 500
MAX_NOTES = 6
MAX_NAME_CHARS = 256
MAX_TITLE_CHARS = 255


class TextLevelHighlight(BaseModel):
    """一句正文摘录 + 它命中的 JD 词。

    只摘**正文原文**，不改写、不摘要：用户要能一眼回到那份简历里核对"这句真的在"。
    """

    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=MAX_HIGHLIGHT_CHARS)
    words: list[str] = Field(default_factory=list, max_length=MAX_WORDS)


class TextLevelMatchRequest(BaseModel):
    """一次文本级比对的入参。"""

    model_config = ConfigDict(extra="forbid")

    external_resume_id: int = Field(gt=0)


class TextLevelMatchOut(BaseModel):
    """文本级比对结果（**不是**匹配度分数，见模块头）。"""

    model_config = ConfigDict(extra="forbid")

    method: Literal["text_level"] = MATCH_METHOD_TEXT_LEVEL
    job_id: int
    job_title: str = Field(default="", max_length=MAX_TITLE_CHARS)
    company: str = Field(default="", max_length=MAX_TITLE_CHARS)
    external_resume_id: int
    resume_name: str = Field(default="", max_length=MAX_NAME_CHARS)
    text_chars: int = 0
    # 分母：从 JD 抽出来的目标词（核心词在前，补充词在后）。
    target_words: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    # 正文字里出现过 / 没出现过的目标词。
    matched_words: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    missing_words: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    # 两档明细：核心词（JD 要求段里的词库/别名命中）与补充词（其余抽取词）。
    core_target: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    core_matched: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    supplementary_target: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    supplementary_matched: list[str] = Field(default_factory=list, max_length=MAX_WORDS)
    # 计数派生的比例，前端不要自己重算分母（重算就会和这里不一致）。
    target_count: int = 0
    matched_count: int = 0
    highlights: list[TextLevelHighlight] = Field(default_factory=list, max_length=MAX_HIGHLIGHTS)
    # 口径说明（与 ``JobMatchResult.notes`` 同一定位：由服务端写，界面原样展示）。
    notes: list[str] = Field(default_factory=list, max_length=MAX_NOTES)
    generated_at: datetime


__all__ = [
    "MATCH_METHOD_TEXT_LEVEL",
    "TextLevelHighlight",
    "TextLevelMatchOut",
    "TextLevelMatchRequest",
]

# SPDX-License-Identifier: Apache-2.0
"""模拟面试的请求/响应结构。"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..vocabulary.interview import (
    INTERVIEW_DIFFICULTIES,
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    INTERVIEW_TYPES,
    INTERVIEWER_STYLES,
    MESSAGE_PHASE_INTERVIEW,
)
from .interview_material import InterviewMaterialIn

# R-11 个性化题库 / 答题思路分析 / 反向优化简历的模型已迁至
# ``schemas/interview_practice.py``；这里 re-export，保持既有导入路径不变。
from .interview_practice import (  # noqa: F401  (re-export：保持既有导入路径)
    MAX_ANALYSIS_CONTEXT_CHARS,
    MAX_ANALYSIS_QUESTION_CHARS,
    MAX_MY_ANSWER_CHARS,
    MAX_OPTIMIZE_ITEMS,
    MAX_QUESTION_ANSWER_CHARS,
    MAX_QUESTION_BANK_PER_TYPE,
    MAX_RESUME_TEXT_CHARS,
    MAX_SAMPLE_PHRASING_CHARS,
    QUESTION_BANK_TYPES,
    InterviewAnalysisOut,
    InterviewAnalysisRequest,
    InterviewAnswerReviewOut,
    InterviewAnswerReviewRequest,
    InterviewOptimizeOut,
    InterviewOptimizeRequest,
    InterviewQuestionAnswerOut,
    InterviewQuestionAnswerRequest,
    InterviewQuestionGenerateRequest,
    InterviewQuestionItem,
    QuestionBankGroup,
    QuestionBankOut,
    ResumeMaterialInput,
)
from .resume import ResumeSuggestion  # noqa: F401  (re-export：保持既有导入路径)

MAX_INTERVIEW_ROUNDS = 12
MIN_INTERVIEW_ROUNDS = 3
MAX_ANSWER_CHARS = 8000
MAX_PERSONA_CHARS = 2000
MAX_FOCUS_CHARS = 255

InterviewType = Literal[
    "技术面",
    "项目深挖",
    "行为面（STAR）",
    "HR 面",
    "综合面",
    "案例分析",
    "英语面试",
    "压力面",
]
InterviewDifficulty = Literal["初级", "中级", "高级"]
InterviewerStyle = Literal["严谨专业", "温和引导", "持续追问", "压力质询"]
InterviewStatus = Literal["active", "finished"]


class InterviewCreate(BaseModel):
    """开一场模拟面试。

    每一侧材料都是**二选一**（0071 / #41）：要么指向一条记录（``job_id`` / ``resume_id``），
    要么带一份导入的材料（``job_material`` / ``resume_material``），具体校验在接口层做。
    **回滚兼容**：老客户端只传 ``job_id`` + ``resume_id``，行为与 0066 完全一致。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=128)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    # 导入的材料（#41）：给了材料就不再读那条记录。
    job_material: InterviewMaterialIn | None = None
    resume_material: InterviewMaterialIn | None = None
    interview_type: InterviewType = "技术面"
    difficulty: InterviewDifficulty = "中级"
    interviewer_style: InterviewerStyle = "严谨专业"
    rounds: int = Field(default=6, ge=MIN_INTERVIEW_ROUNDS, le=MAX_INTERVIEW_ROUNDS)
    # 自动收尾的模式开关：非空 = 何时结束完全由 AI 按表现判断（提示词/界面都不出现
    # 轮数范围；rounds 只作为服务端的硬性保险）；NULL = 固定轮数模式。
    rounds_min: int | None = Field(default=None, ge=MIN_INTERVIEW_ROUNDS, le=MAX_INTERVIEW_ROUNDS)
    # 自定义面试官人设（会拼进系统提示，优先级高于默认风格）。
    persona: str = Field(default="", max_length=MAX_PERSONA_CHARS)
    focus: str = Field(default="", max_length=MAX_FOCUS_CHARS)

    @field_validator("interview_type")
    @classmethod
    def type_must_be_supported(cls, value: str) -> str:
        return _validate_choice(value, INTERVIEW_TYPES, "面试类型")

    @field_validator("difficulty")
    @classmethod
    def difficulty_must_be_supported(cls, value: str) -> str:
        return _validate_choice(value, INTERVIEW_DIFFICULTIES, "难度")

    @field_validator("interviewer_style")
    @classmethod
    def style_must_be_supported(cls, value: str) -> str:
        return _validate_choice(value, INTERVIEWER_STYLES, "面试官风格")

    @model_validator(mode="after")
    def auto_rounds_interval_is_valid(self) -> "InterviewCreate":
        if self.rounds_min is not None and self.rounds_min >= self.rounds:
            raise ValueError("自动轮数的下限必须小于上限（rounds_min < rounds）")
        return self


class InterviewAnswerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=MAX_ANSWER_CHARS)
    # 语音轮次幂等键（#26 P0）：同一轮重复提交不重复计轮；纯文字调用方不传。
    client_turn_id: str | None = Field(default=None, max_length=64)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("回答不能为空")
        return cleaned


class InterviewAnswerRevise(BaseModel):
    """「改文字重问」（Q1-L2）：把自己刚提交的那条回答换成新文字。

    单独一个模型而不是给 ``InterviewAnswerCreate`` 加字段：`extra="forbid"` 下多一个字段
    就要动所有既有调用方，而"改"与"答"是两种语义。
    """

    model_config = ConfigDict(extra="forbid")

    # 要改的那条**用户消息**的 id（不是轮次号：轮次号在 `answered_rounds` 里是派生值）。
    message_id: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=MAX_ANSWER_CHARS)

    @field_validator("content")
    @classmethod
    def revised_content_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("回答不能为空")
        return cleaned


class InterviewMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    # 阶段（0071）：``interview`` = 正式问答，``followup`` = 结束后的追问（独立渲染）。
    phase: str = MESSAGE_PHASE_INTERVIEW
    content: str
    context: dict[str, Any] = Field(default_factory=dict)
    status: str
    error: str
    created_at: datetime

    @field_validator("phase", mode="before")
    @classmethod
    def phase_defaults_to_interview(cls, value: Any) -> str:
        """列默认值是 ``interview``；对象还没 flush 时属性可能是 ``None``，按默认处理。"""
        text = str(value or "").strip()
        return text or MESSAGE_PHASE_INTERVIEW


class InterviewDurationUpdate(BaseModel):
    """累计「有效面试时长」上报：**绝对累计值**（不是增量），服务端 ``max()`` 取大值。"""

    model_config = ConfigDict(extra="forbid")

    elapsed_seconds: int = Field(ge=0, le=86_400)


class InterviewBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    job_id: int | None
    job_title: str
    company: str
    # 关联简历（0066）：面试官只读这份简历 + 关联岗位的 JD。
    resume_id: int | None = None
    resume_title: str = ""
    # 导入的材料文件名（0071）：空串 = 该侧材料来自记录（或历史会话没有材料）。
    job_material_name: str = ""
    resume_material_name: str = ""
    # 累计有效面试时长（秒）：界面在「准备好了」之后计时、离开暂停。
    duration_seconds: int = 0
    interview_type: str
    difficulty: str
    interviewer_style: str
    rounds: int
    # 自动轮数下限：非空表示这场面试是自动收尾模式（界面据此显示"第 N 轮"而非"第 N/M 轮"）。
    rounds_min: int | None = None
    status: InterviewStatus
    created_at: datetime
    updated_at: datetime
    # 追问区收起的时刻（0072 / #41）：非空 = 用户点了「停止追问」，不改 status 与轮数。
    follow_up_closed_at: datetime | None = None
    # 已完成的问答轮数，列表里显示"第 3/6 轮"。
    answered_rounds: int = 0


class InterviewDetail(InterviewBrief):
    persona: str = ""
    focus: str = ""
    model: str = ""
    report: dict[str, Any] = Field(default_factory=dict)
    messages: list[InterviewMessageOut] = Field(default_factory=list)


class InterviewAnswerResult(BaseModel):
    """一轮问答的结果：点评 + 下一题（或收尾）。"""

    session: InterviewDetail
    feedback: str = ""
    # 为真表示**正式问答**已经结束（达到计划轮数，或模型/候选人要求收尾）。
    finished: bool = False
    # 正式问答已收尾但**报告还没生成**：由用户在决策卡上决定追问还是出报告。
    needs_report: bool = False


class InterviewFollowUpCreate(BaseModel):
    """面试结束后的「追问」（#41）：不占正式轮次，只就这场面试继续聊。"""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=MAX_ANSWER_CHARS)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("追问不能为空")
        return cleaned


class InterviewFollowUpResult(BaseModel):
    """一次追问的结果：面试官的回答 + 刷新后的整场会话（含追问记录）。"""

    session: InterviewDetail
    answer: str = ""


class InterviewFollowUpStateUpdate(BaseModel):
    """收起 / 重新打开追问区（#41）：布尔而不是时间戳，关闭时刻由服务端在那一刻记。"""

    model_config = ConfigDict(extra="forbid")

    closed: bool


def _validate_choice(value: str, allowed: tuple[str, ...], label: str) -> str:
    cleaned = (value or "").strip()
    if cleaned not in allowed:
        raise ValueError(f"无效的{label}，可选值：{'、'.join(allowed)}")
    return cleaned


__all__ = [
    "MAX_INTERVIEW_ROUNDS",
    "MIN_INTERVIEW_ROUNDS",
    "InterviewAnswerCreate",
    "InterviewAnswerResult",
    "InterviewBrief",
    "InterviewCreate",
    "InterviewDetail",
    "InterviewDurationUpdate",
    "InterviewMessageOut",
    "INTERVIEW_STATUS_ACTIVE",
    "INTERVIEW_STATUS_FINISHED",
    "QUESTION_BANK_TYPES",
    "InterviewQuestionItem",
    "QuestionBankGroup",
    "QuestionBankOut",
    "InterviewQuestionGenerateRequest",
    "InterviewAnalysisRequest",
    "InterviewAnalysisOut",
    "InterviewQuestionAnswerRequest",
    "InterviewQuestionAnswerOut",
    "InterviewAnswerReviewRequest",
    "InterviewAnswerReviewOut",
    "InterviewOptimizeRequest",
    "InterviewOptimizeOut",
]

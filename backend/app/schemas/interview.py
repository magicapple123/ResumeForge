# SPDX-License-Identifier: Apache-2.0
"""模拟面试的请求/响应结构。"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..models.interview import (
    INTERVIEW_DIFFICULTIES,
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    INTERVIEW_TYPES,
    INTERVIEWER_STYLES,
    MESSAGE_PHASE_INTERVIEW,
)
from .interview_material import InterviewMaterialIn
from .resume import ResumeSuggestion

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


# ===== R-11 个性化题库 / 答题思路分析 / 反向优化简历 =====
QUESTION_BANK_TYPES = ("基础题", "项目深挖题", "反问HR题")

# 参考答案（单题）字段的长度上限，复用于题库历史里持久化的参考答案。
MAX_QUESTION_ANSWER_CHARS = 10_000
MAX_SAMPLE_PHRASING_CHARS = 5_000
# 自己写的作答上限：比面试里一轮回答（8000）宽一点，允许把思路写全再交批改。
MAX_MY_ANSWER_CHARS = 12_000
# 外部简历 / 导入文件的正文上限：与题库那一侧同一个数，远超一份简历的实际长度。
MAX_RESUME_TEXT_CHARS = 50_000

MAX_QUESTION_BANK_PER_TYPE = 8
MAX_ANALYSIS_QUESTION_CHARS = 2000
MAX_ANALYSIS_CONTEXT_CHARS = 20_000
MAX_OPTIMIZE_ITEMS = 20


class ResumeMaterialInput(BaseModel):
    """外部简历 / 导入文件带上来的正文（Q3）：没有内部 ``resume_id`` 时靠它进提示词。"""

    resume_text: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    resume_title: str = Field(default="", max_length=255)

    @field_validator("resume_text", "resume_title")
    @classmethod
    def strip_resume_material(cls, value: str) -> str:
        return value.strip()


class InterviewQuestionItem(BaseModel):
    """题库里的一道题：问题 + 考察意图 + 一句话提示（可带已生成的参考答案）。"""

    question: str = Field(default="", max_length=2000)
    purpose: str = Field(default="", max_length=1000)
    answer_hint: str = Field(default="", max_length=2000)
    answer: str | None = Field(default=None, max_length=MAX_QUESTION_ANSWER_CHARS)
    key_points: list[str] | None = Field(default=None, max_length=20)
    sample_phrasing: str | None = Field(default=None, max_length=MAX_SAMPLE_PHRASING_CHARS)
    # 候选人自答与批改结果：用 ``dict`` 而不是强类型，旧记录里可能缺字段。
    my_answer: str = Field(default="", max_length=MAX_MY_ANSWER_CHARS)
    review: dict = Field(default_factory=dict)


class QuestionBankGroup(BaseModel):
    """按类型分组的一批题。``type`` 取值见 ``QUESTION_BANK_TYPES``。"""

    type: str = Field(default="", max_length=32)
    questions: list[InterviewQuestionItem] = Field(
        default_factory=list, max_length=MAX_QUESTION_BANK_PER_TYPE
    )


class QuestionBankOut(BaseModel):
    """个性化题库的即时结果。"""

    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    resume_id: int | None = None
    resume_title: str = ""
    groups: list[QuestionBankGroup] = Field(
        default_factory=list, max_length=len(QUESTION_BANK_TYPES)
    )
    llm_used: bool = True
    notes: list[str] = Field(default_factory=list)


class InterviewQuestionGenerateRequest(BaseModel):
    """生成题库的输入：岗位与简历都可选，至少给一个才有针对性。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    job_text: str = Field(default="", max_length=20_000)
    resume_text: str = Field(default="", max_length=50_000)
    resume_title: str = Field(default="", max_length=255)

    @field_validator("job_text", "resume_text", "resume_title")
    @classmethod
    def strip_material_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_a_target(self) -> "InterviewQuestionGenerateRequest":
        if not any((self.job_id, self.resume_id, self.job_text, self.resume_text)):
            raise ValueError("请至少关联一个岗位或一份简历，题库才能有针对性")
        return self


class InterviewAnalysisRequest(ResumeMaterialInput):
    """输入一道真实问题，分析答题思路。

    给了 ``resume_id``（内部记录）时正文由服务端自己读；否则用随请求带上来的
    ``resume_text``——外部简历与导入文件没有内部 id，这是它们唯一的入口。
    """

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_ANALYSIS_QUESTION_CHARS)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    # 用户补充的背景（如"这是二面的追问"）。
    context: str = Field(default="", max_length=MAX_ANALYSIS_CONTEXT_CHARS)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("问题不能为空")
        return cleaned


class InterviewAnalysisOut(BaseModel):
    """答题思路：框架 + 要点 + 可能的追问 + 常见误区。"""

    question: str = ""
    framework: str = Field(default="", max_length=10_000)
    key_points: list[str] = Field(default_factory=list, max_length=20)
    follow_up: list[str] = Field(default_factory=list, max_length=20)
    pitfalls: list[str] = Field(default_factory=list, max_length=20)


class InterviewQuestionAnswerRequest(BaseModel):
    """为单道题生成详细参考答案：题目必填，岗位与简历可选（给背景）。"""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_ANALYSIS_QUESTION_CHARS)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("问题不能为空")
        return cleaned


class InterviewQuestionAnswerOut(BaseModel):
    """单题的详细参考答案：正文 + 要点 + 一句可套用的话术。"""

    question: str = ""
    answer: str = Field(default="", max_length=MAX_QUESTION_ANSWER_CHARS)
    key_points: list[str] = Field(default_factory=list, max_length=20)
    sample_phrasing: str = Field(default="", max_length=MAX_SAMPLE_PHRASING_CHARS)


class InterviewAnswerReviewRequest(BaseModel):
    """把自己的作答交给 AI 批改：题目与作答必填，岗位 / 简历 / 参考答案可选（给背景）。"""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_ANALYSIS_QUESTION_CHARS)
    my_answer: str = Field(min_length=1, max_length=MAX_MY_ANSWER_CHARS)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    # 已生成参考答案时一并带上：让批改能对照"标准答法"指出差在哪，比凭空评判更准。
    reference_answer: str = Field(default="", max_length=MAX_QUESTION_ANSWER_CHARS)

    @field_validator("question")
    @classmethod
    def review_question_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("问题不能为空")
        return cleaned

    @field_validator("my_answer")
    @classmethod
    def my_answer_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("回答不能为空")
        return cleaned


class InterviewAnswerReviewOut(BaseModel):
    """一份作答的批改结果：分数 + 总评 + 亮点 / 差距 / 修改建议 + 改写示范。"""

    question: str = ""
    score: int = Field(default=0, ge=0, le=100)
    summary: str = Field(default="", max_length=2_000)
    strengths: list[str] = Field(default_factory=list, max_length=10)
    gaps: list[str] = Field(default_factory=list, max_length=10)
    suggestions: list[str] = Field(default_factory=list, max_length=10)
    revised_answer: str = Field(default="", max_length=MAX_QUESTION_ANSWER_CHARS)


class InterviewOptimizeRequest(ResumeMaterialInput):
    """把面试暴露的短板与高频追问，反向转成简历改写建议。

    ``resume_id`` 可为空（Q3）：外部简历与导入文件没有内部 id，正文走 ``resume_text``，
    两者**至少给一个**。
    """

    model_config = ConfigDict(extra="forbid")

    resume_id: int | None = Field(default=None, ge=1)
    job_id: int | None = Field(default=None, ge=1)
    # 面试里暴露的短板（如"项目难点说不清"）。
    weaknesses: list[str] = Field(default_factory=list, max_length=MAX_OPTIMIZE_ITEMS)
    # 面试官的高频追问（如"这个指标怎么算出来的"）。
    follow_ups: list[str] = Field(default_factory=list, max_length=MAX_OPTIMIZE_ITEMS)

    @model_validator(mode="after")
    def require_some_input(self) -> "InterviewOptimizeRequest":
        if not self.weaknesses and not self.follow_ups:
            raise ValueError("请至少填写一条面试暴露的短板或高频追问")
        # 二选一而不是"必须 id"：外部简历没有内部记录，正文只能随请求带上来。
        if self.resume_id is None and not self.resume_text:
            raise ValueError("请提供要优化的简历：resume_id 与 resume_text 至少给一个")
        return self


class InterviewOptimizeOut(BaseModel):
    """反向优化结果：**只产出建议列表**，不直接修改简历正文（回填由前端走既有编辑流程）。"""

    # 契约变更（Q3）：外部简历 / 导入文件没有内部 id，这里如实返回 None，不再拿 0 冒充。
    resume_id: int | None = None
    suggestions: list[ResumeSuggestion] = Field(default_factory=list, max_length=20)
    llm_used: bool = True
    notes: list[str] = Field(default_factory=list)


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

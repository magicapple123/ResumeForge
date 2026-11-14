# SPDX-License-Identifier: Apache-2.0
"""个性化题库 / 答题思路分析 / 反向优化简历 Schema（从 ``schemas/interview.py`` 迁出）。"""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .resume import ResumeSuggestion

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

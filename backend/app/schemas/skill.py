# SPDX-License-Identifier: Apache-2.0
"""助手技能 Schema：列表项、详情、创建与更新。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_SKILL_NAME_CHARS = 64
MAX_SKILL_DESCRIPTION_CHARS = 255

# 技能上限（T14 统一口径）：提示词进系统提示，注入了就占预算；知识文件进数据库与备份。
# 这组数字必须与**模型看到的工具描述**一致（create_skill / update_skill 的 description），
# 由 backend/tests/test_skill_limits_guard.py 正则交叉校验——两处写不同数字时模型会按
# 更宽的口径调用，最后在保存时撞 422，用户看到的是"助手说能加，实际加不进去"。
MAX_SKILL_PROMPT_CHARS = 4_000
MAX_SKILL_FILE_CHARS = 20_000
MAX_SKILL_FILES = 10
# 单文件限制挡不住"10 个都贴着上限"的技能包；合计上限才是真正约束上下文/备份体积的那条。
MAX_SKILL_TOTAL_FILE_CHARS = 60_000
MAX_SKILL_FILE_PATH_CHARS = 255


class AssistantSkillFileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=MAX_SKILL_FILE_PATH_CHARS)
    content: str = Field(default="", max_length=MAX_SKILL_FILE_CHARS)

    @field_validator("path")
    @classmethod
    def path_must_be_flat(cls, value: str) -> str:
        """知识文件名只允许一层，且不能带路径符号——读取时直接按名字匹配。"""
        value = value.strip().replace("\\", "/")
        if "/" in value or value in {".", ".."} or ":" in value:
            raise ValueError("知识文件名不能包含路径")
        if not value:
            raise ValueError("知识文件名不能为空")
        return value


# 详情接口一次最多回传多少知识文件正文；超出后只回文件名，避免一个超大技能包
# 把响应撑到几十 MB（工作台编辑时会用到正文，所以不能只给清单）。
# 与合计上限对齐：合法的技能包（<=60,000 字）永远能完整加载，不会出现"能保存却读不全"。
MAX_SKILL_DETAIL_FILE_CHARS = MAX_SKILL_TOTAL_FILE_CHARS


class AssistantSkillFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    path: str
    size_bytes: int
    content: str = ""


class AssistantSkillOut(BaseModel):
    """技能列表项。``prompt`` 正文不回传：列表只需要展示元信息。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    enabled: bool
    source_name: str
    prompt_chars: int
    files: list[str]
    updated_at: datetime
    # 0016（#31D/E）：四段内容的另外三段 + 版本 + 生成/验证状态。
    # 手工导入的老技能默认空串 / 1 / 0 / 空状态，界面不显示徽标。
    when_to_use: str = ""
    steps: str = ""
    pitfalls: str = ""
    version: int = 1
    generated: bool = False
    validation_status: str = ""
    last_loaded_at: datetime | None = None


class AssistantSkillDetail(AssistantSkillOut):
    """技能详情：查看与编辑都需要提示词正文和文件内容。"""

    prompt: str = ""
    file_details: list[AssistantSkillFileOut] = Field(default_factory=list)
    # 为真表示有知识文件因超出上限没带正文；前端此时不要覆盖式提交 files，
    # 否则会把没加载到的内容写丢。
    files_truncated: bool = False


class AssistantSkillCreate(BaseModel):
    """在工作台里手工创建技能。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_SKILL_NAME_CHARS)
    description: str = Field(default="", max_length=MAX_SKILL_DESCRIPTION_CHARS)
    prompt: str = Field(default="", max_length=MAX_SKILL_PROMPT_CHARS)
    # deprecated（T14）：技能改为按对话启用；保留字段兼容旧客户端，但不再影响注入。
    enabled: bool = True
    files: list[AssistantSkillFileInput] = Field(default_factory=list, max_length=MAX_SKILL_FILES)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("技能名称不能为空")
        return value

    @model_validator(mode="after")
    def files_must_fit_the_total_budget(self) -> "AssistantSkillCreate":
        total = sum(len(item.content) for item in self.files)
        if total > MAX_SKILL_TOTAL_FILE_CHARS:
            raise ValueError(
                f"知识文件合计不能超过 {MAX_SKILL_TOTAL_FILE_CHARS:,} 字符，"
                f"当前 {total:,} 字符；请减少文件数量或精简内容"
            )
        return self

    def require_prompt(self) -> "AssistantSkillCreate":
        if not self.prompt.strip():
            raise ValueError("请填写技能提示词：它决定这个技能让助手怎么做")
        return self


class AssistantSkillUpdate(BaseModel):
    """更新技能；只提交要改的字段。``files`` 提交时整体替换。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_SKILL_NAME_CHARS)
    description: str | None = Field(default=None, max_length=MAX_SKILL_DESCRIPTION_CHARS)
    prompt: str | None = Field(default=None, max_length=MAX_SKILL_PROMPT_CHARS)
    # deprecated（T14）：全局开关不再参与注入，保留字段兼容旧客户端（工作台已不再提交它）。
    enabled: bool | None = None
    files: list[AssistantSkillFileInput] | None = Field(default=None, max_length=MAX_SKILL_FILES)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank_when_set(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if not value:
            raise ValueError("技能名称不能为空")
        return value

    @model_validator(mode="after")
    def files_must_fit_the_total_budget(self) -> "AssistantSkillUpdate":
        # 只提交部分字段时 files 为 None（不动已有文件），此时不校验合计。
        total = sum(len(item.content) for item in self.files or ())
        if total > MAX_SKILL_TOTAL_FILE_CHARS:
            raise ValueError(
                f"知识文件合计不能超过 {MAX_SKILL_TOTAL_FILE_CHARS:,} 字符，"
                f"当前 {total:,} 字符；请减少文件数量或精简内容"
            )
        return self

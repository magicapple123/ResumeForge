# SPDX-License-Identifier: Apache-2.0
"""公司/岗位背景调研的请求 schema（T07）。

响应形状刻意**不做**成 Pydantic 模型：卡片与简报是"外部资料的投影"，字段由
``services/job/company_research*`` 的三份组装函数保证（它们各自返回纯 dict，
顺序与键集合稳定），再套一层模型只是在两处维护同一份真相。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 与 ``services/job/company_research`` 的上限保持一致——两处都要改时先改服务层常量，
# 这里只做"请求还没进业务逻辑就挡住明显超限的输入"的第一道闸。
MAX_COMPANY_CHARS = 80
MAX_ROLE_CHARS = 80
MAX_JD_CHARS = 6_000

# 历史分页（T07）：默认 20，上限 50。上限存在的理由是一页要带正文摘要与卡片数，
# 放大到 200 会让一次列表请求传几 MB；真要看全部，用游标翻页。
DEFAULT_HISTORY_LIMIT = 20
MAX_HISTORY_LIMIT = 50


class ResearchCompanyRequest(BaseModel):
    """``POST /api/research/company`` 的入参。

    ``jd`` 是用户粘贴的招聘描述，**按不可信数据处理**：它只被塞进提示词的
    ``<JD>`` 区段，永远不会被当作指令执行（见 ``company_research_brief``）。
    """

    model_config = ConfigDict(extra="forbid")

    company: str = Field(min_length=1, max_length=MAX_COMPANY_CHARS)
    role: str = Field(default="", max_length=MAX_ROLE_CHARS)
    jd: str = Field(default="", max_length=MAX_JD_CHARS)
    # 深度调研默认关闭：搜索按查询词条数计费，深度档最多约 20 次工具调用。
    deep: bool = False
    # I-21：从岗位详情发起调研时带上岗位 id，落库的知识条目就能挂到该公司岗位上，
    # 岗位详情的「相关知识」区块直接可见。
    job_id: int | None = Field(default=None, ge=1)
    # I-23：只跑其中一条路。简报失败时没必要重跑已经搜过的卡片（搜索按次计费），
    # 白名单由 Literal 兜住：未知值直接 422，不会走到计费。
    parts: list[Literal["cards", "brief"]] = Field(
        default_factory=lambda: ["cards", "brief"], min_length=1
    )

    @field_validator("company", "role")
    @classmethod
    def _strip_single_line(cls, value: str) -> str:
        """公司名/岗位名是单行短文本：压掉换行与首尾空白，空串交给业务层判必填。"""
        return " ".join(str(value or "").split())

    @field_validator("jd")
    @classmethod
    def _strip_jd(cls, value: str) -> str:
        """JD 保留内部换行（岗位职责与任职要求是两段），只削首尾空白。"""
        return str(value or "").strip()


__all__ = [
    "DEFAULT_HISTORY_LIMIT",
    "MAX_COMPANY_CHARS",
    "MAX_HISTORY_LIMIT",
    "MAX_JD_CHARS",
    "MAX_ROLE_CHARS",
    "ResearchCompanyRequest",
]

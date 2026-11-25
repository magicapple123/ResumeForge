# SPDX-License-Identifier: Apache-2.0
"""搜索 Key 校验的结果模型（CR-04）。

``reason`` 是**稳定协议值**（前端据此选文案），``message`` 是给人看的中文。
两者都要有：前端做 i18n 需要稳定键，排障日志需要可读句子。

取值来自 ``search/status.py`` 的失败词表，外加两个校验入口专有的：
``missing_key``（还没填 Key）与 ``unauthorized``（401/403，合并为"Key 无效或无权限"）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

#: 校验失败原因（空串 = 成功）。
SearchKeyTestReason = Literal[
    "",
    "missing_key",
    "unauthorized",
    "insufficient_balance",
    "rate_limited",
    "network",
    "parse",
]

#: 只有 DeepSeek 有校验入口（§9：Tavily / Jina 后补）。
SUPPORTED_PROBE_SOURCES = ("deepseek",)


class SearchKeyTestIn(BaseModel):
    """待测 Key；留空表示"测已保存的那一把"。"""

    api_key: str = Field(default="", max_length=200)

    def stripped_key(self) -> str:
        return self.api_key.strip()


class SearchKeyTestResult(BaseModel):
    ok: bool
    reason: SearchKeyTestReason = ""
    latency_ms: int | None = None
    message: str = ""


__all__ = [
    "SUPPORTED_PROBE_SOURCES",
    "SearchKeyTestIn",
    "SearchKeyTestReason",
    "SearchKeyTestResult",
]

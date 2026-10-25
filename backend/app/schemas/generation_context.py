# SPDX-License-Identifier: Apache-2.0
"""本次生成上下文（career_context）的请求与快照结构（契约 §2.5）。

**为什么请求与快照分两个类**：请求是客户端可控的"引用"，只有场景 id / 内置 key /
revision / 披露开关；快照是 **server-owned** 的冻结结果——由
``services.career_scenarios.resolve`` 解析后写入 task/record/version/variant 的
``context_snapshot`` 列。请求里禁止出现快照正文、hash 或系统指南（计划 §7.3：
"请求不接收 snapshot、hash、系统指南正文；由服务端解析"）；快照字段也不能塞进
render_context / format_config / content（契约 §2.5 硬约束）。

**解析版本与快照结构版本分开**：``schema_version`` 描述快照结构，
``resolver_version`` / ``prompt_fragment_version`` 描述解析与提示词片段的
生成规则；``catalog_version`` 是内置目录版本。三者不混用（计划 §7.2）。

读取历史快照时**不要**拿本文件里的 Pydantic 模型去校验未知版本（它按当前结构
构造，升级后可能无法解释旧字段）；读取侧用 ``services.resume.scenario_context``
的 dict 入口做尽力解释，并保留原始 JSON 元数据。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 快照结构的当前版本。升级结构时同时保留"读取旧版本如实标注"的分支，
# 不要静默把旧快照重写成新规则（计划 §7.2 末条）。
SNAPSHOT_SCHEMA_VERSION = 1

MAX_PRESET_KEY_LENGTH = 64
MAX_CATALOG_VERSION_LENGTH = 32


class CareerContextRequest(BaseModel):
    """生成请求里显式选用场景的引用（缺省/null = 不启用场景）。

    ``scenario_id`` 与 ``preset_key`` 必须**二选一**：保存场景按 id + 服务端
    revision 引用，内置场景按 key + 目录版本引用；两者同时出现或同时缺失都是客户端
    错误（422），服务端不猜测用户意图，也不自动回落到别的场景（计划 §7.3）。

    **本次是否允许就业状态进入快照只由请求里的 ``include_employment_status`` 决定**：
    保存的场景配置里同名开关只是用户保存的偏好，不构成"这一次生成已经确认发送"的授权，
    避免升级/沿用旧场景时默认把私密状态带给模型（计划 §9.1、§15.1）。
    """

    model_config = ConfigDict(extra="forbid")

    scenario_id: int | None = Field(default=None, ge=1)
    preset_key: str | None = Field(default=None, max_length=MAX_PRESET_KEY_LENGTH)
    catalog_version: str | None = Field(default=None, max_length=MAX_CATALOG_VERSION_LENGTH)
    expected_revision: int | None = Field(default=None, ge=1)
    include_employment_status: bool = False

    @field_validator("preset_key", "catalog_version")
    @classmethod
    def _strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def _validate_reference(self) -> CareerContextRequest:
        has_saved = self.scenario_id is not None
        has_preset = self.preset_key is not None
        if has_saved == has_preset:
            raise ValueError("scenario_id 与 preset_key 必须二选一（都空或都有都不允许）")
        if has_saved and self.expected_revision is None:
            raise ValueError("引用已保存场景时必须提供 expected_revision（避免用错版本）")
        if has_preset and not self.catalog_version:
            raise ValueError("引用内置场景时必须提供 catalog_version（避免目录漂移）")
        return self


class GenerationContextSnapshot(BaseModel):
    """一次生成冻结下来的场景上下文；写入 nullable 的 ``context_snapshot`` 列。

    字段与契约 §2.5 逐项对应。``resolved_dimensions`` 只含**本次允许使用**的维度：
    就业状态值仅在 ``disclosure.include_employment_status`` 为真时出现，否则连键
    都不出现；任何情况下快照不包含姓名、联系方式、证号、家庭或健康信息。

    ``context_sha256`` 是规范化语义配置的哈希（排序键 + 固定分隔符，排除
    ``captured_at``）；``captured_at`` 只用于审计追踪，不参与哈希，也不参与
    任何语义比较（计划 §7.4）。哈希不承诺同模型重跑得到相同文字，只用于上下文追踪。
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SNAPSHOT_SCHEMA_VERSION
    scenario_origin: Literal["preset", "saved"]
    scenario_id: int | None = None
    preset_key: str | None = None
    scenario_revision: int | None = None
    catalog_version: str | None = None
    display_name: str = ""
    resolved_dimensions: dict[str, Any] = Field(default_factory=dict)
    approved_guidance: list[str] = Field(default_factory=list)
    disclosure: dict[str, bool] = Field(default_factory=dict)
    resolver_version: str = "1"
    prompt_fragment_version: str = "1"
    context_sha256: str
    # ISO8601 字符串（服务端时钟）；不参与 hash，也不要求客户端提供。
    captured_at: str


__all__ = [
    "MAX_CATALOG_VERSION_LENGTH",
    "MAX_PRESET_KEY_LENGTH",
    "SNAPSHOT_SCHEMA_VERSION",
    "CareerContextRequest",
    "GenerationContextSnapshot",
]

# SPDX-License-Identifier: Apache-2.0
"""简历**生成参数** Schema（从 ``schemas.resume`` 迁出，导入路径保持兼容）。

拆分动机：``schemas/resume.py`` 已达 500 行预算红线，而「生成请求」这一组模型
（版式参数常量 + ``format_config`` 形状校验 + ``GenerateOptions`` /
``GenerateRequest``）在依赖上是**自洽的最小闭包**——它只用到 ``Literal`` 与
``pydantic``，不引用简历内容结构（``ResumeContent`` 等），因此可以整组搬走。

依赖方向约束：**本模块不 import ``schemas.resume``**（否则循环导入）。
``schemas.resume`` 反向 re-export 这里的全部公开符号，所以既有导入路径
``from app.schemas.resume import GenerateOptions, GenerateRequest, MAX_RESUME_PAGES``
等一处都不用改。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 版式参数：最大篇幅（A4 页数）、字号档位、模板。默认 1 页 + 标准字号。
MAX_RESUME_PAGES = 3
ResumeFontScale = Literal["small", "standard", "large"]
MIN_CUSTOM_INSTRUCTION_CHARS = 0
MAX_CUSTOM_INSTRUCTION_CHARS = 2000
# 版式覆盖的键数上限。真实用到的键只有十来个（分区顺序 + 若干格式字段），32 是"足够
# 宽松、但拒绝把整个配置当垃圾桶"的界限：请求体不该因为这个字段变成无界大小。
MAX_FORMAT_CONFIG_KEYS = 32


def _validate_format_config_shape(value: object) -> dict:
    """只校验 ``format_config`` 的**形状**，不校验具体字段。

    为什么不在 schema 层做白名单与取值范围：那份规则住在
    ``services/resume/resume_template_format.py``（``validated_format_config``），
    schemas 依赖 services 会把依赖方向倒过来。真正的字段白名单与越界丢弃在落库前
    还会再跑一遍，所以这里允许"形状合法但内容要被清洗"的请求原样通过——
    前端可以先把未知键发过来，由服务端统一决定丢不丢，而不是在这里 422。
    """
    if not isinstance(value, dict):
        raise ValueError("format_config 必须是一个对象（JSON object）")
    if len(value) > MAX_FORMAT_CONFIG_KEYS:
        raise ValueError(f"format_config 最多允许 {MAX_FORMAT_CONFIG_KEYS} 个键")
    return value


class GenerateOptions(BaseModel):
    """控制是否允许模型基于已有事实做岗位导向的改写和拓展，以及输出篇幅。"""

    model_config = ConfigDict(extra="forbid")
    enhance: bool = False
    enhancement_level: Literal["light", "balanced", "strong"] = "balanced"
    # 目标篇幅：默认 1 页 A4。塞不下时用户可在预览页加大页数或缩小字号后重新渲染。
    page_limit: int = Field(default=1, ge=1, le=MAX_RESUME_PAGES)
    font_scale: ResumeFontScale = "standard"
    template: str = Field(default="classic", max_length=64)
    # 版式（一组排版覆盖）的名字：内置预设或用户自制版式；空串表示用模板默认的版式。
    format_name: str = Field(default="", max_length=64)
    # 生成时就要生效的版式覆盖（板块顺序、字号系数等）：用户在生成界面上调过的顺序
    # 必须跟着简历一起落库，否则"生成 → 关掉 → 从简历中心重开"顺序就丢了。
    format_config: dict = Field(default_factory=dict)
    # 用户自己补充的生成要求；只作为附加上下文，不会覆盖系统提示里的防虚构规则。
    custom_instruction: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)

    @field_validator("format_config", mode="before")
    @classmethod
    def _check_format_config_shape(cls, value: object) -> dict:
        """形状/大小校验（必须 dict、键数上限）；字段级规则见上面的 docstring。"""
        return _validate_format_config_shape(value)


class GenerateRequest(BaseModel):
    """生成请求。``job_id`` 为空表示生成**通用简历**（不针对任何岗位）。"""

    job_id: int | None = Field(default=None, ge=1)
    title: str = Field(default="", max_length=256)
    options: GenerateOptions = GenerateOptions()


__all__ = [
    "MAX_CUSTOM_INSTRUCTION_CHARS",
    "MAX_FORMAT_CONFIG_KEYS",
    "MAX_RESUME_PAGES",
    "MIN_CUSTOM_INSTRUCTION_CHARS",
    "GenerateOptions",
    "GenerateRequest",
    "ResumeFontScale",
]

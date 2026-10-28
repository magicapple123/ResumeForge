# SPDX-License-Identifier: Apache-2.0
"""批量操作的参数（设置页 · 批量操作）。

**两套参数，互不影响**：

- `generation`：岗位广场「批量 AI 生成简历」——版式、字号、页数、语言、AI 润色、附加要求；
- `export`：简历中心「批量导出简历」——版式、字号、页数、语言、导出格式。

分成两套的原因是这两个动作的取舍本来就不同：生成要决定"写多细、要不要润色"，
导出要决定"出什么格式";；共用一套时改导出格式会顺带改掉下一次生成的行为。字段有重叠
（版式/字号/页数/语言），但各存各的。

字段都有默认值，但"默认值"不等于"已配置"：每节的 `configured` 由该节是否保存过决定；
设置卡首次打开时会用默认值启用一次（`updated_at` 随之写入）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume_generation import ResumeFontScale, ResumeLanguage

BatchEnhancementLevel = Literal["light", "balanced", "strong"]
BatchExportFormat = Literal["pdf", "docx", "html", "md"]

MAX_BATCH_CUSTOM_INSTRUCTION_CHARS = 300
MAX_BATCH_TEMPLATE_CHARS = 64
MAX_BATCH_FORMAT_NAME_CHARS = 128


class _BatchLayoutConfig(BaseModel):
    """两套参数共有的版式字段（各自继承，不共享存储）。"""

    model_config = ConfigDict(extra="forbid")

    template: str = Field(default="classic", max_length=MAX_BATCH_TEMPLATE_CHARS)
    format_name: str = Field(default="", max_length=MAX_BATCH_FORMAT_NAME_CHARS)
    font_scale: ResumeFontScale = "standard"
    page_limit: int = Field(default=1, ge=1, le=3)
    language: ResumeLanguage = "zh-CN"


class BatchGenerationConfig(_BatchLayoutConfig):
    """岗位广场批量生成简历的参数。"""

    enhance: bool = False
    enhancement_level: BatchEnhancementLevel = "balanced"
    custom_instruction: str = Field(default="", max_length=MAX_BATCH_CUSTOM_INSTRUCTION_CHARS)


class BatchExportConfig(_BatchLayoutConfig):
    """简历中心批量导出的参数。"""

    export_format: BatchExportFormat = "pdf"


class BatchGenerationConfigOut(BatchGenerationConfig):
    configured: bool = False
    updated_at: str | None = None


class BatchExportConfigOut(BatchExportConfig):
    configured: bool = False
    updated_at: str | None = None


class BatchOperationConfigOut(BaseModel):
    """两节一起返回：设置页一次读完，两个动作各取所需。"""

    generation: BatchGenerationConfigOut = Field(default_factory=BatchGenerationConfigOut)
    export: BatchExportConfigOut = Field(default_factory=BatchExportConfigOut)


__all__ = [
    "BatchEnhancementLevel",
    "BatchExportConfig",
    "BatchExportConfigOut",
    "BatchExportFormat",
    "BatchGenerationConfig",
    "BatchGenerationConfigOut",
    "BatchOperationConfigOut",
]

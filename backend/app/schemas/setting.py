"""设置 Schema：当前大模型配置与用户保存的配置记录。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LLMConfig(BaseModel):
    """兼容 OpenAI Chat Completions 协议的模型配置（DeepSeek/豆包/Kimi/Ollama 等）。"""

    provider: str = "custom"  # 预设标识，仅用于前端展示
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    temperature: float = Field(default=0.7, ge=0, le=2)
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    max_tokens: int = Field(default=4096, ge=256, le=65536)


class LLMConfigRecordCreate(LLMConfig):
    """命名保存的配置；同名记录会被更新。"""

    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("配置名称不能为空")
        return value


class LLMConfigRecordOut(LLMConfigRecordCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class LLMTestRequest(LLMConfig):
    """测试连接使用表单当前值，不一定先保存。"""


class LLMTestResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str = ""

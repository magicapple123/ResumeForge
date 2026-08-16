"""设置 Schema：大模型运行时配置。"""
from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    """兼容 OpenAI Chat Completions 协议的模型配置（DeepSeek/豆包/Kimi/Ollama 等）。"""

    provider: str = "custom"  # 预设标识，仅用于前端展示
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    temperature: float = Field(default=0.7, ge=0, le=2)
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    max_tokens: int = Field(default=4096, ge=256, le=65536)


class LLMTestRequest(LLMConfig):
    """测试连接使用表单当前值，不一定先保存。"""


class LLMTestResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str = ""

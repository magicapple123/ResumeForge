# SPDX-License-Identifier: Apache-2.0
"""语音转写（ASR）的配置与接口模型。

ASR 走一条**独立**的 OpenAI 兼容 ``/audio/transcriptions`` 服务（计划 §0.1）：
DeepSeek 官方没有转写能力，两个 Key 通常也不是同一个服务商，所以不复用大模型配置记录。

为什么单独一个文件、不放进 ``schemas/setting.py``：那个文件归模型协议线（T09/T10）
的写入者，语音线只新增自己的文件，避免两个写入者改同一个 500 行预算文件。
"""

from pydantic import BaseModel, Field, field_validator

# 单段上限：10 MB / 180 秒（计划 §6）。时长由前端传 ``duration_ms``，服务端只做上限
# 校验，不解析音频——解析 3 分钟音频要额外依赖，而前端本来就知道真实录音时长。
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 180


class AsrSettings(BaseModel):
    """用户填写的语音服务配置（写入用）。

    ``api_key`` 有三种写入口径（见 ``services/asr_settings.py``）：掩码或空串表示
    "沿用已保存的 Key"（仅当地址没变），``__clear__`` 表示显式清空，其它字符串是新 Key。
    """

    base_url: str = Field(default="", max_length=512)
    api_key: str = Field(default="", max_length=8192)
    model: str = Field(default="", max_length=128)

    @field_validator("base_url")
    @classmethod
    def base_url_must_be_http(cls, value: str) -> str:
        # 末尾斜杠统一去掉：拼 ``{base_url}/audio/transcriptions`` 时不做二次判断，
        # 否则 ``https://x/v1/`` 会拼出双斜杠，有的网关会 404。
        cleaned = (value or "").strip().rstrip("/")
        if cleaned and not cleaned.startswith(("http://", "https://")):
            raise ValueError("语音服务地址必须以 http:// 或 https:// 开头")
        return cleaned

    @field_validator("api_key")
    @classmethod
    def api_key_must_be_stripped(cls, value: str) -> str:
        # 粘贴时常带首尾空白/换行；带着它落库，鉴权必然失败。
        return (value or "").strip()

    @field_validator("model")
    @classmethod
    def model_must_be_stripped(cls, value: str) -> str:
        return (value or "").strip()


class AsrSettingsOut(AsrSettings):
    """读取/保存后的配置：``api_key`` 只可能是掩码（``********``）或空串，绝不是原文。"""

    configured: bool = False
    """地址、模型、Key 三者齐全才算配置完成；前端据此决定显示哪句提示。"""


class AsrSettingsTestResult(BaseModel):
    """「测试连接」的结果：失败时用 message 说明前因与下一步，不抛 5xx。"""

    ok: bool
    latency_ms: int | None = None
    message: str = Field(default="", max_length=1000)


class AsrStatus(BaseModel):
    """麦克风组件启动前的只读探测：是否已配置、音频会发到哪台主机、服务端限额。"""

    configured: bool
    provider_host: str = ""
    model: str = ""
    max_seconds: int = MAX_AUDIO_SECONDS
    max_bytes: int = MAX_AUDIO_BYTES


class TranscribeResult(BaseModel):
    """一次转写的结果。**不回显 Key、不回传音频**，只给识别文本与目标主机。"""

    text: str
    provider_host: str = ""

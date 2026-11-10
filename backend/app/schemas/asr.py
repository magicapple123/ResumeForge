# SPDX-License-Identifier: Apache-2.0
"""语音转写（ASR）的配置与接口模型。

ASR 走一条**独立**的转写服务（计划 §0.1）：DeepSeek 官方没有转写能力，两个 Key 通常
也不是同一个服务商，所以不复用大模型配置记录。

为什么单独一个文件、不放进 ``schemas/setting.py``：那个文件归模型协议线（T09/T10）
的写入者，语音线只新增自己的文件，避免两个写入者改同一个 500 行预算文件。

## 为什么需要 ``protocol``

语音服务有两套互不兼容的调用口径，**不能靠猜**：

- ``openai``：``POST {base}/audio/transcriptions``，``multipart/form-data``
  （``file`` + ``model`` + ``language``）。OpenAI / Groq / 硅基流动都是这一套。
- ``dashscope``：阿里云百炼 Qwen-ASR 走 ``POST {base}/chat/completions``，
  ``messages[0].content = [{type: "input_audio", input_audio: {data: "data:<mime>;base64,..."}}]``。

同样的 Base URL 前缀（``/compatible-mode/v1``）让"按地址猜协议"必然出错，所以把协议
显式建模成配置字段。旧数据没有这个字段时取默认 ``openai``，**不需要 Alembic 迁移**
（配置存在 ``AppSetting.asr_config`` 的 JSON 里，多一个键就能读）。
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# 单段上限：10 MB / 180 秒（计划 §6）。时长由前端传 ``duration_ms``，服务端只做上限
# 校验，不解析音频——解析 3 分钟音频要额外依赖，而前端本来就知道真实录音时长。
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 180

# 调用协议：openai = whisper 式 multipart；dashscope = Qwen-ASR 的 chat + input_audio。
AsrProtocol = Literal["openai", "dashscope"]
DEFAULT_ASR_PROTOCOL: AsrProtocol = "openai"


def normalize_base_url(value: str) -> str:
    """地址校验的唯一实现（单配置、命名配置、命名配置测试三处共用）。

    末尾斜杠统一去掉：拼地址时不二次判断，否则 "https://x/v1/" 会拼出双斜杠，
    有的网关会 404。
    """
    cleaned = (value or "").strip().rstrip("/")
    if cleaned and not cleaned.startswith(("http://", "https://")):
        raise ValueError("语音服务地址必须以 http:// 或 https:// 开头")
    return cleaned


def normalize_api_key(value: str) -> str:
    """粘贴时常带首尾空白/换行；带着它落库，鉴权必然失败。"""
    return (value or "").strip()


class AsrEndpoint(BaseModel):
    """地址 + Key + 协议的公共部分（配置、测试连接、拉模型列表共用同一套校验）。

    抽成基类而不是在每个请求模型里复制 ``field_validator``：三处校验必须逐字一致，
    否则"保存能过、测试连接 422"这种漂移会立刻发生。
    """

    base_url: str = Field(default="", max_length=512)
    api_key: str = Field(default="", max_length=8192)
    protocol: AsrProtocol = DEFAULT_ASR_PROTOCOL

    @field_validator("base_url")
    @classmethod
    def base_url_must_be_http(cls, value: str) -> str:
        # 末尾斜杠统一去掉：拼 ``{base_url}/audio/transcriptions`` 时不做二次判断，
        # 否则 ``https://x/v1/`` 会拼出双斜杠，有的网关会 404。
        return normalize_base_url(value)

    @field_validator("api_key")
    @classmethod
    def api_key_must_be_stripped(cls, value: str) -> str:
        return normalize_api_key(value)


class AsrSettings(AsrEndpoint):
    """用户填写的语音服务配置（写入用）。

    ``api_key`` 有三种写入口径（见 ``services/asr_settings.py``）：掩码或空串表示
    "沿用已保存的 Key"（仅当地址与协议都没变），``__clear__`` 表示显式清空，其它字符串
    是新 Key。
    """

    model: str = Field(default="", max_length=128)

    @field_validator("model")
    @classmethod
    def model_must_be_stripped(cls, value: str) -> str:
        return (value or "").strip()


class AsrSettingsOut(AsrSettings):
    """读取/保存后的配置：``api_key`` 只可能是掩码（``********``）或空串，绝不是原文。"""

    configured: bool = False
    """地址、模型、Key 三者齐全才算配置完成；前端据此决定显示哪句提示。"""


class AsrModelsRequest(AsrEndpoint):
    """拉取模型列表的请求体：只要地址、Key 与协议，不需要模型名。"""


class AsrModelsResult(BaseModel):
    """拉取到的模型名列表（``data[].id`` 原样，后端不做关键词过滤）。

    过滤交给前端分组：三家服务的目录都混着 LLM / 图像模型，后端按关键词裁剪会误杀
    自定义服务里的转写模型名。失败一律返回空列表，界面退回手填。
    """

    models: list[str] = Field(default_factory=list)


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
    protocol: AsrProtocol = DEFAULT_ASR_PROTOCOL
    max_seconds: int = MAX_AUDIO_SECONDS
    max_bytes: int = MAX_AUDIO_BYTES


class TranscribeResult(BaseModel):
    """一次转写的结果。**不回显 Key、不回传音频**，只给识别文本与目标主机。"""

    text: str
    provider_host: str = ""

# ===== 命名配置（`global_settings.json` 的 `asr_profiles` 段） =====
#
# 存储与语义在 `services/asr_profiles.py`。这里的模型只做两件事：校验请求体、
# 序列化**不含 Key** 的响应（`has_key` 只说明"这一条有没有已保存的 Key"）。


class AsrProfileIn(AsrSettings):
    """新建/更新一条命名配置的请求体（``POST /settings/asr/profiles``）。

    ``id`` 为空 = 新建；非空 = 按 id 更新。``api_key`` 的三种写入口径与单配置相同，
    但**按条判断**：掩码或空串只保留这一条自己的 Key，绝不从别的配置继承。
    """

    id: str | None = Field(default=None, max_length=64)
    name: str = Field(default="", max_length=200)
    preset_id: str = Field(default="", max_length=32)

    @field_validator("name", "preset_id")
    @classmethod
    def text_must_be_stripped(cls, value: str) -> str:
        return (value or "").strip()


class AsrProfileOut(BaseModel):
    """一条命名配置的对外形态：**不含 Key**，``has_key`` 只说明有没有已保存的 Key。"""

    id: str
    name: str
    preset_id: str = ""
    base_url: str = ""
    model: str = ""
    protocol: AsrProtocol = DEFAULT_ASR_PROTOCOL
    has_key: bool = False
    configured: bool = False
    updated_at: str = ""


class AsrProfilesOut(BaseModel):
    """列表与所有增删改接口的统一响应：前端拿整份状态替换本地副本。"""

    active_profile_id: str = ""
    profiles: list[AsrProfileOut] = Field(default_factory=list)


class AsrProfileTestRequest(BaseModel):
    """弹窗内「测试连接」的草稿覆盖（不落盘）。

    字段全可选：``None`` = 用该条已存配置，给了值就以草稿为准。``api_key`` 的掩码/
    空串同样是"沿用该条已存的 Key"（地址或协议变了才清），与保存口径一致。
    """

    base_url: str | None = Field(default=None, max_length=512)
    model: str | None = Field(default=None, max_length=128)
    protocol: AsrProtocol | None = None
    api_key: str | None = Field(default=None, max_length=8192)

    @field_validator("base_url")
    @classmethod
    def base_url_must_be_http(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # 空串是"草稿里没填"而不是"要连空地址"：保存路径也把空串当未填写。
        return normalize_base_url(value) or None

    @field_validator("model")
    @classmethod
    def model_must_be_stripped(cls, value: str | None) -> str | None:
        return None if value is None else (value or "").strip()

    @field_validator("api_key")
    @classmethod
    def api_key_must_be_stripped(cls, value: str | None) -> str | None:
        return None if value is None else normalize_api_key(value)


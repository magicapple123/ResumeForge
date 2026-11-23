# SPDX-License-Identifier: Apache-2.0
"""Provider capability 声明（RF-14 §2.3）：静态能力表 + 查询接口。

**本批 capability 只做声明与查询**：供设置页/诊断日志复用与排查，不改变任何请求的
默认行为，**不参与工具下发决策**——那是 ``assistant_tools/policy``（RF-01）的职责，
provider 层 capability 不参与工具下发，两者不许混。已有 400 降级路径原样保留：
降级是单次调用的容错，不是能力判定的来源。

各项真值来源（逐项钉死，不许含糊）：

==== ==================== =======================================================
能力 真值来源             现状口径
==== ==================== =======================================================
stream 静态声明，恒 True  两家 provider 的实现本身依赖 SSE 解析，不存在"不支持 stream"分支；声明为 True 是事实描述不是承诺
tools  静态能力表          与 ``thinking.py`` 的 ``_VendorRule`` 同构：host 后缀 + 模型名正则，先匹配先赢；unknown 默认 True（已有 400 降级兜底，判错无额外代价）
structured_output 静态能力表，默认 False  现状没有任何调用发送 response_format（§2.6 立场条款），结构化全靠 prompt + 容错解析
vision 静态能力表，默认 False  图像输入只有部分模型支持：按 host + 模型名声明（见 ``_TABLE``）；未收录一律 False，截图 OCR 走的是同一条声明
reasoning 委托权威实现     ``thinking.thinking_support(config)``，不另立第二张思考表
embeddings 静态能力表，默认 False  RAG v2 刚具备 embedding provider 能力、尚未接线；未收录端点一律 False
==== ==================== =======================================================
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ...schemas.setting import LLMConfig
from .thinking import host_of, thinking_support


@dataclass(frozen=True)
class ProviderCapabilities:
    """某个 (host, model) 端点的能力声明。只描述现状，不承诺未来。"""

    tools: bool
    structured_output: bool  # response_format / 原生 json_schema
    stream: bool
    vision: bool
    reasoning: bool
    embeddings: bool = False


@dataclass(frozen=True)
class _CapabilityRule:
    """一条静态能力表规则：主机后缀匹配 + 模型名正则（None = 不限），先匹配先赢。"""

    host: str
    model_pattern: re.Pattern[str] | None
    tools: bool = True
    embeddings: bool = False
    # 是否接受图像输入。默认 False：多数文本模型收到 image_url 会直接 400，
    # 与其让用户在报告里看到一条晦涩的报错，不如在这里声明"不可用"并给一句原因。
    vision: bool = False


# 能力表。未收录的 (host, model) 默认 tools=True：现状已有 400 降级兜底
# （``openai_compat.stream_chat_events``），保守声明 False 反而会把"本可用"误判成不可用。
# structured_output 当前对所有端点都是 False（见模块 docstring 的现状口径），不需要逐条
# 覆盖；vision 只对确实支持图像输入的型号声明 True——这些**具体规则必须排在同 host 的
# 通用规则之前**，``_match_rule`` 是先匹配先赢。
_TABLE: tuple[_CapabilityRule, ...] = (
    # GPT-6 代（6.2 Astra / Sol / Luna）官方模型表写的是文本 + 图像输入；此前正则只到
    # gpt-5，导致预设的 gpt-6.2-astra 被判成"不能看图"，截图又被绕去 OCR。
    _CapabilityRule("api.openai.com", re.compile(r"gpt-4o|gpt-4\.1|gpt-5|gpt-6|o3|o4"), vision=True),
    # OpenRouter 是聚合网关：具体型号千差万别，但走这条端点的用户本来就是挑过模型的。
    _CapabilityRule("openrouter.ai", None, vision=True),
    _CapabilityRule("dashscope.aliyuncs.com", re.compile(r"qwen.*vl|qvq"), vision=True),
    # 官方《文本生成与视觉理解》：Plus / Max / Flash 均可用同一模型接收文本、图像与视频。
    # 只列这三档，避免把纯文本的 qwen3-coder / qwen-long 一起带成 vision。
    _CapabilityRule(
        "dashscope.aliyuncs.com",
        re.compile(r"qwen-(?:plus|max|flash)|qwen[34](?:[.]\d+)?-(?:plus|max|flash)"),
        vision=True,
    ),
    _CapabilityRule("open.bigmodel.cn", re.compile(r"glm-4\.?\d*v|glm-4v"), vision=True),
    # Kimi K3.1 Pro 的视觉输入是官方能力（base64 或 ms:// 文件）；K3 是纯文本，
    # 所以只认 3.1，不能按 ^kimi-k3 一刀切。
    _CapabilityRule("api.moonshot", re.compile(r"vision|kimi-latest|kimi-k3[.]1"), vision=True),
    # DeepSeek 2026-11-23 官方模型表：deepseek-flash（DeepSeek-V4.1-Flash）支持图像理解；
    # deepseek-v4-pro 仅文本。旧名 deepseek-v4-flash / deepseek-v4-flash-vision-exp 已下线，
    # 但请求仍由 V4.1-Flash 承接，因此按支持图像处理。
    # https://api-docs.deepseek.com/quick_start/pricing/
    # https://api-docs.deepseek.com/zh-cn/guides/vision
    _CapabilityRule(
        "api.deepseek.com",
        # 只认官方当前名与两个确切旧名；`deepseek-v4-flash-0731` 这类带版本后缀的旧型号
        # 仍按文本模型处理（旧版 V4-Flash 不支持图像）。
        re.compile(r"deepseek-(?:flash|v4-flash-vision-exp|v4-flash)(?![a-z0-9-])"),
        vision=True,
    ),
    # 显式钉住纯文本型号：以后加宽泛规则时不要把 v4-pro 一起带成 vision。
    _CapabilityRule("api.deepseek.com", re.compile(r"deepseek-v4-pro(?![a-z0-9])")),
    _CapabilityRule("api.deepseek.com", None),
    # Gemini：官方模型表的 Gemini 4 / 3.8 全系模态都含 Image（还有 Audio / Video / PDF）。
    _CapabilityRule("generativelanguage.googleapis.com", None, vision=True),
    # MiniMax M3 / M3.1 官方都标 Multimodal。
    _CapabilityRule("api.minimax", re.compile(r"m3(?![0-9])"), vision=True),
    # 豆包 Seed 2.x 在方舟模型表里标「多模态理解」。
    _CapabilityRule("ark.cn-beijing.volces.com", re.compile(r"doubao-seed-2"), vision=True),
    # TokenHub：Hy4 / Hy4 flash 标「图片理解」，Hy3 没有这一项。
    _CapabilityRule("tencentmaas.com", re.compile(r"hy4(?![0-9])"), vision=True),
    # Step 5 Preview 原生支持文本、图片与视频输入。
    _CapabilityRule("api.stepfun.com", re.compile(r"step-5"), vision=True),
    # Mistral Large 4 官方技术文档：输入模态 Text + Image。
    _CapabilityRule("api.mistral.ai", re.compile(r"mistral-large-4"), vision=True),
    # grok-4.7 官方模型卡：Modalities = Text and image input; text output。
    _CapabilityRule("api.x.ai", re.compile(r"grok-4[.]7"), vision=True),
    # 文心 5.x 是原生全模态统一建模（5.0 起支持文本、图像、音频、视频理解）。
    _CapabilityRule("qianfan.baidubce.com", re.compile(r"ernie-5"), vision=True),
    _CapabilityRule("api.moonshot", None),
    _CapabilityRule("open.bigmodel.cn", None),
    _CapabilityRule("dashscope.aliyuncs.com", None),
    _CapabilityRule("api.openai.com", None),
    _CapabilityRule("openrouter.ai", None),
    # 本机端点（Ollama / vLLM / LM Studio 等）：多数模型支持 tools，个别不支持时
    # 由既有 400 降级兜底。Qwen3.5 开源权重带视觉（预设默认就是它）；其余型号按文本处理，
    # 避免把图发给用户随手 `ollama pull` 的纯文本模型。
    _CapabilityRule("localhost", re.compile(r"qwen3[.]5"), vision=True),
    _CapabilityRule("localhost", None),
    _CapabilityRule("127.0.0.1", re.compile(r"qwen3[.]5"), vision=True),
    _CapabilityRule("127.0.0.1", None),
)


def _match_rule(config: LLMConfig) -> _CapabilityRule | None:
    host = host_of(config.base_url)
    model = str(config.model or "").strip().casefold()
    for rule in _TABLE:
        if rule.host not in host:
            continue
        if rule.model_pattern is not None and not rule.model_pattern.search(model):
            continue
        return rule
    return None


def resolve_capabilities(config: LLMConfig) -> ProviderCapabilities:
    """解析端点能力声明（纯查询：不触碰任何请求构造路径）。"""
    rule = _match_rule(config)
    return ProviderCapabilities(
        # unknown 默认 True：见 _TABLE 注释（已有 400 降级兜底）。
        tools=rule.tools if rule is not None else True,
        # 现状没有任何调用发送 response_format（§2.6）：False 是现状的如实描述。
        structured_output=False,
        # 两家 provider 的实现本身依赖 SSE 解析（事实描述，不是承诺）。
        stream=True,
        # 图像输入：只有能力表显式声明的型号才算支持（默认 False，见 _CapabilityRule）。
        vision=rule.vision if rule is not None else False,
        # 委托现有权威实现（能力表 + 实测探测），不另立第二张思考表。
        reasoning=thinking_support(config).supported,
        # 现状没有任何调用路径使用 embedding（RAG v2 只落了 provider 能力）：False 是现状。
        embeddings=rule.embeddings if rule is not None else False,
    )


__all__ = ["ProviderCapabilities", "resolve_capabilities"]

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
    _CapabilityRule("api.openai.com", re.compile(r"gpt-4o|gpt-4\.1|gpt-5|o3|o4"), vision=True),
    # OpenRouter 是聚合网关：具体型号千差万别，但走这条端点的用户本来就是挑过模型的。
    _CapabilityRule("openrouter.ai", None, vision=True),
    _CapabilityRule("dashscope.aliyuncs.com", re.compile(r"qwen.*vl|qvq"), vision=True),
    _CapabilityRule("open.bigmodel.cn", re.compile(r"glm-4\.?\d*v|glm-4v"), vision=True),
    _CapabilityRule("api.moonshot", re.compile(r"vision|kimi-latest"), vision=True),
    _CapabilityRule("api.deepseek.com", None),
    _CapabilityRule("api.moonshot", None),
    _CapabilityRule("open.bigmodel.cn", None),
    _CapabilityRule("dashscope.aliyuncs.com", None),
    _CapabilityRule("api.openai.com", None),
    _CapabilityRule("openrouter.ai", None),
    # 本机端点（Ollama / vLLM / LM Studio 等）：多数模型支持 tools，个别不支持时
    # 由既有 400 降级兜底。
    _CapabilityRule("localhost", None),
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

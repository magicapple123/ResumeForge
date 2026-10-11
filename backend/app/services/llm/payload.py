"""OpenAI 兼容协议的**静态规则**：请求体构造、Base URL 校验、状态码文案、参数拒绝判定。

（RF-14 拆分接缝：从 ``openai_compat.py`` 下沉——那边保留协议编排（HTTP 调用、
SSE 帧解析、重试接线、用量接线），协议的静态规则集中在这里。行为零变化：默认
配置下请求体与拆分前逐字节一致（快照守卫见 ``test_llm_capabilities``）。

``validated_base_url`` / ``models_endpoint`` / ``http_error_message`` 是与"获取
可用模型"接口（``model_catalog``）与 SearXNG 校验共用的同一套规则；
openai_compat 按原路径再导出，既有导入方零改动。
"""
from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlsplit

from ...config import get_settings
from ...schemas.setting import LLMConfig
from .base import LLMError
from .thinking import thinking_payload

# HTTP 状态码 -> 面向用户的中文提示
_STATUS_MESSAGES = {
    400: "请求格式错误，请检查模型名称与参数设置",
    401: "API Key 无效或已过期，请到「设置」页检查",
    403: "无权限访问该模型，请检查账号权限",
    404: "模型不存在或接口地址错误，请检查 Base URL 与模型名称",
    429: "请求过于频繁或额度不足，请稍后重试",
    500: "模型服务内部错误，请稍后重试",
    502: "模型服务暂不可用，请稍后重试",
    503: "模型服务过载，请稍后重试",
}


def http_error_message(status: int) -> str:
    """HTTP 状态码对应的中文提示（provider 与模型列表接口共用）。"""
    return _STATUS_MESSAGES.get(status, "模型调用失败")


def status_error(status: int) -> LLMError:
    """状态码 → LLMError。与 provider 的 ``_http_error`` 文案完全一致，可在没有响应对象时构造。"""
    return LLMError(f"{http_error_message(status)}（HTTP {status}）")


def looks_like_rejected_parameter(error: LLMError) -> bool:
    """判断这次失败是否像"服务商不认某个可选参数"（tools 或思考参数）。

    ``_http_error`` 刻意不把上游正文带进错误消息（可能回显敏感资料），所以这里
    只能依据状态码。400 也可能是别的原因，但去掉该参数再试一次是无害的——
    失败的话第二次错误会照常抛出去。
    """
    return "（HTTP 400）" in str(error)

# 请求级覆盖参数白名单：model / messages / stream 这些关键字段永远不允许被覆盖，
# 否则一个前端参数就能改写整次调用的语义。
_OVERRIDABLE_KEYS = frozenset(
    {
        "reasoning_effort",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "temperature",
        "max_tokens",
    }
)


def is_loopback_host(hostname: str) -> bool:
    """HTTP 只允许本机地址；这里同时供 Base URL 校验与模型列表接口复用。"""
    normalized = hostname.rstrip(".").casefold()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ip_address(normalized).is_loopback
    except ValueError:
        return False


def validated_base_url(value: str) -> str:
    """校验并返回可用的服务根地址。

    远程地址必须 HTTPS，HTTP 只允许本机回环；地址不能包含账号、密码、查询参数或
    片段。provider 与"获取可用模型"接口共用同一套规则，避免两处判断漂移。
    """
    cleaned = (value or "").strip().rstrip("/")
    if not cleaned:
        raise LLMError("请先填写有效的 Base URL")
    try:
        parsed = urlsplit(cleaned)
        hostname = parsed.hostname
    except ValueError as exc:
        raise LLMError("Base URL 格式无效") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not hostname:
        raise LLMError("Base URL 只支持 HTTP 或 HTTPS 地址")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise LLMError("Base URL 不能包含账号、密码、查询参数或片段")
    if parsed.scheme.lower() == "http" and not is_loopback_host(hostname):
        raise LLMError("远程模型服务必须使用 HTTPS；HTTP 仅允许本机地址")
    return cleaned


def models_endpoint(base_url: str) -> str:
    """由 Base URL 推导模型列表地址。

    兼容用户填 ``https://api.x.com``、``https://api.x.com/v1`` 或完整
    ``.../chat/completions`` 三种情况。
    """
    base = validated_base_url(base_url)
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    return f"{base}/models"


def build_payload(
    config: LLMConfig,
    request_overrides: dict,
    messages: list[dict],
    stream: bool,
    tools: list[dict] | None = None,
    *,
    thinking: bool = True,
) -> dict:
    """构造 OpenAI 兼容 Chat Completions 请求体（``OpenAICompatProvider._build_payload`` 的实现）。"""
    payload = {
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "stream": stream,
    }
    # 不限制输出时省略该字段，由服务商/模型决定上限；发送 0 或 -1 在部分
    # 服务商上会被当作非法参数拒绝。注意这不是"真的无限"，有些服务商的
    # 默认值可能小于用户此前手动设置的值。
    if not config.uses_unlimited_output:
        payload["max_tokens"] = config.max_tokens
    _apply_advanced_parameters(config, payload, thinking=thinking)
    _apply_request_overrides(request_overrides, payload, thinking=thinking)
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    # stream_options.include_usage（RF-14 §2.2）：只有服务器配置显式开启才发送。
    # 该字段会改变默认请求体，默认路径必须与未加此功能前逐字节一致——与思考参数
    # 同一条纪律。读取的是服务商**自带** usage 帧的场景不受此开关影响。
    if stream and get_settings().llm_stream_include_usage:
        payload["stream_options"] = {"include_usage": True}
    return payload


def _apply_advanced_parameters(config: LLMConfig, payload: dict, *, thinking: bool = True) -> None:
    """发送用户在「高级调整」里显式开启的参数；未开启（None）就不发送。"""
    for key in (
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "top_k",
        "repetition_penalty",
    ):
        value = getattr(config, key, None)
        if value is not None:
            payload[key] = value
    stop = getattr(config, "stop", None)
    if stop:
        payload["stop"] = list(stop)
    # 思考参数。`thinking=False` 只在"上游拒绝了它们、降级重试一次"时出现（见
    # `stream_chat_events`），那时两类参数要一起去掉。
    #
    # 两类参数的优先级：显式填过「思考预算」的以它为准（老用户的既有行为不能被新的
    # 开关改写）；否则按「思考模式」开关与形态生成。**关着时一个字都不加**——默认
    # 路径的请求体必须与加这个功能之前逐字节一致。
    thinking_budget = getattr(config, "thinking_budget", None)
    if thinking:
        if thinking_budget is not None:
            payload["thinking"] = (
                {"type": "enabled", "budget_tokens": thinking_budget}
                if thinking_budget > 0
                else {"type": "disabled"}
            )
        else:
            for key, value in thinking_payload(config).items():
                payload.setdefault(key, value)
    # 额外请求体：长尾参数的出口。保留键已在校验层拦掉，这里原样合并。
    extra = getattr(config, "extra_body", None)
    if isinstance(extra, dict):
        for key, value in extra.items():
            payload.setdefault(key, value)


def _apply_request_overrides(
    request_overrides: dict, payload: dict, *, thinking: bool = True
) -> None:
    """合并单次请求的覆盖参数（白名单 + 非空值）。

    ``thinking=False`` 时连 ``reasoning_effort`` 一起跳过：降级重试要的是**真的不带
    思考参数**，而助手那条路的强度只在请求级里，漏掉它重试就会以同样的 400 再失败一次。
    """
    for key, value in request_overrides.items():
        if key == "reasoning_effort" and not thinking:
            continue
        if key in _OVERRIDABLE_KEYS and value not in (None, ""):
            payload[key] = value

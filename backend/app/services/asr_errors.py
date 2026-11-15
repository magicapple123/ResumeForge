# SPDX-License-Identifier: Apache-2.0
"""转写链路的**错误分类**（三套协议共用一份实现）。

为什么下沉成独立文件：协议已经有三个（``openai`` / ``dashscope`` / ``deepseek``），
如果每个 provider 文件各写一遍"401 说什么、404 说什么、400 要不要带上游原话"，
用户就会看到同一类失败在不同协议下给不同提示——而这类漂移极难被测试发现
（每一套单独看都"有提示"）。

``asr_client`` 从这里 import 并原样 re-export，所以既有
``from ..services.asr_client import AsrError`` 的调用点一个都不用改。
"""

from __future__ import annotations

import re

import httpx

# 上游错误消息的截断长度与脱敏规则：把 400 的原文给用户看是排查的唯一入口，
# 但整段 HTML / 超长 JSON 会撑爆前端 Alert，且可能带出 Key 片段。
UPSTREAM_DETAIL_MAX = 300
_SECRET_LIKE = re.compile(r"(sk-[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._\-]{6,})")


class AsrError(RuntimeError):
    """上游转写失败；``kind`` 决定 API 层翻成哪个 HTTP 状态与哪句中文。

    kind 取值：auth（401/403）、not_found（404）、too_large（413）、timeout、
    empty（200 但没有文本）、network（连不上）、bad_request（400，带上游原文）、
    upstream（其它非 2xx / 响应不是 JSON）。
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def sanitize_upstream_text(text: str) -> str:
    """压平空白 + 抹掉像密钥的片段 + 截断：只保留可读的排查信息。"""
    flattened = " ".join((text or "").split())
    return _SECRET_LIKE.sub("***", flattened)[:UPSTREAM_DETAIL_MAX]


def upstream_detail(response: httpx.Response) -> str:
    """取上游 ``error.message``（也兼容 ``message`` / ``detail`` 与错误体是纯文本）。

    400 是唯一一类"用户必须看到上游原话"的失败：地址对了、模型名打错、音频被判无效，
    都只能从上游那句里看出来。取不到就退回空串，调用方用自己的兜底文案。
    """
    try:
        payload = response.json()
    except ValueError:
        return sanitize_upstream_text(response.text or "")
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "")
    elif isinstance(error, str):
        message = error
    else:
        message = ""
    if not message:
        message = str(payload.get("message") or payload.get("detail") or "")
    return sanitize_upstream_text(message)


def raise_for_status(response: httpx.Response) -> None:
    """把非 2xx 翻成带 ``kind`` 的 :class:`AsrError`（三套协议共用）。"""
    status = response.status_code
    if status in (401, 403):
        raise AsrError("auth", "语音服务鉴权失败（401），请检查设置 → 语音转写里的 Key 是否正确")
    if status == 404:
        raise AsrError(
            "not_found", "语音服务地址不存在（404），请检查地址是否包含服务商要求的路径前缀"
        )
    if status == 413:
        raise AsrError("too_large", "语音服务拒绝了这个音频（413），单段录音请控制在 3 分钟内")
    if status == 400:
        detail = upstream_detail(response)
        suffix = f"：{detail}" if detail else ""
        raise AsrError("bad_request", f"语音服务拒绝了这次请求（HTTP 400）{suffix}")
    if status >= 400:
        detail = upstream_detail(response)
        suffix = f"（{detail}）" if detail else ""
        raise AsrError("upstream", f"语音服务返回异常（HTTP {status}）{suffix}，请稍后重试")


__all__ = [
    "AsrError",
    "UPSTREAM_DETAIL_MAX",
    "raise_for_status",
    "sanitize_upstream_text",
    "upstream_detail",
]

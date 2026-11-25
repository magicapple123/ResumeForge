# SPDX-License-Identifier: Apache-2.0
"""DeepSeek 搜索 Key 的最小校验（CR-04）。

## 为什么打 ``/v1/models`` 而不是搜索接口

校验要回答的是"这把 Key 能不能用"，不是"搜索好不好用"。``GET /v1/models`` 是
OpenAI 兼容层的**零计费**端点，用同一把 Key 做鉴权；而 ``/v1/tools/search`` 每次成功
请求都计费（约 ¥0.005）。点一次「测试」就产生一次搜索账单，是用户没同意过的花费。

## 边界

- **只打 DeepSeek 的固定地址**：不接受调用方传 base_url（那会把后端变成任意 GET 代理）；
- **不跟随重定向**：跟随会把带 ``Authorization`` 的请求原样转给 ``Location`` 指向的主机；
- 失败一律返回结构化结果，不抛 5xx、不把 Key 写进日志。
"""

from __future__ import annotations

import logging
import time

import httpx

from ...schemas.search_key_test import SearchKeyTestResult
from .. import net_proxy

logger = logging.getLogger(__name__)

#: 唯一的校验地址。测试按整串断言，改地址必须同步改用例（这是安全边界，不是实现细节）。
DEEPSEEK_MODELS_URL = "https://api.deepseek.com/v1/models"

_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)

_MESSAGES: dict[str, str] = {
    "unauthorized": "Key 无效或无权限。到「设置 → 联网搜索 → DeepSeek」重新填一把。",
    "insufficient_balance": "这个 DeepSeek 账户余额不足（402），充值后即可使用。",
    "rate_limited": "请求过于频繁（429），稍等一会儿再测。",
    "network": "连不上 DeepSeek，或请求超时。检查网络/代理后再试。",
    "parse": "DeepSeek 返回了无法解析的响应，可能是网络中间层拦截。",
}


def _failed(reason: str, latency_ms: int | None = None, message: str = "") -> SearchKeyTestResult:
    return SearchKeyTestResult(
        ok=False,
        reason=reason,  # type: ignore[arg-type]  # 调用方只传 _MESSAGES 的键
        latency_ms=latency_ms,
        message=message or _MESSAGES.get(reason, "校验失败，请稍后重试"),
    )


def _reason_for_status(status: int) -> str:
    if status in {401, 403}:
        return "unauthorized"
    if status == 402:
        return "insufficient_balance"
    if status == 429:
        return "rate_limited"
    if 300 <= status < 400:
        # 未跟随的重定向：要么服务商换了域名，要么中间层在劫持带凭据的请求。
        return "network"
    return "network"


async def probe_deepseek_search_key(
    api_key: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SearchKeyTestResult:
    """发一次 ``GET /v1/models``，把结果收敛成 ``SearchKeyTestResult``。

    ``transport`` 只给测试注入确定性响应；生产路径走 ``net_proxy`` 的统一出网配置。
    """
    key = str(api_key or "").strip()
    if not key:
        return _failed("unauthorized", message="没有可测试的 Key。")
    started = time.perf_counter()
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    try:
        async with net_proxy.build_async_client(
            url=DEEPSEEK_MODELS_URL,
            transport=transport,
            timeout=_TIMEOUT,
            follow_redirects=False,
        ) as client:
            response = await client.get(DEEPSEEK_MODELS_URL, headers=headers)
    except (httpx.TimeoutException, TimeoutError):
        logger.info("搜索 Key 校验超时")
        return _failed("network", message="请求超时。检查网络/代理后再试。")
    except httpx.RequestError as exc:
        # 只记异常类型：异常文本里可能带 URL，但不含请求头。
        logger.info("搜索 Key 校验无法连接：%s", type(exc).__name__)
        return _failed("network")
    latency_ms = int((time.perf_counter() - started) * 1000)
    if 200 <= response.status_code < 300:
        try:
            response.json()
        except ValueError:
            logger.info("搜索 Key 校验响应不是 JSON：status=%s", response.status_code)
            return _failed("parse", latency_ms)
        return SearchKeyTestResult(
            ok=True, latency_ms=latency_ms, message=f"Key 可用（{latency_ms} ms）"
        )
    reason = _reason_for_status(response.status_code)
    logger.info("搜索 Key 校验失败：status=%s reason=%s", response.status_code, reason)
    return _failed(reason, latency_ms)


__all__ = ["DEEPSEEK_MODELS_URL", "probe_deepseek_search_key"]

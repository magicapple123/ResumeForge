# SPDX-License-Identifier: Apache-2.0
"""browser 引擎：复用投递浏览器（BrowserManager，默认端口 9333）渲染 SPA。

为什么需要它：校招站/招聘平台列表页大量是前端渲染，httpx 只能拿到一个空壳
（<div id="root"></div>）。#16A 的口径是「http 拿到正文 <800 字符且带 SPA 标记 →
自动升级到浏览器」，以及用户可强制指定浏览器引擎。

实现要点：

- Page.navigate 后**等页面真的可用**（复用 browser.page_ready 的轮询原语），
  而不是拿 readyState 当「渲染完成」；
- 正文取 document.body.innerText；
- 同时订阅 Network.responseReceived，把 XHR/fetch 的 JSON 响应体取回——规则层
  优先吃 JSON，比解析 DOM 稳；
- 重定向安全：浏览器内部的重定向不经过我们这个进程，所以导航**后**再校验
  location.href，最终落在内网/本机地址时拒绝返回内容（并在证据里记录这条边界）。

测试注入 manager_factory 与假的 CDP 客户端，不启动真实浏览器。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from .errors import WebFetchError
from .url_policy import resolve_and_check

logger = logging.getLogger(__name__)

#: 等到页面可用的整体预算（秒）。首屏 XHR 渲染可能比文档 readyState=complete 晚。
PAGE_READY_TIMEOUT_SECONDS = 20.0
#: 单条 CDP 命令超时（秒）。
CDP_TIMEOUT_SECONDS = 20.0
#: 最多取回多少条 JSON 响应体（防止把整个页面的接口响应都读回来）。
MAX_JSON_RESPONSES = 8
#: 正文上限：与 MAX_JOB_TEXT_CHARS 同一量级，避免异常页面撑爆内存。
MAX_INNER_TEXT_CHARS = 200_000
#: 渲染后的 HTML 上限（规则层要用容器/锚点结构做抽取）。
MAX_RENDERED_HTML_CHARS = 600_000
#: 页面「可用」之后再静置多久（秒）等首屏 XHR 渲染完。
#: 真实校招站实测：首屏导航文本出现时岗位列表还没渲染，约 2s 后才出现（2026-11-12）。
PAGE_SETTLE_SECONDS = 2.0
_NETWORK_RESPONSE_EVENT = "Network.responseReceived"
_READY_PROBE_JS = (
    "(() => { const body = document.body; "
    "const text = body && body.innerText ? body.innerText : ''; "
    "return { readyState: document.readyState, textLength: text.length, "
    "linkCount: document.querySelectorAll('a[href]').length }; })()"
)
_INNER_TEXT_JS = "document.body ? document.body.innerText : ''"
# 只取 body：整页 outerHTML 的 <head> 常带数百 KB 内联样式，先截断会把正文/岗位链接切掉。
_RENDERED_HTML_JS = "document.body ? document.body.outerHTML : ''"
_FINAL_URL_JS = "location.href"


@dataclass(frozen=True)
class BrowserPage:
    """browser 引擎的原始产出。"""

    url: str
    status_code: int
    content_type: str
    text: str
    json_payloads: list[Any] = field(default_factory=list)
    #: 渲染后的 DOM HTML（供规则层找重复容器/详情链接）；可能为空。
    html: str = ""
    engine: str = "browser"


def _ready(state: dict[str, Any]) -> bool:
    if state.get("readyState") not in {"interactive", "complete"}:
        return False
    return int(state.get("textLength") or 0) > 0 or int(state.get("linkCount") or 0) > 0


def _timeout_error(_state: dict[str, Any]) -> WebFetchError:
    return WebFetchError("浏览器打开页面超时，页面可能太慢或要求登录")


def _json_payloads(client: Any, events: list[dict[str, Any]]) -> list[Any]:
    """从 Network.responseReceived 事件里取回 JSON 响应体。"""
    from ..browser.network_capture import MAX_BODY_BYTES, collect_bodies

    body_events: list[dict[str, Any]] = []
    for event in events:
        if event.get("method") != _NETWORK_RESPONSE_EVENT:
            continue
        raw_params = event.get("params")
        params: dict[str, Any] = raw_params if isinstance(raw_params, dict) else {}
        raw_response = params.get("response")
        response: dict[str, Any] = raw_response if isinstance(raw_response, dict) else {}
        mime = str(response.get("mimeType") or "")
        request_id = str(params.get("requestId") or "")
        if not request_id or "json" not in mime:
            continue
        try:
            result = client.send("Network.getResponseBody", {"requestId": request_id})
        except Exception:  # noqa: BLE001 - 响应体可能已被回收，跳过即可
            logger.debug("取浏览器网络响应体失败：%s", response.get("url") or request_id)
            continue
        if isinstance(result, dict) and int(result.get("bodyLength") or 0) > MAX_BODY_BYTES:
            continue
        body_events.append(
            {"method": "Network.getResponseBody", "requestId": request_id, "result": result}
        )
        if len(body_events) >= MAX_JSON_RESPONSES:
            break
    captured = collect_bodies([*events, *body_events], limit=MAX_JSON_RESPONSES)
    return [item.body for item in captured]


def fetch_with_browser(
    db: Any,
    url: str,
    *,
    manager_factory: Any = None,
    ready_timeout: float = PAGE_READY_TIMEOUT_SECONDS,
    settle_seconds: float = PAGE_SETTLE_SECONDS,
) -> BrowserPage:
    """用投递专用浏览器打开 url，返回正文与页面发出的 JSON 响应。

    浏览器没启动时按需启动（与投递台共用同一个浏览器实例，复用登录态）。
    """
    from ..browser.cdp_client.base import CdpError
    from ..browser.page_ready import ReadyWait, wait_for_page_state

    target = resolve_and_check(url)
    factory = manager_factory
    if factory is None:
        from ..apply import get_browser_manager

        factory = get_browser_manager
    manager = factory(db)
    client = None
    try:
        if not manager.is_active():
            manager.start()
        client = manager.client()
        client.start_event_capture([_NETWORK_RESPONSE_EVENT])
        result = client.navigate(target, timeout=CDP_TIMEOUT_SECONDS)
        if isinstance(result, dict) and result.get("errorText"):
            raise WebFetchError("浏览器打不开这个页面（地址可能失效或被站点拦截）")
        wait_for_page_state(
            lambda: client.evaluate(_READY_PROBE_JS, timeout=CDP_TIMEOUT_SECONDS),
            is_ready=_ready,
            on_timeout=_timeout_error,
            config=ReadyWait(timeout=ready_timeout),
        )
        # 首屏 XHR 常在「页面可用」之后才把列表渲染出来：短暂静置再取正文/HTML。
        if settle_seconds > 0:
            time.sleep(settle_seconds)
        final_url = str(client.evaluate(_FINAL_URL_JS, timeout=CDP_TIMEOUT_SECONDS) or target)
        # 浏览器内部的重定向不经过本进程：落地后必须重新校验一次。
        try:
            resolve_and_check(final_url)
        except ValueError as exc:
            raise WebFetchError("这个页面跳转到了不允许访问的地址，已停止读取") from exc
        text = str(client.evaluate(_INNER_TEXT_JS, timeout=CDP_TIMEOUT_SECONDS) or "")
        rendered_html = str(client.evaluate(_RENDERED_HTML_JS, timeout=CDP_TIMEOUT_SECONDS) or "")
        events = client.drain_events()
        payloads = _json_payloads(client, events)
        return BrowserPage(
            url=final_url,
            status_code=200,
            content_type="text/html",
            text=text[:MAX_INNER_TEXT_CHARS],
            json_payloads=payloads,
            html=rendered_html[:MAX_RENDERED_HTML_CHARS],
        )
    except WebFetchError:
        raise
    except CdpError as exc:
        raise WebFetchError("浏览器抓取失败，请确认投递浏览器仍在运行") from exc
    except Exception as exc:  # noqa: BLE001 - 统一收敛成可展示原因
        raise WebFetchError("浏览器抓取失败，请稍后重试") from exc
    finally:
        if client is not None:
            try:
                client.stop_event_capture()
            except Exception:  # noqa: BLE001 - 清理失败不影响结果
                logger.debug("停止浏览器事件订阅失败", exc_info=True)
            try:
                client.close()
            except Exception:  # noqa: BLE001
                logger.debug("关闭浏览器客户端失败", exc_info=True)


__all__ = [
    "BrowserPage",
    "MAX_INNER_TEXT_CHARS",
    "MAX_JSON_RESPONSES",
    "MAX_RENDERED_HTML_CHARS",
    "PAGE_READY_TIMEOUT_SECONDS",
    "PAGE_SETTLE_SECONDS",
    "fetch_with_browser",
]

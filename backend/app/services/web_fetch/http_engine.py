# SPDX-License-Identifier: Apache-2.0
"""http 引擎：用 httpx 直接取静态页 / JSON 接口。

设计约束（#16A）：

- 5s 超时、响应上限 3MB、只接受 text/html 与 application/json；
- UA 标识应用名（不伪装浏览器）；
- **手动跟重定向**，每一跳都重新做 SSRF 校验——只查首个 URL 会被
  「公网 URL 302 到内网」绕过。

测试通过注入 httpx.BaseTransport 完全离线跑，不访问外网。
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin

import httpx

from ...config import get_settings
from .errors import WebFetchError
from .url_policy import resolve_and_check

#: 单次响应上限：3MB。整页 HTML 通常 100–500KB，3MB 足够覆盖大列表页。
MAX_RESPONSE_BYTES = 3 * 1024 * 1024
#: 单次请求超时（秒）。超时比"等很久"更重要：批量抓取时不能一条拖死整批。
DEFAULT_TIMEOUT_SECONDS = 5.0
#: 最多跟随的重定向次数。
MAX_REDIRECTS = 5
#: 接受的 Content-Type 前缀。
ACCEPTED_CONTENT_TYPES = ("text/html", "application/json")
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class _TooLarge(WebFetchError):
    """响应超过上限（内部信号，统一在 fetch_http 里转成用户文案）。"""


def user_agent() -> str:
    """标识应用名的 UA（不伪装成浏览器：站点反爬拒绝时如实报错，不硬闯）。"""
    return (
        f"ResumeForge/{get_settings().app_version} "
        "(job link import; +https://github.com/magicapple123/ResumeForge)"
    )


@dataclass(frozen=True)
class RawHttpPage:
    """http 引擎的原始产出。"""

    url: str
    status_code: int
    content_type: str
    text: str
    engine: str = "http"


def _base_content_type(raw: str) -> str:
    return (raw or "").split(";", 1)[0].strip().lower()


def _accepted(content_type: str) -> bool:
    return any(content_type.startswith(prefix) for prefix in ACCEPTED_CONTENT_TYPES)


def _decode(body: bytes, content_type_header: str) -> str:
    """按 charset 解码；没有声明就按 UTF-8（失败字符替换，不抛异常）。"""
    charset = ""
    for part in (content_type_header or "").split(";")[1:]:
        key, _, value = part.strip().partition("=")
        if key.lower() == "charset":
            charset = value.strip().strip('"').lower()
    for candidate in (charset, "utf-8", "gb18030"):
        if not candidate:
            continue
        try:
            return body.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("utf-8", errors="replace")


def _read_capped(response: httpx.Response, *, max_bytes: int) -> bytes:
    total = 0
    chunks: list[bytes] = []
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise _TooLarge(f"页面超过 {max_bytes // (1024 * 1024)}MB 上限，已停止抓取")
        chunks.append(chunk)
    return b"".join(chunks)


def fetch_http(
    url: str,
    *,
    transport: httpx.BaseTransport | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = MAX_RESPONSE_BYTES,
    resolver=None,
) -> RawHttpPage:
    """抓取一个 http/https 地址；返回页面正文或 JSON 原文。

    重定向逐跳校验（resolve_and_check 每次都会重新解析域名并检查 IP）。
    """
    current = resolve_and_check(url, resolver=resolver)
    headers = {
        "User-Agent": user_agent(),
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.1",
    }
    try:
        client = httpx.Client(
            follow_redirects=False,
            timeout=timeout,
            transport=transport,
            headers=headers,
            trust_env=False,
        )
    except TypeError as exc:  # pragma: no cover - 仅在 httpx 版本变化时发生
        raise WebFetchError("抓取引擎初始化失败") from exc
    try:
        with client:
            for _ in range(MAX_REDIRECTS + 1):
                try:
                    with client.stream("GET", current) as response:
                        if response.status_code in _REDIRECT_STATUSES:
                            location = response.headers.get("location") or ""
                            if not location:
                                raise WebFetchError("页面发生了无法跟随的跳转")
                            # 每一跳都重新校验：目标可能是内网地址。
                            current = resolve_and_check(
                                urljoin(current, location), resolver=resolver
                            )
                            continue
                        if response.status_code >= 400:
                            raise WebFetchError(f"页面返回 HTTP {response.status_code}，抓不到内容")
                        content_type_header = response.headers.get("content-type", "")
                        content_type = _base_content_type(content_type_header)
                        if not _accepted(content_type):
                            raise WebFetchError("这个链接不是网页或 JSON，暂不支持抓取")
                        body = _read_capped(response, max_bytes=max_bytes)
                        return RawHttpPage(
                            url=str(response.url),
                            status_code=response.status_code,
                            content_type=content_type,
                            text=_decode(body, content_type_header),
                        )
                except httpx.TimeoutException as exc:
                    raise WebFetchError("抓取超时（5 秒），页面可能太慢或需要登录") from exc
                except httpx.HTTPError as exc:
                    raise WebFetchError("网络请求失败，抓不到这个页面") from exc
            raise WebFetchError("页面重定向次数过多，已停止抓取")
    finally:
        client.close()


__all__ = [
    "ACCEPTED_CONTENT_TYPES",
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_REDIRECTS",
    "MAX_RESPONSE_BYTES",
    "RawHttpPage",
    "fetch_http",
    "user_agent",
]

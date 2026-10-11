"""受限的网页正文读取。

助手要"上网收集信息"，只有搜索摘要不够——很多招聘页/技术博客的摘要几乎为空。这里
把前几条结果页的正文取回来，作为**不可信资料**附在搜索上下文里。

安全边界（这是本模块存在的理由，RF-04 强化）：
- 只允许 http/https，且**拒绝解析到内网/回环/保留地址的主机**（本地应用不该被当成
  打内网的跳板）；
- 重定向**不自动跟随**：手动逐跳处理（上限 ``_MAX_REDIRECTS``），**每一跳**都重新
  过同一套公网校验（:func:`_policy_reason` 是唯一实现）——公网结果页 302 到内网时，
  在发出第二个请求之前就拒绝；
- DNS 解析（``getaddrinfo`` 是同步阻塞调用）在异步路径上放进工作线程执行，不卡事件循环；
- 限制响应体大小、单跳超时与**整次抓取的总墙钟预算**（``_TOTAL_BUDGET_SECONDS``，
  覆盖所有跳），只取文本类内容；
- 只抽取正文标签的可见文字，不执行任何脚本。
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from collections.abc import Callable
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

MAX_PAGE_BYTES = 1_500_000
MAX_TEXT_CHARS = 2_500
_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
# 整次抓取（含全部重定向跳）的墙钟上限。**注入点**：测试里 monkeypatch 成毫秒级，
# 成功路径的用例不需要动它（它只是安全网，就绪即返回）。
_TOTAL_BUDGET_SECONDS = 10.0
# 手动重定向上限：初始请求 + 至多 3 次跟随。真实结果页极少超过 2 跳。
_MAX_REDIRECTS = 3
# scheme 与端口白名单。端口只放行标准 Web 端口：公网页面几乎不用别的端口，而内网
# 服务（数据库、元数据服务、本地模型端口）恰恰集中在非标准端口上。
_ALLOWED_SCHEMES = frozenset({"http", "https"})
_ALLOWED_PORTS = frozenset({None, 80, 443})
_HEADERS = {
    "User-Agent": "ResumeForge/0.8 (+local career assistant; page summary)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
# 这些标签里的文字不是正文。
_SKIPPED_TAGS = frozenset({"script", "style", "nav", "header", "footer", "aside", "form", "svg"})
_TEXT_TAGS = frozenset({"p", "li", "h1", "h2", "h3", "h4", "blockquote", "td", "dd", "pre"})


class PageFetchBlocked(Exception):
    """URL 或重定向目标未通过公网校验；``str(exc)`` 是面向日志的可读原因。"""


class _ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._depth = 0
        self._capture = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_TAGS:
            self._depth += 1
        elif tag in _TEXT_TAGS and self._depth == 0:
            self._capture = True
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        """HTMLParser 回调：正文容器结束时把缓冲文本拼成一段（太短当作导航丢弃）。"""
        if tag in _SKIPPED_TAGS and self._depth > 0:
            self._depth -= 1
        elif tag in _TEXT_TAGS and self._capture:
            self._capture = False
            text = " ".join("".join(self._buffer).split())
            if len(text) >= 20:  # 太短的片段多半是导航或标签
                self.parts.append(text)
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capture and self._depth == 0:
            self._buffer.append(data)


def _sync_resolve(host: str) -> set[str]:
    """DNS 解析（同步）。失败返回空集，由策略层据此拒绝而不是抛出。"""
    try:
        return {item[4][0] for item in socket.getaddrinfo(host, None)}
    except (socket.gaierror, OSError):
        return set()


def _policy_reason(url: str, resolve: Callable[[str], set[str]]) -> str | None:
    """URL 公网策略的**唯一实现**：放行返回 None，否则给出可读的拒绝原因。

    scheme、用户信息、主机名、端口、DNS 解析出的**每一个** IP 都检查；首跳与重定向
    的每一跳都走这一份（RF-04：一处逻辑一份实现，不存在"只有首跳查得严"的第二套）。
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "URL 无法解析"
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        return f"scheme 不是 http/https（{parsed.scheme or '空'}）"
    if not parsed.hostname:
        return "缺少主机名"
    if parsed.username or parsed.password:
        return "URL 中携带了 user:pass@"
    try:
        port = parsed.port
    except ValueError:
        return "端口无法解析"
    if port not in _ALLOWED_PORTS:
        return f"非标准 Web 端口 {port}"
    host = parsed.hostname.casefold()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        return f"本地主机名 {host}"
    addresses = resolve(host)
    if not addresses:
        return f"主机 {host} 解析不到任何地址"
    for address in addresses:
        try:
            parsed_ip = ipaddress.ip_address(address)
        except ValueError:
            return f"解析结果 {address!r} 不是合法 IP"
        # 解析到内网/回环/保留地址一律拒绝。本机单用户工具不追求抵抗 DNS rebinding
        # （那要"校验地址与连接地址绑定"的传输策略，见架构文档记录的后续项），
        # 但每一跳都重验已挡住"公网页跳内网"与"直接写内网地址"两类。
        if (
            parsed_ip.is_private
            or parsed_ip.is_loopback
            or parsed_ip.is_link_local
            or parsed_ip.is_reserved
            or parsed_ip.is_multicast
        ):
            return f"主机 {host} 解析到非公网地址 {address}"
    return None


def is_public_http_url(url: str) -> bool:
    """只放行指向公网主机的 http/https 地址（同步入口，导出名与调用方不变）。"""
    return _policy_reason(url, _sync_resolve) is None


async def _validated_or_raise(url: str) -> None:
    """异步路径的校验入口：整套校验放进工作线程执行。

    ``getaddrinfo`` 是同步阻塞调用，直接在事件循环里跑会把整个应用卡住（RF-04）。
    放进线程后，测试假 DNS（monkeypatch ``socket.getaddrinfo``）依然生效——属性是
    调用时才在worker线程里解析的。
    """
    reason = await asyncio.to_thread(_policy_reason, url, _sync_resolve)
    if reason is not None:
        raise PageFetchBlocked(f"{url}：{reason}")


def extract_text(html_text: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    """从 HTML 里抽取正文（容错解析，页面再乱也不抛），按字符上限截断。"""
    parser = _ArticleParser()
    try:
        parser.feed(html_text)
        parser.close()
    except Exception:  # noqa: BLE001 - 页面再乱也不该中断整次搜索
        pass
    text = "\n".join(parser.parts)
    return text[:max_chars]


async def _fetch_following_redirects(
    url: str, max_chars: int, transport: httpx.AsyncBaseTransport | None
) -> str:
    """手动跟随重定向：每一跳先过校验再发请求，读满一页正文即返回。"""
    current = url
    async with httpx.AsyncClient(
        timeout=_TIMEOUT, follow_redirects=False, transport=transport
    ) as client:
        # 初始请求 + 至多 _MAX_REDIRECTS 次跟随；循环耗尽即超出跳数上限。
        for _hop in range(_MAX_REDIRECTS + 1):
            await _validated_or_raise(current)
            async with client.stream("GET", current, headers=_HEADERS) as response:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        logger.info("重定向缺少 Location，放弃：%s", current)
                        return ""
                    # 相对 Location 在这里解析成绝对地址，下一跳从循环顶重新校验。
                    current = str(response.url.join(location))
                    continue
                if response.status_code != 200:
                    return ""
                content_type = response.headers.get("content-type", "").casefold()
                if content_type and not any(
                    marker in content_type for marker in ("text/html", "text/plain", "xml")
                ):
                    return ""
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > MAX_PAGE_BYTES:
                        logger.info("响应超过 %d 字节上限，提前截断", MAX_PAGE_BYTES)
                        break
                    body.extend(chunk)
                return extract_text(body.decode("utf-8", errors="replace"), max_chars)
    logger.info("重定向超过 %d 跳上限，放弃：%s", _MAX_REDIRECTS, url)
    return ""


async def fetch_page_text(
    url: str,
    max_chars: int = MAX_TEXT_CHARS,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """读取一页正文；任何失败都返回空串（调用方按"这条没有正文"处理）。

    失败分类只影响日志的可读性，不影响返回值：拒绝（:class:`PageFetchBlocked`）、
    总预算耗尽（``TimeoutError``）、单跳超时与网络错误（httpx 异常）各记各的原因。
    ``transport`` 仅供测试注入 MockTransport，生产调用方不传。
    """
    try:
        async with asyncio.timeout(_TOTAL_BUDGET_SECONDS):
            return await _fetch_following_redirects(url, max_chars, transport)
    except PageFetchBlocked as exc:
        logger.info("拒绝抓取：%s", exc)
        return ""
    except TimeoutError:
        logger.info("正文抓取失败：%.1f 秒总预算耗尽（含重定向）", _TOTAL_BUDGET_SECONDS)
        return ""
    except (httpx.TimeoutException, httpx.RequestError, httpx.HTTPError) as exc:
        logger.info("正文抓取失败：%s", type(exc).__name__)
        return ""


__all__ = [
    "MAX_TEXT_CHARS",
    "PageFetchBlocked",
    "extract_text",
    "fetch_page_text",
    "is_public_http_url",
]

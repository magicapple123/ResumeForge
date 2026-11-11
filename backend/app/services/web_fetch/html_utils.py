# SPDX-License-Identifier: Apache-2.0
"""轻量 HTML 工具：可见文本、内嵌 JSON、列表容器（不引入新依赖）。

仓库没有 bs4/lxml（运行时依赖刻意保持精简），而抓取只需要三件事：

1. 把 HTML 变成「人看到的文字」（跳过 script/style/noscript），用于正文长度判断与模型输入；
2. 取出 SPA 内嵌的数据（__NEXT_DATA__ / window.__NUXT__ / application/ld+json）；
3. 找出「重复的列表容器」——带 job/position/list 类名的块，用于规则层抽取。

这是**尽力而为**的解析：真实站点结构千变万化，规则层命中不了就交给模型层兜底，规则层
本身不追求通用性。
"""

from __future__ import annotations

import html as html_module
import json
import re
from html.parser import HTMLParser

#: 判断 SPA 的标记（命中任一即认为是前端渲染页）。
SPA_MARKERS = ("__next_data__", "__nuxt__", 'id="root"', "id='root'", 'id="app"', "id='app'")
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head"}
_CONTAINER_CLASS_RE = re.compile(
    r"(job|position|career|vacanc|recruit|list-item|list__item|result-item)", re.I
)
_BLOCK_TAGS = {
    "p",
    "div",
    "li",
    "br",
    "tr",
    "section",
    "article",
    "h1",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
}
_LD_JSON_RE = re.compile(
    r'<script[^>]*type=["\']application\/ld\+json["\'][^>]*>(.*?)</script>',
    re.I | re.S,
)
_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.I | re.S
)
_NUXT_RE = re.compile(r"window\.__NUXT__\s*=\s*(\{.*?\})\s*;?\s*</script>", re.I | re.S)


class _TextCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self._parts.append(data)

    @property
    def text(self) -> str:
        raw = "".join(self._parts)
        lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in raw.splitlines()]
        return "\n".join(line for line in lines if line)


def html_to_text(html: str) -> str:
    """把 HTML 转成按行组织的可见文本（跳过脚本/样式）。"""
    if not html:
        return ""
    parser = _TextCollector()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - 坏 HTML 尽力而为，不阻断抓取
        return re.sub(r"<[^>]+>", " ", html)
    return parser.text


def has_spa_marker(html: str) -> bool:
    """HTML 是否带前端渲染标记（用于自动升级到浏览器引擎）。"""
    lowered = (html or "").lower()
    return any(marker in lowered for marker in SPA_MARKERS)


def _loads(raw: str) -> object | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def embedded_json_payloads(html: str) -> list[object]:
    """取出页面内嵌的 JSON（__NEXT_DATA__ / __NUXT__ / JSON-LD）。

    返回顺序：__NEXT_DATA__ → __NUXT__ → JSON-LD。解析失败的那一段安静跳过——
    它们只是「可能更好抽」的候选，不是解析页面的前提。
    """
    payloads: list[object] = []
    for pattern in (_NEXT_DATA_RE, _NUXT_RE):
        match = pattern.search(html or "")
        if match:
            value = _loads(match.group(1))
            if value is not None:
                payloads.append(value)
    for match in _LD_JSON_RE.finditer(html or ""):
        value = _loads(match.group(1))
        if isinstance(value, list):
            payloads.extend(value)
        elif value is not None:
            payloads.append(value)
    return payloads


class _Container:
    __slots__ = ("lines", "anchor_labels")

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.anchor_labels: list[str] = []


class _ContainerParser(HTMLParser):
    """收集「候选列表容器」：带 job/position/list 类名的块，以及块内链接与文字。"""

    _CONTAINER_TAGS = {"div", "li", "article", "section", "tr", "ul", "ol"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.containers: list[_Container] = []
        self.anchors: list[tuple[str, str]] = []
        self._stack: list[tuple[str, int | None]] = []
        self._anchor_text: list[str] | None = None
        self._skip_depth = 0

    def _nearest_container(self) -> int | None:
        for _, container in reversed(self._stack):
            if container is not None:
                return container
        return None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        container: int | None = None
        attr_map = dict(attrs)
        if tag in self._CONTAINER_TAGS:
            haystack = f"{attr_map.get('class') or ''} {attr_map.get('id') or ''}"
            if _CONTAINER_CLASS_RE.search(haystack):
                self.containers.append(_Container())
                container = len(self.containers) - 1
        self._stack.append((tag, container))
        if tag == "a":
            self._anchor_text = []
            self.anchors.append((html_module.unescape(str(attr_map.get("href") or "")), ""))

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag == "a" and self._anchor_text is not None:
            label = re.sub(r"\s+", " ", "".join(self._anchor_text)).strip()
            if self.anchors:
                self.anchors[-1] = (self.anchors[-1][0], label)
            self._anchor_text = None
        while self._stack:
            open_tag, _ = self._stack.pop()
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self._skip_depth or not data.strip():
            return
        text = data.strip()
        if self._anchor_text is not None:
            self._anchor_text.append(text)
        container = self._nearest_container()
        if container is not None:
            self.containers[container].lines.append(text)


def list_containers(html: str) -> tuple[list[list[str]], list[tuple[str, str]]]:
    """解析出候选容器（每项是容器内文字行）与页面链接 (href, 链接文字)。"""
    parser = _ContainerParser()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:  # noqa: BLE001 - 坏 HTML 不阻断，返回已解析部分
        pass
    return [item.lines for item in parser.containers], parser.anchors


__all__ = [
    "SPA_MARKERS",
    "embedded_json_payloads",
    "has_spa_marker",
    "html_to_text",
    "list_containers",
]

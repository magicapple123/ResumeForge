# SPDX-License-Identifier: Apache-2.0
"""搜索结果去重用的 canonical URL（P4-01）。

## 为什么不能只按 (hostname, path) 去重

旧实现的去重键是 ``(hostname, path.rstrip("/"))``：`https://cms.example.com/post?id=1`
与 `https://cms.example.com/post?id=2` 会被判成同一条，**静默丢掉第二条结果**。
同一个 CMS（Discuz、WordPress 的 `?p=`、各类 `?id=`）就是这样被吃掉的。

## 为什么不保留整条 query

反过来把 query 全留下也不行：搜索来源给出来的链接常带 `?utm_source=…&fbclid=…`，
同一篇文章在不同来源里带不同追踪参数，全保留就等于去重失效。所以规则是
**只剥追踪参数，其余原样保留（含顺序归一）**。

判定用**参数名精确匹配**而不是子串包含：`?preference=2`（含 `ref`）、
`?utmost=1`（含 `utm`）都是正常业务参数，不能被误剥；路径里的连字符同理——
`/blog/2025-11-02-post` 一个字符都不动。这两条各有反向断言（见
``tests/test_search_canonical.py``）。
"""

from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit

# 纯追踪/归因参数：**名字精确匹配**（见模块 docstring 的反向断言）。
_TRACKING_PARAMS = frozenset(
    {
        "fbclid",
        "gclid",
        "dclid",
        "yclid",
        "msclkid",
        "twclid",
        "igshid",
        "ref",
        "ref_",
        "referrer",
        "referer",
        "spm",
        "scm",
        "share_token",
        "share_source",
        "trk",
        "trkcampaign",
        "_hsenc",
        "_hsmi",
        "wickedid",
        "oly_anon_id",
        "oly_enc_id",
        "vero_id",
    }
)
# 前缀型追踪参数：`utm_source` / `utm_medium` / `utm_campaign` 以及 HubSpot 的 `hsa_*`。
_TRACKING_PREFIXES = ("utm_", "hsa_", "at_", "pk_")
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _is_tracking(name: str) -> bool:
    lowered = name.strip().casefold()
    if lowered in _TRACKING_PARAMS:
        return True
    return any(lowered.startswith(prefix) for prefix in _TRACKING_PREFIXES)


def canonical_url(url: str) -> str:
    """把一条结果地址归一成"同一条内容只有一种写法"的形态；非法地址返回空串。

    归一项：scheme/host 小写、去掉默认端口、去掉 fragment、去掉末尾 ``/``、
    剥掉追踪参数、剩余参数按名字排序（不同来源的参数顺序不同，不排序就永远对不上）。
    **路径与参数值不做任何解码或改写**：解码会把 `%2F` 和 `/` 混成一条，
    那正是"两条不同文章被判重复"的另一条路。
    """
    value = (url or "").strip()
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    scheme = parsed.scheme.casefold()
    if scheme not in _DEFAULT_PORTS:
        return ""
    host = (parsed.hostname or "").casefold()
    if not host:
        return ""
    if parsed.username or parsed.password:
        return ""

    netloc = host
    try:
        port = parsed.port
    except ValueError:
        return ""
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc = f"{host}:{port}"

    path = parsed.path or ""
    # 末尾斜杠只是风格差异（`/jobs/2` 与 `/jobs/2/`），去掉；根路径归一成空串。
    path = path.rstrip("/")

    kept = [
        (name, value)
        for name, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not _is_tracking(name)
    ]
    kept.sort(key=lambda pair: (pair[0], pair[1]))
    query = urlencode(kept)

    return f"{scheme}://{netloc}{path}" + (f"?{query}" if query else "")


def dedupe_by_url(results: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    """按 :func:`canonical_url` 去重，保留首次出现的那条（来源交错顺序即相关性线索）。

    取不到 canonical（非法/非 http(s)）的条目按**原串**去重，不整条丢弃：
    丢了会让"某个来源给了一条格式奇怪的地址"变成"这次少一条结果"。
    """
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for result in results:
        url = str(result.get("url") or "")
        key = canonical_url(url) or url.casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(result)
    return unique


__all__ = ["canonical_url", "dedupe_by_url"]

# SPDX-License-Identifier: Apache-2.0
"""P4-01：搜索结果去重键（canonical URL）。

旧键是 ``(hostname, path.rstrip("/"))``：`?id=1` 与 `?id=2` 被判成同一条，第二条被
**静默丢掉**。这里钉住六组"该合并/该区分"的 URL 对，外加两条**反向断言**——
不能把正常业务参数（`preference`）和带连字符的路径当成追踪信息剥掉。
"""

from __future__ import annotations

import pytest
from app.services.search.canonical import canonical_url, dedupe_by_url


@pytest.mark.parametrize(
    ("left", "right"),
    [
        # 1. 追踪参数：同一篇文章在不同来源里带不同 utm_*，必须判成同一条。
        (
            "https://jobs.example.com/post/42?utm_source=weixin&utm_medium=social",
            "https://jobs.example.com/post/42",
        ),
        # 2. fbclid / gclid：Facebook / Google 的点击 id。
        (
            "https://jobs.example.com/post/42?fbclid=abc123",
            "https://jobs.example.com/post/42?gclid=xyz789",
        ),
        # 3. 末尾斜杠与 fragment 只是写法差异。
        (
            "https://jobs.example.com/jobs/7/#apply",
            "https://jobs.example.com/jobs/7",
        ),
        # 4. 主机名大小写与默认端口。
        (
            "HTTPS://Jobs.Example.COM:443/jobs/7",
            "https://jobs.example.com/jobs/7",
        ),
        # 5. 参数顺序不同（两个来源拼参数的方式不一样）。
        (
            "https://jobs.example.com/list?page=2&dept=backend",
            "https://jobs.example.com/list?dept=backend&page=2",
        ),
        # 6. 只差一个 spm（淘宝/阿里系分享参数）。
        (
            "https://jobs.example.com/post/42?spm=a1z.1234",
            "https://jobs.example.com/post/42",
        ),
    ],
)
def test_tracking_noise_collapses_to_one_key(left: str, right: str):
    assert canonical_url(left) == canonical_url(right)


@pytest.mark.parametrize(
    ("left", "right"),
    [
        # 内容参数：同一个 CMS 的两篇不同文章（旧实现的经典丢数据场景）。
        ("https://cms.example.com/post?id=1", "https://cms.example.com/post?id=2"),
        # WordPress 的 ?p=。
        ("https://blog.example.com/?p=101", "https://blog.example.com/?p=102"),
        # 分页与筛选都是有意义的状态。
        ("https://jobs.example.com/list?page=1", "https://jobs.example.com/list?page=2"),
        # 同一个路径但子域不同（careers vs www）不是同一条。
        ("https://careers.example.com/jobs/1", "https://www.example.com/jobs/1"),
    ],
)
def test_content_parameters_stay_distinct(left: str, right: str):
    assert canonical_url(left) != canonical_url(right)


def test_hyphenated_path_is_not_stripped():
    """反向断言：路径里的连字符一个字符都不动（旧实现的另一种误剥）。"""
    url = "https://blog.example.com/2025-11-02-post-release-notes"
    assert canonical_url(url) == "https://blog.example.com/2025-11-02-post-release-notes"
    # `ref` 只按**参数名精确匹配**剥，`preference` 这种正常参数必须留着。
    assert canonical_url("https://jobs.example.com/x?preference=2").endswith("?preference=2")
    # `utm` 作为前缀剥，但 `utmost` 不是追踪参数。
    assert canonical_url("https://jobs.example.com/x?utmost=1").endswith("?utmost=1")


def test_invalid_urls_yield_empty_key_instead_of_raising():
    assert canonical_url("") == ""
    assert canonical_url("mailto:someone@example.com") == ""
    assert canonical_url("https://user:pass@example.com/x") == ""
    assert canonical_url("not a url") == ""


def test_dedupe_keeps_first_occurrence_and_drops_tracking_duplicates():
    results = [
        {"title": "A", "url": "https://cms.example.com/post?id=1", "snippet": ""},
        {
            "title": "A 的镜像",
            "url": "https://cms.example.com/post?id=1&utm_source=x",
            "snippet": "",
        },
        {"title": "B", "url": "https://cms.example.com/post?id=2", "snippet": ""},
        # 非 http(s) 的条目按原串去重，不整条丢弃（丢了会让"格式奇怪"变成"少一条结果"）。
        {"title": "C", "url": "ftp://example.com/file", "snippet": ""},
        {"title": "C 重复", "url": "ftp://example.com/file", "snippet": ""},
    ]
    kept = dedupe_by_url(results)
    assert [item["title"] for item in kept] == ["A", "B", "C"]

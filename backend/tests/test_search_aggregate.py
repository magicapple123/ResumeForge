# SPDX-License-Identifier: Apache-2.0
"""多来源搜索聚合与正文抓取的离线测试。

联网部分（真实端点）不在测试范围内——那些由运行时的降级逻辑兜住；这里钉住的是
容易写错又难发现的部分：合并顺序、去重、单来源失败降级、正文只抓前 N 条、
以及「不允许抓内网地址」这条安全边界。
"""

from urllib.parse import urlsplit

import app.services.assistant.assistant_web_search as web_search_module
import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.assistant_web_search import AssistantSearchError, build_search_query
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search
from app.services.search.duckduckgo import _unwrap_redirect
from app.services.search.page_reader import extract_text, is_public_http_url


def _result(title: str, url: str, snippet: str = "摘要") -> dict[str, str]:
    return {"title": title, "url": url, "snippet": snippet}


def test_unwrap_redirect_decodes_duckduckgo_links():
    wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fcareers.example.com%2Fjobs&rut=abc"
    assert _unwrap_redirect(wrapped) == "https://careers.example.com/jobs"
    # 普通外链原样返回，DuckDuckGo 自家页面被丢掉（那是广告与设置页）。
    assert (
        _unwrap_redirect("https://careers.example.com/jobs") == "https://careers.example.com/jobs"
    )
    assert _unwrap_redirect("https://duckduckgo.com/y.js?ad=1") == ""


def test_extract_text_skips_scripts_and_short_noise():
    html = """
    <html><head><style>.a{color:red}</style><script>alert(1)</script></head>
    <body>
      <nav><p>首页 关于我们</p></nav>
      <p>这是一段足够长的正文内容，用来验证正文提取会保留它。</p>
      <p>短</p>
      <ul><li>第二条足够长的列表内容，也应被保留下来。</li></ul>
    </body></html>
    """
    text = extract_text(html)
    assert "足够长的正文内容" in text
    assert "第二条足够长的列表内容" in text
    assert "alert(1)" not in text
    assert "color:red" not in text
    # 过短的片段（导航、标签）被丢掉。
    assert "\n短" not in text


def test_is_public_http_url_rejects_local_targets():
    assert is_public_http_url("http://127.0.0.1:8080/jobs") is False
    assert is_public_http_url("http://localhost/jobs") is False
    assert is_public_http_url("http://10.0.0.5/internal") is False
    assert is_public_http_url("file:///etc/passwd") is False
    assert is_public_http_url("https://user:pass@example.com/jobs") is False


@pytest.mark.asyncio
async def test_aggregate_interleaves_deduplicates_and_ranks_official_first(monkeypatch):
    # 注意：标题与摘要要带招聘语义，否则会被既有的相关性过滤丢掉——那正是它该做的事。
    async def fake_bing(_query: str):
        return [
            _result("第三方平台的招聘信息", "https://www.zhipin.com/job/1"),
            _result("后端工程师招聘（转载）", "https://careers.example.com/jobs/9"),
        ]

    async def fake_ddg(_query: str, limit: int = 10):
        return [
            _result("后端工程师招聘（转载）", "https://careers.example.com/jobs/9/"),
            _result("后端工程师招聘官网", "https://careers.example.com/jobs/2"),
        ]

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "duckduckgo"], max_results=8)
    )

    urls = [item["url"] for item in results]
    # 重复（含 / 与不带 / 的同一路径）只留一条。
    assert len(urls) == len(set(urls))
    assert sum(1 for url in urls if urlsplit(url).hostname == "careers.example.com") == 2
    # 用人单位官网排在第三方平台之前。
    assert urlsplit(urls[0]).hostname == "careers.example.com"


@pytest.mark.asyncio
async def test_aggregate_survives_a_failing_source(monkeypatch):
    async def failing_bing(_query: str):
        raise AssistantSearchError("超时")

    async def fake_ddg(_query: str, limit: int = 10):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "bing_search", failing_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing", "duckduckgo"]))
    assert [item["url"] for item in results] == ["https://careers.example.com/jobs/2"]


@pytest.mark.asyncio
async def test_aggregate_raises_when_every_source_is_empty(monkeypatch):
    async def empty_bing(_query: str):
        raise AssistantSearchError("没有结果")

    async def empty_ddg(_query: str, limit: int = 10):
        return []

    monkeypatch.setattr(aggregate_module, "bing_search", empty_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", empty_ddg)

    with pytest.raises(AssistantSearchError, match="没有找到"):
        await aggregate_search("后端 招聘", SearchConfig(sources=["bing", "duckduckgo"]))


@pytest.mark.asyncio
async def test_aggregate_fetches_page_text_only_for_the_first_n(monkeypatch):
    async def fake_bing(_query: str):
        return [
            _result(f"后端工程师招聘 {index}", f"https://careers.example.com/jobs/{index}")
            for index in range(1, 4)
        ]

    fetched: list[str] = []

    async def fake_fetch(url: str, max_chars: int = 0):
        fetched.append(url)
        return "这是抓回来的正文节选。"

    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_fetch)

    results = await aggregate_search("后端 招聘", SearchConfig(sources=["bing"], fetch_pages=2))

    assert len(fetched) == 2
    assert results[0]["text"] == "这是抓回来的正文节选。"
    assert results[1]["text"]
    assert "text" not in results[2]


@pytest.mark.asyncio
async def test_searxng_source_is_skipped_without_a_url(monkeypatch):
    called: list[str] = []

    async def fake_searxng(_query: str, base_url: str, limit: int = 10):
        called.append(base_url)
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    async def fake_bing(_query: str):
        return [_result("后端工程师招聘汇总", "https://careers.example.com/jobs/3")]

    monkeypatch.setattr(aggregate_module, "search_searxng", fake_searxng)
    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    # 没填地址时不该去请求任何 SearXNG 端点。
    await aggregate_search("后端 招聘", SearchConfig(sources=["bing", "searxng"]))
    assert called == []

    await aggregate_search(
        "后端 招聘",
        SearchConfig(sources=["bing", "searxng"], searxng_url="http://localhost:8080"),
    )
    assert called == ["http://localhost:8080"]


def test_search_config_validates_urls_and_limits():
    with pytest.raises(ValueError):
        SearchConfig(searxng_url="localhost:8080")
    assert SearchConfig(searxng_url="http://localhost:8080/").searxng_url == "http://localhost:8080"
    # 去重来源，避免同一个引擎被查两次。
    assert SearchConfig(sources=["bing", "bing"]).sources == ["bing"]


@pytest.mark.asyncio
async def test_aggregate_sends_the_rewritten_query_to_every_source(monkeypatch):
    """三个来源在网络边界上拿到的都是 ``build_search_query`` 改写后的 query。

    在 Bing 那一侧，改写发生在 ``search_web`` 内部（所以挂到 ``fetch_bing_rss`` 上观察），
    DDG / SearXNG 则在聚合层统一改写——三者发出去的东西必须是同一份改写结果，
    绝不把用户整句（「帮我把…」）原样交给引擎。
    """
    question = "帮我把外卖平台项目整理成台账条目"
    expected = build_search_query(question)
    assert expected != question  # 前提：这句确实被改写了
    captured: dict[str, str] = {}

    async def fake_fetch_bing(query: str):
        captured["bing"] = query
        return (
            "<rss><channel><item><title>外卖平台项目</title>"
            "<link>https://example.com/a</link>"
            "<description>项目管理说明</description></item></channel></rss>"
        ).encode()

    async def fake_ddg(query: str, limit: int = 10):
        captured["ddg"] = query
        return []

    async def fake_searxng(query: str, base_url: str, limit: int = 10):
        captured["searxng"] = query
        return []

    # ``conftest`` 的 autouse fixture ``no_real_search_network`` 会把
    # ``aggregate.bing_search`` 换成一个"没有结果"的桩，而 Bing 的查询改写发生在
    # ``search_web`` **内部**、要到 ``fetch_bing_rss`` 这一层才看得到。所以不能直接改
    # 聚合层那个符号的 ``__globals__``（那样改的是 conftest 桩的全局变量，作用不到真实现）。
    # 正确做法：把真正的 ``search_web`` 接回聚合层，再把它查网络用的 ``fetch_bing_rss``
    # 换成记录 query 的假实现；DDG / SearXNG 则在聚合层直接替换。
    monkeypatch.setattr(aggregate_module, "bing_search", web_search_module.search_web)
    monkeypatch.setattr(web_search_module, "fetch_bing_rss", fake_fetch_bing)
    monkeypatch.setattr(aggregate_module, "search_duckduckgo", fake_ddg)
    monkeypatch.setattr(aggregate_module, "search_searxng", fake_searxng)

    await aggregate_search(
        question,
        SearchConfig(
            sources=["bing", "duckduckgo", "searxng"],
            searxng_url="http://localhost:8080",
        ),
    )

    assert captured == {"bing": expected, "ddg": expected, "searxng": expected}


# ===== DeepSeek 作为第四个来源（需求 5） =====


@pytest.mark.asyncio
async def test_deepseek_source_is_skipped_without_a_key(monkeypatch):
    """没配 key 时它不参与并发——不发请求，也不返回"成功但没有结果"。"""
    called: list[str] = []

    async def fake_deepseek(*_args, **_kwargs):
        from app.services.search.deepseek import DeepSeekResults

        called.append("deepseek")
        return DeepSeekResults()

    async def fake_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)
    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search(
        "后端 招聘", SearchConfig(sources=["bing", "deepseek"], max_results=8)
    )
    assert called == []
    assert [item["url"] for item in results] == ["https://careers.example.com/jobs/2"]


@pytest.mark.asyncio
async def test_deepseek_failure_keeps_other_sources(monkeypatch):
    """401 / 429 这类失败只让这一个来源缺席，其它来源结果照常返回。"""
    from app.services.search.deepseek import DeepSeekResults

    async def failing_deepseek(*_args, **_kwargs):
        return DeepSeekResults(failure="unauthorized")

    async def fake_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "search_deepseek", failing_deepseek)
    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(sources=["bing", "deepseek"], deepseek_api_key="sk-test"),
    )
    assert [item["url"] for item in results] == ["https://careers.example.com/jobs/2"]


@pytest.mark.asyncio
async def test_deepseek_402_with_no_other_results_tells_the_user(monkeypatch):
    from app.services.search.deepseek import DeepSeekResults

    async def broke_deepseek(*_args, **_kwargs):
        return DeepSeekResults(failure="insufficient_balance")

    async def empty_bing(_query: str):
        return []

    monkeypatch.setattr(aggregate_module, "search_deepseek", broke_deepseek)
    monkeypatch.setattr(aggregate_module, "bing_search", empty_bing)

    with pytest.raises(AssistantSearchError, match="余额不足"):
        await aggregate_search(
            "后端 招聘",
            SearchConfig(sources=["bing", "deepseek"], deepseek_api_key="sk-test"),
        )


@pytest.mark.asyncio
async def test_deepseek_receives_operators_verbatim(monkeypatch):
    """``site:`` / ``after:`` 不能被改写成关键词，否则操作符会退化成普通词。"""
    captured: dict[str, str] = {}

    async def fake_deepseek(query, count=10, need_content=False, ori_question="", *, api_key=""):
        from app.services.search.deepseek import DeepSeekResults

        captured.update(query=query, ori_question=ori_question, api_key=api_key)
        return DeepSeekResults()

    async def fake_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)
    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    question = "site:zhipin.com after:2025 后端 招聘"
    await aggregate_search(
        question,
        SearchConfig(sources=["bing", "deepseek"], deepseek_api_key="sk-test"),
    )
    assert captured["query"] == question  # 原样，一个字符都没改
    assert captured["ori_question"] == question
    assert captured["api_key"] == "sk-test"


@pytest.mark.asyncio
async def test_deepseek_receives_rewritten_keywords_without_operators(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_deepseek(query, count=10, need_content=False, ori_question="", *, api_key=""):
        from app.services.search.deepseek import DeepSeekResults

        captured.update(query=query, ori_question=ori_question)
        return DeepSeekResults()

    async def fake_bing(_query: str):
        return [_result("后端工程师招聘官网", "https://careers.example.com/jobs/2")]

    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)
    monkeypatch.setattr(aggregate_module, "bing_search", fake_bing)

    question = "帮我把后端招聘信息整理一下"
    await aggregate_search(
        question,
        SearchConfig(sources=["bing", "deepseek"], deepseek_api_key="sk-test"),
    )
    assert captured["query"] == build_search_query(question)
    assert captured["query"] != question
    assert captured["ori_question"] == question  # 整句仍交给接口理解意图


@pytest.mark.asyncio
async def test_deepseek_fetch_falls_back_per_item(monkeypatch):
    """一条 /tools/fetch 失败只回落那一条，另一条的 DeepSeek 正文要保留。"""
    from app.services.search.deepseek import DeepSeekResults

    async def fake_deepseek(*_args, **_kwargs):
        return DeepSeekResults(
            [
                _result("后端工程师招聘 1", "https://careers.example.com/jobs/1"),
                _result("后端工程师招聘 2", "https://careers.example.com/jobs/2"),
            ]
        )

    fetched_deepseek: list[str] = []
    fetched_local: list[str] = []

    async def fake_deepseek_fetch(url: str, api_key: str):
        fetched_deepseek.append(url)
        return "DeepSeek 正文" if url.endswith("/1") else ""

    async def fake_local_fetch(url: str, max_chars: int = 0):
        fetched_local.append(url)
        return "本地正文"

    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)
    monkeypatch.setattr(aggregate_module, "fetch_deepseek_text", fake_deepseek_fetch)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_local_fetch)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(
            sources=["deepseek"], deepseek_api_key="sk-test", fetch_pages=2, max_results=8
        ),
    )

    assert fetched_deepseek == [
        "https://careers.example.com/jobs/1",
        "https://careers.example.com/jobs/2",
    ]
    assert fetched_local == ["https://careers.example.com/jobs/2"]
    assert results[0]["text"] == "DeepSeek 正文"
    assert results[1]["text"] == "本地正文"


@pytest.mark.asyncio
async def test_deepseek_account_unavailable_falls_back_entirely_to_local(monkeypatch):
    from app.services.search.deepseek import DeepSeekResults, DeepSeekUnavailable

    async def fake_deepseek(*_args, **_kwargs):
        return DeepSeekResults(
            [
                _result("后端工程师招聘 1", "https://careers.example.com/jobs/1"),
                _result("后端工程师招聘 2", "https://careers.example.com/jobs/2"),
            ]
        )

    async def unavailable_fetch(url: str, api_key: str):
        raise DeepSeekUnavailable("insufficient_balance")

    fetched_local: list[str] = []

    async def fake_local_fetch(url: str, max_chars: int = 0):
        fetched_local.append(url)
        return "本地正文"

    monkeypatch.setattr(aggregate_module, "search_deepseek", fake_deepseek)
    monkeypatch.setattr(aggregate_module, "fetch_deepseek_text", unavailable_fetch)
    monkeypatch.setattr(aggregate_module, "fetch_page_text", fake_local_fetch)

    results = await aggregate_search(
        "后端 招聘",
        SearchConfig(
            sources=["deepseek"], deepseek_api_key="sk-test", fetch_pages=2, max_results=8
        ),
    )

    assert fetched_local == [
        "https://careers.example.com/jobs/1",
        "https://careers.example.com/jobs/2",
    ]
    assert all(item["text"] == "本地正文" for item in results)

# SPDX-License-Identifier: Apache-2.0
"""T07 公司与岗位背景调研：卡片分类、简报解析与编排降级（全离线）。

这里不联网：A 路替换 ``aggregate_search``、B 路替换 ``_post``。断言的重点是
"外部资料不可信、字段不可靠时页面还能不能站住"——即分类、编号、降级三条性质。
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.search_errors import AssistantSearchError
from app.services.job import company_research as orchestration
from app.services.job import company_research_brief as brief_mod
from app.services.job import company_research_cards as cards_mod


def _run(coro):
    """这些用例都很短，直接跑完拿结果，不引入 async 插件依赖。"""
    return asyncio.run(coro)


# --------------------------------------------------------------------------
# A 路：卡片
# --------------------------------------------------------------------------


def _about_results() -> list[dict[str, str]]:
    return [
        {
            "title": "腾讯控股有限公司 - 官方网站",
            "url": "https://www.tencent.com/about",
            "snippet": "腾讯是一家以互联网为基础的科技与文化公司。",
            "site_name": "腾讯官网",
            "site_icon": "https://www.tencent.com/favicon.ico",
            "date": "",
            "authority": "5",
        },
        {
            "title": "腾讯是做什么的",
            "url": "https://baike.example.com/tencent",
            "snippet": "社交、游戏、金融科技与云服务。",
            "site_name": "百科",
            "site_icon": "",
            "date": "2024-03-01",
            "authority": "4.5",
        },
        {
            "title": "没有站点信息的第三方页面",
            "url": "https://blog.example.org/tencent-notes",
            "snippet": "一条普通笔记。",
            "authority": "",
        },
    ]


def _news_results() -> list[dict[str, str]]:
    return [
        {
            "title": "腾讯发布上一季度财报",
            "url": "https://news.example.com/tencent-q3",
            "snippet": "营收同比增长。",
            "site_name": "财经网",
            "site_icon": "https://news.example.com/icon.png",
            "date": "2026-11-10",
            "authority": "3",
        },
        {
            "title": "腾讯调整组织架构",
            "url": "https://news.example.com/tencent-org",
            "snippet": "内部邮件显示。",
            "site_name": "财经网",
            "date": "2026-09-01",
            "authority": "2",
        },
        {
            # 与第一条查询里的百科页同一条（URL 只差追踪参数）：去重后只应留一张卡。
            "title": "腾讯是做什么的",
            "url": "https://baike.example.com/tencent?utm_source=x",
            "snippet": "社交、游戏、金融科技与云服务。",
            "date": "2024-03-01",
            "authority": "4.5",
        },
    ]


def test_cards_are_classified_deduped_and_capped(monkeypatch):
    async def fake_search(query, config, limit=None, *, depth=None):  # noqa: ARG001
        return _news_results() if "新闻" in query else _about_results()

    monkeypatch.setattr(cards_mod, "aggregate_search", fake_search)
    section = _run(cards_mod.build_company_cards("腾讯", "后端开发", SearchConfig()))

    kinds = [card["kind"] for card in section.cards]
    # 官网在最前：用户找的第一件事是"官网在哪"。
    assert kinds[0] == cards_mod.CARD_KIND_OFFICIAL
    assert cards_mod.CARD_KIND_NEWS in kinds
    # 两条查询都返回了百科页（带 utm），去重后只能出现一次。
    assert len([card for card in section.cards if "百科" in card["site_name"]]) == 1
    assert len(section.cards) <= cards_mod.MAX_CARDS
    assert len(section.queries) == 2
    assert section.failures == []


def test_cards_carry_site_icon_date_and_authority_badge(monkeypatch):
    async def fake_search(query, config, limit=None, *, depth=None):  # noqa: ARG001
        return _news_results() if "新闻" in query else _about_results()

    monkeypatch.setattr(cards_mod, "aggregate_search", fake_search)
    section = _run(cards_mod.build_company_cards("腾讯", "", SearchConfig()))
    official = next(card for card in section.cards if card["kind"] == cards_mod.CARD_KIND_OFFICIAL)

    assert official["site_name"] == "腾讯官网"
    assert official["site_icon"].startswith("https://")
    # authority "5" → 5.0，且过 4 分门槛才打「极权威」标。
    assert official["authority"] == 5.0
    assert official["authority_high"] is True
    # 站点名为空时用主机名兜底，前端不会渲染一行空白。
    fallback = next(card for card in section.cards if card["url"].startswith("https://blog."))
    assert fallback["site_name"] == "blog.example.org"
    assert fallback["authority"] is None
    assert fallback["authority_high"] is False
    # 新闻按日期降序，没有日期的排最后。
    dates = [card["date"] for card in section.cards if card["kind"] == cards_mod.CARD_KIND_NEWS]
    assert dates == sorted(dates, reverse=True)


def test_cards_degrade_instead_of_raising(monkeypatch):
    async def boom(query, config, limit=None, *, depth=None):  # noqa: ARG001
        raise AssistantSearchError("没有找到与当前问题直接相关的公开来源。")

    monkeypatch.setattr(cards_mod, "aggregate_search", boom)
    section = _run(cards_mod.build_company_cards("腾讯", "", SearchConfig()))

    assert section.cards == []
    assert section.failures  # 原因留下来了，页面能显示"这次没搜到"


def test_card_queries_include_role_only_in_the_profile_query():
    queries = cards_mod.build_queries("腾讯", "后端开发")
    assert "后端开发" in queries[0]
    assert "新闻" in queries[1]
    assert cards_mod.build_queries("  ", "x") == []


# --------------------------------------------------------------------------
# B 路：简报
# --------------------------------------------------------------------------


def _brief_body(*, annotations, calls, usage=None) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "## 公司概况\n腾讯主营社交与游戏[1]。\n\n## 近期动态\n上季度营收增长[2]。",
                    "annotations": annotations,
                    "server_tool_calls": calls,
                }
            }
        ],
        "usage": usage or {},
    }


def _annotation(url: str, title: str) -> dict:
    return {"type": "url_citation", "url_citation": {"url": url, "title": title}}


def test_parse_brief_numbers_sources_by_first_appearance():
    body = _brief_body(
        annotations=[
            _annotation("https://www.tencent.com/about", "腾讯官网"),
            _annotation("https://news.example.com/q3", "财报"),
            # 同一个 URL 再出现一次：只能占一个编号。
            _annotation("https://www.tencent.com/about", "腾讯官网"),
            {"type": "other_annotation", "url_citation": {"url": "https://x.example.com"}},
            # 非 http(s) 的地址必须被丢掉（它会进 <a href>）。
            _annotation("javascript:alert(1)", "坏链接"),
        ],
        calls=[{"kind": "web_search", "action": {"queries": ["腾讯 主营业务", "腾讯 财报"]}}],
    )
    brief = brief_mod.parse_brief(body, deep=False)

    assert [source["number"] for source in brief["sources"]] == [1, 2]
    assert brief["sources"][0]["url"] == "https://www.tencent.com/about"
    assert brief["sources"][1]["title"] == "财报"
    assert brief["query_terms"] == 2
    assert brief["tool_calls"] == 1
    assert brief["status"] == "ok"
    assert "[1]" in brief["markdown"]


def test_parse_brief_appends_source_list_when_model_forgot_markers():
    body = _brief_body(
        annotations=[_annotation("https://www.tencent.com/about", "腾讯官网")],
        calls=[],
    )
    body["choices"][0]["message"]["content"] = "## 公司概况\n腾讯主营社交与游戏。"
    brief = brief_mod.parse_brief(body, deep=False)

    assert "参考来源：" in brief["markdown"]
    assert "[1] 腾讯官网" in brief["markdown"]


def test_parse_brief_rejects_empty_answer():
    body = {"choices": [{"message": {"content": "   "}}]}
    with pytest.raises(brief_mod.CompanyResearchError):
        brief_mod.parse_brief(body, deep=False)


def test_payload_declares_only_server_side_web_tools():
    shallow = brief_mod.build_payload("腾讯", "后端开发", "岗位职责：写服务", deep=False)
    assert [tool["type"] for tool in shallow["tools"]] == [
        "deepseek_web_search",
        "deepseek_read_url",
    ]
    # 混用 function tool 会 400：这里断言 payload 里根本没有 function 形态。
    assert all("function" not in tool for tool in shallow["tools"])
    assert shallow["model"] == brief_mod.BRIEF_MODEL
    assert shallow["thinking"] == {"type": "disabled"}
    # 顺序是被服务端强校验的：latest_reminder 必须紧邻 user 且是 5 段逗号分隔格式。
    roles = [message["role"] for message in shallow["messages"]]
    assert roles == ["system", "latest_reminder", "user"]
    reminder = shallow["messages"][1]["content"]
    assert reminder.count(",") >= 4
    assert "Web" in reminder
    assert str(brief_mod.MAX_TOOL_CALLS_NORMAL) in shallow["messages"][0]["content"]
    # JD 必须被标成不可信数据。
    assert "<JD>" in shallow["messages"][2]["content"]

    deep = brief_mod.build_payload("腾讯", "", "", deep=True)
    assert deep["thinking"] == {"type": "enabled"}
    assert str(brief_mod.MAX_TOOL_CALLS_DEEP) in deep["messages"][0]["content"]


def test_latest_reminder_matches_the_server_side_field_format():
    """``latest_reminder`` 的 5 段格式与"星期必须和日期对得上"都由服务端强校验。

    2026-11-15 实机联调时就是因为用了中文日期标点被 400 挡下的，这条断言钉住它。
    """
    payload = brief_mod.build_payload("腾讯", "", "", deep=False)
    parts = payload["messages"][1]["content"].split(",")
    weekdays = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")
    now = datetime.now()
    assert len(parts) == 5
    assert parts[0] == f"{now:%Y-%m-%d}"
    assert parts[1] == weekdays[now.weekday()]
    assert parts[2] == ""  # 位置留空（服务端允许，但不能省掉这一段）
    assert parts[3] == "Web"
    assert parts[4] == "中文"


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "无效或已过期"), (402, "余额不足"), (403, "未开通联网工具"), (500, "暂时不可用")],
)
def test_brief_maps_upstream_status_to_a_reason(monkeypatch, status, expected):
    async def fake_post(payload, api_key):  # noqa: ARG001
        return httpx.Response(status, json={"error": {"message": "upstream"}})

    monkeypatch.setattr(brief_mod, "_post", fake_post)
    with pytest.raises(brief_mod.CompanyResearchError) as excinfo:
        _run(brief_mod.build_company_brief("腾讯", "", "", deep=False, api_key="sk-test"))
    assert expected in str(excinfo.value)


def test_brief_requires_a_key():
    with pytest.raises(brief_mod.CompanyResearchError) as excinfo:
        _run(brief_mod.build_company_brief("腾讯", "", "", deep=False, api_key=""))
    assert "Key" in str(excinfo.value)


def test_brief_reads_usage_from_server_tool_use(monkeypatch):
    body = _brief_body(
        annotations=[_annotation("https://www.tencent.com/about", "腾讯官网")],
        calls=[{"kind": "web_search", "action": {"queries": ["腾讯"]}}],
        usage={"server_tool_use": {"web_search_requests": 3, "web_fetch_requests": 1}},
    )

    async def fake_post(payload, api_key):  # noqa: ARG001
        return httpx.Response(200, json=json.loads(json.dumps(body)))

    monkeypatch.setattr(brief_mod, "_post", fake_post)
    brief = _run(brief_mod.build_company_brief("腾讯", "", "", deep=False, api_key="sk-test"))
    assert brief["billed_searches"] == 3
    assert brief["fetched_pages"] == 1


# --------------------------------------------------------------------------
# 编排层
# --------------------------------------------------------------------------


def _stub_cards(monkeypatch, cards=None):
    async def fake_cards(company, role, config):  # noqa: ARG001
        return cards_mod.CardSection(cards=list(cards or []), queries=["q1", "q2"], failures=[])

    monkeypatch.setattr(orchestration, "build_company_cards", fake_cards)


def test_orchestration_merges_both_paths(monkeypatch):
    card = {
        "kind": "official",
        "title": "腾讯官网",
        "url": "https://www.tencent.com",
        "snippet": "",
        "site_name": "腾讯官网",
        "site_icon": "",
        "date": "",
        "authority": 5.0,
        "authority_high": True,
    }
    _stub_cards(monkeypatch, [card])

    async def fake_brief(company, role, jd, *, deep, api_key):  # noqa: ARG001
        return {
            **brief_mod.failed_brief("", deep=deep),
            "status": "ok",
            "markdown": "## 公司概况\n腾讯[1]。",
            "sources": [{"number": 1, "title": "腾讯官网", "url": "https://www.tencent.com"}],
            "billed_searches": 2,
            "query_terms": 2,
            "tool_calls": 1,
        }

    monkeypatch.setattr(orchestration, "build_company_brief", fake_brief)
    result = _run(
        orchestration.run_company_research(company=" 腾讯 ", role="后端", deep=False, db=None)
    )

    assert result["company"] == "腾讯"
    assert result["role"] == "后端"
    assert len(result["cards"]) == 1
    assert result["brief"]["status"] == "ok"
    assert result["sources"][0]["number"] == 1
    # 用量把卡片那两条查询也算进去，否则用户以为卡片免费。
    assert result["usage"]["card_queries"] == 2
    assert result["usage"]["search_calls"] == 4
    assert result["notes"] == []


def test_orchestration_keeps_cards_when_brief_fails(monkeypatch):
    _stub_cards(monkeypatch, [{"kind": "news", "title": "t", "url": "https://a.example.com"}])

    async def failing_brief(company, role, jd, *, deep, api_key):  # noqa: ARG001
        raise brief_mod.CompanyResearchError("未配置 DeepSeek Key，无法生成联网简报")

    monkeypatch.setattr(orchestration, "build_company_brief", failing_brief)
    result = _run(orchestration.run_company_research(company="腾讯", db=None))

    # 简报失败不吞掉卡片：A 路已经花过钱了。
    assert len(result["cards"]) == 1
    assert result["brief"]["status"] == "failed"
    assert "Key" in result["brief"]["reason"]
    # 失败原因只在简报面板里出现一次，不再重复塞进 notes。
    assert result["notes"] == []
    assert result["usage"]["search_calls"] == 2


def test_orchestration_surfaces_card_failures_once(monkeypatch):
    """卡片查询失败要出现在 notes 里，且同一个原因只说一遍。"""

    async def failing_cards(company, role, config):  # noqa: ARG001
        message = "联网搜索服务暂时不可用，请稍后重试"
        return cards_mod.CardSection(cards=[], queries=["q1", "q2"], failures=[message, message])

    monkeypatch.setattr(orchestration, "build_company_cards", failing_cards)

    async def fake_brief(company, role, jd, *, deep, api_key):  # noqa: ARG001
        return {**brief_mod.failed_brief("", deep=deep), "status": "ok", "markdown": "## 公司概况"}

    monkeypatch.setattr(orchestration, "build_company_brief", fake_brief)
    result = _run(orchestration.run_company_research(company="腾讯", db=None))

    assert result["notes"] == ["联网搜索服务暂时不可用，请稍后重试"]
    assert result["cards"] == []


def test_orchestration_rejects_blank_company():
    with pytest.raises(ValueError) as excinfo:
        _run(orchestration.run_company_research(company="   ", db=None))
    assert "公司名" in str(excinfo.value)


def test_orchestration_rejects_overlong_jd():
    with pytest.raises(ValueError) as excinfo:
        _run(
            orchestration.run_company_research(
                company="腾讯", jd="x" * (orchestration.MAX_JD_CHARS + 1), db=None
            )
        )
    assert "招聘描述" in str(excinfo.value)

# SPDX-License-Identifier: Apache-2.0
"""I-21 公司调研落库：归一化、投影、去重与「最近一次调研」。

这一组不联网：调研编排被替换成固定结果，断言的是"结果有没有写进知识库、
同一家公司会不会越点越多、刷新后还能不能读回来"。
"""

from __future__ import annotations

import re

import pytest
from app.models.knowledge_entry import KnowledgeEntry
from app.services.job import company_research_store as store

_URL_PATTERN = re.compile(r"https?://[^\s)\]，。]+")


def _urls(text: str) -> list[str]:
    """正文里出现的**完整** URL。

    不用 `"https://a" in text`：那种子串判断在正文里出现 `https://evil/?https://a`
    时同样成立（CodeQL 的 py/incomplete-url-substring-sanitization 就是这条，它把这
    一行报成了高危）。这里要证明的是"来源链接被原样保留"，整条相等才是那个意思。
    """
    return _URL_PATTERN.findall(text)


def _assert_url_preserved(text: str, url: str) -> None:
    """来源链接必须**整条**出现在正文里。

    不以字面量做 `"https://…" in text` 那种子串判断：它在正文里出现
    `https://evil/?https://…` 时同样成立（CodeQL 的
    py/incomplete-url-substring-sanitization 逐字面量匹配，仍会把这一行报成高危）。
    这里要证明的是"来源 URL 被原样保留"，整条相等才是那个意思。
    """
    urls = _urls(text)
    assert url in urls, f"正文里没有完整出现来源链接：{url}"


def _result(*, status: str = "ok", company: str = "字节跳动") -> dict:
    brief = {
        "status": status,
        "reason": "" if status == "ok" else "未配置 DeepSeek 搜索 Key",
        "markdown": "## 结论\n公司主营短视频与全球化业务。" if status == "ok" else "",
        "sources": (
            [{"number": 1, "title": "官网", "url": "https://www.bytedance.com/about"}]
            if status == "ok"
            else []
        ),
    }
    return {
        "company": company,
        "role": "后端开发",
        "deep": False,
        "cards": [
            {
                "kind": "about",
                "title": "字节跳动 - 官网",
                "url": "https://www.bytedance.com/",
                "snippet": "全球化科技公司",
            }
        ],
        "brief": brief,
        "sources": brief["sources"],
        "notes": [],
        "usage": {},
    }


def test_normalize_company_name_collapses_width_space_and_suffix():
    assert store.normalize_company_name(" 字节跳动 ") == "字节跳动"
    assert store.normalize_company_name("字节跳动有限公司") == "字节跳动"
    assert store.normalize_company_name("ＢＹＴＥＤＡＮＣＥ") == "BYTEDANCE"
    assert store.normalize_company_name("   ") == ""


def test_build_entry_keeps_sources_and_marks_provenance():
    payload = store.build_knowledge_entry(_result(), job_id=7)

    assert payload is not None
    assert payload.title == "字节跳动 调研简报"
    assert payload.category == "公司调研"
    assert payload.source == "company_research"
    assert payload.company == "字节跳动"
    assert payload.job_id == 7
    # 外部资料不可信：正文必须留得下来源 URL。
    _assert_url_preserved(payload.content, "https://www.bytedance.com/about")
    assert payload.reason.startswith("结论")


def test_build_entry_falls_back_to_cards_when_brief_failed():
    payload = store.build_knowledge_entry(_result(status="failed"))
    assert payload is not None
    _assert_url_preserved(payload.content, "https://www.bytedance.com/")
    assert "未配置" in payload.reason


def test_build_entry_returns_none_when_there_is_nothing_to_store():
    result = _result(status="failed")
    result["cards"] = []
    assert store.build_knowledge_entry(result) is None


def test_save_twice_updates_in_place(db_session):
    first = store.save_research_entry(db_session, _result())
    second = store.save_research_entry(db_session, _result(company=" 字节跳动 "))

    assert first is not None and second is not None
    assert second.id == first.id, "同一家公司重复调研必须原地更新，不能越点越多"
    rows = (
        db_session.query(KnowledgeEntry).filter(KnowledgeEntry.source == "company_research").all()
    )
    assert len(rows) == 1


def test_latest_entry_is_scoped_to_the_company(db_session):
    store.save_research_entry(db_session, _result(company="字节跳动"))
    store.save_research_entry(db_session, _result(company="腾讯"))

    entry = store.latest_company_entry(db_session, " 字节跳动有限公司 ")
    assert entry is not None
    assert entry.company == "字节跳动"
    assert store.latest_company_entry(db_session, "不存在的公司") is None


@pytest.fixture()
def _stub_research(monkeypatch):
    """把两条网络路与用量记账都替换掉：本组只验落库。"""

    async def _fake_run(runtime, *, company, role="", jd="", deep=False, parts=("cards", "brief")):
        return _result(company=company)

    monkeypatch.setattr("app.api.research.load_research_runtime", lambda db, api_key=None: object())
    monkeypatch.setattr("app.api.research.run_company_research_with", _fake_run)
    monkeypatch.setattr("app.api.research.record_research_usage", lambda db, brief: None)


def test_api_persists_and_reads_back_latest(client, _stub_research):
    first = client.post("/api/research/company", json={"company": "字节跳动"})
    assert first.status_code == 200
    entry = first.json()["knowledge_entry"]
    assert entry and entry["id"]

    second = client.post("/api/research/company", json={"company": " 字节跳动 "})
    assert second.status_code == 200
    assert second.json()["knowledge_entry"]["id"] == entry["id"]

    latest = client.get("/api/research/company/latest", params={"company": "字节跳动有限公司"})
    assert latest.status_code == 200
    assert latest.json()["entry"]["id"] == entry["id"]


def test_job_detail_knowledge_block_can_see_the_entry(client, db_session, _stub_research):
    """岗位详情「相关知识」区块读的是 knowledge_entry：落库后必须能按 job_id 查到。"""
    from app.models.job import Job

    job = Job(title="后端开发", company="字节跳动")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)

    response = client.post("/api/research/company", json={"company": "字节跳动", "job_id": job.id})
    assert response.status_code == 200
    rows = (
        db_session.query(KnowledgeEntry)
        .filter(KnowledgeEntry.job_id == job.id, KnowledgeEntry.source == "company_research")
        .all()
    )
    assert len(rows) == 1


# --------------------------------------------------------------------------
# I-23：两条路可以独立重跑
# --------------------------------------------------------------------------


def test_parts_brief_only_does_not_search_cards(monkeypatch):
    """只传 brief 时 A 路一次都不搜：卡片已经搜过就不该为失败重试再付一次钱。"""
    import asyncio

    from app.schemas.setting import SearchConfig
    from app.services.job import company_research as orchestration

    async def _no_cards(*args, **kwargs):  # noqa: ARG001
        raise AssertionError("只请求 brief 时不应调用卡片搜索")

    monkeypatch.setattr(orchestration, "build_company_cards", _no_cards)
    runtime = orchestration.ResearchRuntime(config=SearchConfig(), api_key="")
    result = asyncio.run(
        orchestration.run_company_research_with(runtime, company="字节跳动", parts=("brief",))
    )

    assert result["cards"] == []
    assert result["usage"]["card_queries"] == 0
    # 没配 Key → 简报失败，因此本轮零计费（这正是"只重跑简报"要的性质）。
    assert result["brief"]["status"] == "failed"
    assert result["brief"]["reason_code"] == "unauthorized"
    assert result["usage"]["search_calls"] == 0


def test_parts_cards_only_marks_brief_skipped(monkeypatch):
    import asyncio

    from app.schemas.setting import SearchConfig
    from app.services.job import company_research as orchestration

    async def _cards(company, role, config):  # noqa: ARG001
        return orchestration.CardSection(cards=[], queries=[])

    monkeypatch.setattr(orchestration, "build_company_cards", _cards)
    runtime = orchestration.ResearchRuntime(config=SearchConfig(), api_key="")
    result = asyncio.run(
        orchestration.run_company_research_with(runtime, company="字节跳动", parts=("cards",))
    )

    assert result["brief"]["status"] == "skipped"
    assert result["brief"]["reason_code"] == ""


def test_api_rejects_unknown_parts_without_writing(client, _stub_research, db_session):
    response = client.post(
        "/api/research/company", json={"company": "字节跳动", "parts": ["bogus"]}
    )

    assert response.status_code == 422
    assert db_session.query(KnowledgeEntry).count() == 0


def test_assistant_research_tool_returns_summary_and_persists(db_session, monkeypatch):
    """I-23：助手能调研，返回摘要，并把结果落进知识库。"""
    import asyncio

    from app.schemas.setting import SearchConfig
    from app.services.assistant_tools.research_tools import _tool_research_company
    from app.services.job import company_research as orchestration

    monkeypatch.setattr(
        orchestration,
        "load_research_runtime",
        lambda db, api_key=None: orchestration.ResearchRuntime(config=SearchConfig(), api_key="k"),
    )

    async def _fake_run(runtime, *, company, role="", jd="", deep=False, parts=("cards", "brief")):
        result = _result(company=company)
        result["brief"] = {
            **result["brief"],
            "status": "ok",
            "markdown": "## 结论\n公司主营短视频。",
            "sources": [{"number": 1, "title": "官网", "url": "https://www.bytedance.com/about"}],
            "billed_searches": 2,
        }
        return result

    monkeypatch.setattr(orchestration, "run_company_research_with", _fake_run)
    monkeypatch.setattr(orchestration, "record_research_usage", lambda db, brief: None)

    result = asyncio.run(_tool_research_company(db_session, {"company": "字节跳动"}))

    assert "短视频" in result.text
    _assert_url_preserved(result.text, "https://www.bytedance.com/about")
    assert db_session.query(KnowledgeEntry).count() == 1


def test_assistant_research_tool_reports_missing_key_instead_of_raising(db_session, monkeypatch):
    """没配 Key 时助手要收到可读原因，而不是一个 500。"""
    import asyncio

    from app.schemas.setting import SearchConfig
    from app.services.assistant_tools.research_tools import _tool_research_company
    from app.services.job import company_research as orchestration

    monkeypatch.setattr(
        orchestration,
        "load_research_runtime",
        lambda db, api_key=None: orchestration.ResearchRuntime(config=SearchConfig(), api_key=""),
    )
    runtime_result = _result(status="failed")
    runtime_result["brief"]["reason_code"] = "unauthorized"

    async def _fake_run(runtime, *, company, role="", jd="", deep=False, parts=("cards", "brief")):
        return runtime_result

    monkeypatch.setattr(orchestration, "run_company_research_with", _fake_run)
    monkeypatch.setattr(orchestration, "record_research_usage", lambda db, brief: None)

    result = asyncio.run(_tool_research_company(db_session, {"company": "字节跳动"}))

    assert "失败" in result.text
    assert "DeepSeek" in result.text


def test_api_returns_reason_code_for_actionable_failures(client, db_session, monkeypatch):
    """401 要能被前端识别成「去设置配置 Key」，而不是只给一句原因。"""
    import app.api.research as research_api
    from app.services.job.company_research_brief import failed_brief

    async def _fake_run(runtime, *, company, role="", jd="", deep=False, parts=("cards", "brief")):
        result = _result(status="failed", company=company)
        result["brief"] = failed_brief("DeepSeek Key 无效或已过期", deep=deep, code="unauthorized")
        return result

    monkeypatch.setattr(research_api, "run_company_research_with", _fake_run)
    monkeypatch.setattr(research_api, "load_research_runtime", lambda db, api_key=None: object())
    monkeypatch.setattr(research_api, "record_research_usage", lambda db, brief: None)

    response = client.post("/api/research/company", json={"company": "字节跳动"})

    assert response.status_code == 200
    assert response.json()["brief"]["reason_code"] == "unauthorized"

# SPDX-License-Identifier: Apache-2.0
"""T07 公司调研历史：知识库原地更新、历史按运行追加。

这一组不联网（调研编排被替换成固定结果），断言的是两份数据的边界：

1. 同公司调研两次 → 历史 2 条、知识库仍 1 条（**知识库语义不许变**）；
2. 删单条历史 → 知识库那条仍在、内容一字不差（历史不是知识库的删除入口）；
3. 游标分页：``(created_at, id)`` 严格递减，``total`` 与筛选条件一致；
4. 历史写入失败 → 调研照常 200（历史是增强项，不能连累已经付过搜索费的那次）。

迁移的升级/降级往返在 ``test_migration_0022_company_research_run.py``。
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from app.models.company_research import CompanyResearchRun
from app.models.knowledge_entry import KnowledgeEntry
from app.schemas.setting import SearchConfig
from app.services.job import company_research_history as history
from app.services.job.company_research import ResearchRuntime


def _result(*, company: str = "字节跳动", markdown: str, status: str = "ok") -> dict:
    sources = (
        [{"number": 1, "title": "官网", "url": "https://www.bytedance.com/about"}]
        if status == "ok"
        else []
    )
    return {
        "company": company,
        "role": "后端开发",
        "deep": False,
        "cards": [
            {
                "kind": "official",
                "title": "字节跳动 - 官网",
                "url": "https://www.bytedance.com/",
                "snippet": "全球化科技公司",
                "site_name": "bytedance.com",
                "site_icon": "",
                "date": "",
                "authority": 5,
                "authority_high": True,
            }
        ],
        "brief": {
            "status": status,
            "reason": "",
            "markdown": markdown if status == "ok" else "",
            "sources": sources,
            "elapsed_ms": 1200,
        },
        "sources": sources,
        "notes": [],
        "usage": {
            "deep": False,
            "card_queries": 2,
            "brief_query_terms": 1,
            "brief_tool_calls": 3,
            "search_calls": 5,
            "tool_call_budget": 8,
            "elapsed_ms": 1200,
        },
    }


@pytest.fixture
def fake_research(monkeypatch):
    """把「跑一次调研」换成固定结果；返回一个可改写的当次结果容器。"""

    async def fake_run(_runtime, *, company, role="", jd="", deep=False, parts=("cards", "brief")):
        payload = _result(company=company, markdown=state["markdown"])
        payload["role"] = role
        payload["deep"] = deep
        return payload

    state = {"markdown": "## 结论\n公司主营短视频。"}
    monkeypatch.setattr("app.api.research.load_research_runtime", lambda *_a, **_k: _runtime())
    monkeypatch.setattr("app.api.research.run_company_research_with", fake_run)
    return state


def _runtime() -> ResearchRuntime:
    return ResearchRuntime(config=SearchConfig(), api_key="")


def _history_of(db_session, company: str = "字节跳动") -> list[CompanyResearchRun]:
    return (
        db_session.query(CompanyResearchRun)
        .filter(CompanyResearchRun.company == company)
        .order_by(CompanyResearchRun.created_at.asc(), CompanyResearchRun.id.asc())
        .all()
    )


def test_two_runs_keep_two_history_rows_and_one_knowledge_entry(client, db_session, fake_research):
    """同公司调研两次：历史 2 条，知识库仍是 1 条（原地覆盖的语义不变）。"""
    first = client.post("/api/research/company", json={"company": "字节跳动"})
    assert first.status_code == 200
    entry_id = first.json()["knowledge_entry"]["id"]

    fake_research["markdown"] = "## 结论\n公司主营短视频与全球化业务。"
    second = client.post("/api/research/company", json={"company": "字节跳动"})
    assert second.status_code == 200
    # 第二次仍是同一条知识条目（原地更新，id 不变）。
    assert second.json()["knowledge_entry"]["id"] == entry_id

    entries = db_session.query(KnowledgeEntry).all()
    assert len(entries) == 1, "知识库对同一家公司必须仍只有一条"

    runs = _history_of(db_session)
    assert len(runs) == 2, "每次调研各留一条历史"
    assert runs[0].knowledge_entry_id == entry_id
    assert runs[1].knowledge_entry_id == entry_id
    # 历史是快照：旧那条的正文不会被后一次覆盖。
    assert "短视频。" in runs[0].brief_markdown
    assert "全球化业务" in runs[1].brief_markdown

    listed = client.get("/api/research/history", params={"company": "字节跳动"})
    assert listed.status_code == 200
    assert listed.json()["total"] == 2
    assert listed.json()["bytes"] > 0
    latest = client.get("/api/research/company/latest", params={"company": "字节跳动"})
    assert latest.status_code == 200
    assert latest.json()["count"] == 2, "company/latest 新增的 count 是历史条数"


def test_deleting_one_run_leaves_the_knowledge_entry_intact(client, db_session, fake_research):
    """删历史不动知识库：条目还在、正文一字不差。"""
    client.post("/api/research/company", json={"company": "字节跳动"})
    runs = _history_of(db_session)
    run_id = runs[0].id
    entry_before = db_session.query(KnowledgeEntry).one()
    content_before = entry_before.content

    removed = client.delete(f"/api/research/history/{run_id}")
    assert removed.status_code == 204

    db_session.expire_all()
    assert db_session.query(CompanyResearchRun).count() == 0
    entry_after = db_session.query(KnowledgeEntry).one()
    assert entry_after.id == entry_before.id
    assert entry_after.content == content_before, "删历史不许改动知识库正文"

    # 再删一次：已经没有这条了，404 而不是静默 204。
    assert client.delete(f"/api/research/history/{run_id}").status_code == 404
    assert client.get(f"/api/research/history/{run_id}").status_code == 404


def test_history_cursor_pages_through_rows_in_stable_order(client, db_session):
    """游标分页：不重不漏，total 与筛选条件一致。"""
    base = datetime(2026, 1, 1, 8, 0, 0)
    for index in range(5):
        db_session.add(
            CompanyResearchRun(
                company="字节跳动",
                company_raw="字节跳动",
                role=f"岗位 {index}",
                status="ok",
                brief_markdown=f"## 结论\n第 {index} 次调研",
                sources=[],
                cards=[],
                search_count=index,
                elapsed_ms=100 * index,
                # 显式时间：record_run 用 utcnow，同一秒内插入 5 条会全是同一个时间戳，
                # 分页仍然靠 id 兜住顺序，但这里想验的正是"时间相同也能翻页"。
                created_at=base + timedelta(minutes=index),
            )
        )
    db_session.commit()

    seen: list[int] = []
    cursor = None
    for _ in range(3):
        params = {"company": "字节跳动", "limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = client.get("/api/research/history", params=params)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 5
        seen.extend(item["id"] for item in payload["items"])
        cursor = payload["next_cursor"]
        if not cursor:
            break
    assert len(seen) == 5 and len(set(seen)) == 5, "翻页不许重复，也不许漏"
    # 时间倒序：最新的一条排在第一位。
    newest = db_session.query(CompanyResearchRun).order_by(CompanyResearchRun.id.desc()).first()
    assert seen[0] == newest.id
    assert cursor is None, "最后一页不该再给游标"

    # 坏游标是调用方的错：400，而不是安静地从头开始。
    assert (
        client.get(
            "/api/research/history", params={"company": "字节跳动", "cursor": "not-a-cursor"}
        ).status_code
        == 400
    )


def test_history_failure_does_not_break_the_research_response(client, monkeypatch, fake_research):
    """历史写入抛异常时，调研仍然 200 且知识库照常落库。"""

    def boom(*_args, **_kwargs):
        raise RuntimeError("历史的库写挂了")

    monkeypatch.setattr("app.api.research.record_run", boom)
    response = client.post("/api/research/company", json={"company": "字节跳动"})
    assert response.status_code == 200
    assert response.json()["knowledge_entry"]["id"] > 0
    assert response.json()["brief"]["status"] == "ok"


def test_clear_requires_an_explicit_scope(client, db_session):
    """不带 company 的删除必须显式 all=true；默认请求 400，不清空任何东西。"""
    db_session.add(
        CompanyResearchRun(
            company="字节跳动",
            company_raw="字节跳动",
            status="ok",
            brief_markdown="正文",
            sources=[],
            cards=[],
            created_at=datetime(2026, 1, 1, 8, 0, 0),
        )
    )
    db_session.add(
        CompanyResearchRun(
            company="腾讯",
            company_raw="腾讯",
            status="ok",
            brief_markdown="正文",
            sources=[],
            cards=[],
            created_at=datetime(2026, 1, 1, 9, 0, 0),
        )
    )
    db_session.commit()

    assert client.delete("/api/research/history").status_code == 400
    assert db_session.query(CompanyResearchRun).count() == 2

    # 指定公司：只删这一家。
    cleared = client.delete("/api/research/history", params={"company": "字节跳动"})
    assert cleared.status_code == 204
    db_session.expire_all()
    assert [run.company for run in db_session.query(CompanyResearchRun).all()] == ["腾讯"]

    # 显式 all=true 才清空全部。
    assert client.delete("/api/research/history", params={"all": "true"}).status_code == 204
    db_session.expire_all()
    assert db_session.query(CompanyResearchRun).count() == 0


def test_record_run_is_defensive_even_without_the_api_guard(db_session):
    """服务层自己也要吞异常：没有 API 那层 try 时同样只返回 None。"""

    class BrokenSession:
        def add(self, _row):
            raise RuntimeError("写不进去")

        def commit(self):  # pragma: no cover - add 已经抛了
            raise AssertionError("不该走到 commit")

        def rollback(self):
            self.rolled_back = True

        def close(self):
            raise AssertionError("外部会话不该被关闭")

    broken = BrokenSession()
    assert history.record_run(broken, result=_result(markdown="## 结论\n正文")) is None
    assert getattr(broken, "rolled_back", False) is True

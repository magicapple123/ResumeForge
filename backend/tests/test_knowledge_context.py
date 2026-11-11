# SPDX-License-Identifier: Apache-2.0
"""#29 知识库扩展：五列、可选分类、公司/岗位关联、混合检索与复习提醒。

验收判据（问题清单 #29 验证段）：
- 标题不含关键词的条目能用语义问题检索到，同时关键词也能命中（混合而非替代）；
- 助手回答存条目来源正确（这里验 create_knowledge 的 source/reason 链路）；
- company=字节 后岗位详情 / 面试页能看到（/api/knowledge/related 同一判据）；
- 分类留空能存，列表「未分类」筛选可见；
- 既有批量删除/分页/筛选不退化（test_knowledge.py 仍全绿）。
"""

import json
from datetime import timedelta

from app.models.job import Job
from app.models.knowledge_entry import KnowledgeEntry
from app.models.profile import utcnow
from app.services.assistant_tools.knowledge_tools import _tool_search_knowledge
from app.services.knowledge_rag import hybrid_search, split_markdown_chunks


def _entry(db_session, **overrides) -> KnowledgeEntry:
    data = {
        "title": "条目",
        "category": "",
        "tags": [],
        "content": "",
        "source": "手动录入",
        "reason": "",
        "company": "",
        "job_id": None,
        "summary": "",
        "key_points": [],
    }
    data.update(overrides)
    entry = KnowledgeEntry(**data)
    db_session.add(entry)
    db_session.commit()
    db_session.refresh(entry)
    return entry


def _fake_embedder(text: str) -> tuple[float, float]:
    """确定性假向量：只验证"向量路参与了融合"，不冒充真实语义模型。

    "不会的问题" / "应对策略" 映射到 (1, 0)，其余映射到 (0, 1)；查询向量也取 (1, 0)。
    """
    if "不会的问题" in text or "应对策略" in text:
        return (1.0, 0.0)
    return (0.0, 1.0)


def test_create_entry_with_new_fields_round_trips(client):
    """0014 五列都能写入并读回（reason/company/job_id/summary/key_points）。"""
    payload = {
        "title": "字节一面复盘",
        "category": "面经",
        "content": "# 一面复盘\n\n问了三次项目细节。",
        "source": "助手录入",
        "reason": "下一轮面试前要再看一遍",
        "company": "字节跳动",
        "summary": "项目细节被追问三次，需要准备更具体的数据。",
        "key_points": ["项目指标要记住", "准备失败案例"],
    }

    created = client.post("/api/knowledge", json=payload)

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["reason"] == "下一轮面试前要再看一遍"
    assert body["company"] == "字节跳动"
    assert body["summary"].startswith("项目细节")
    assert body["key_points"] == ["项目指标要记住", "准备失败案例"]

    page = client.get("/api/knowledge/page").json()
    row = page["items"][0]
    assert row["reason"] == "下一轮面试前要再看一遍"
    assert row["company"] == "字节跳动"
    assert row["summary"].startswith("项目细节")
    assert row["key_points"] == ["项目指标要记住", "准备失败案例"]


def test_category_is_optional_and_uncategorized_filter_works(client):
    """#29G：分类可留空（未分类），不再被兜成「其他」。"""
    unclassified = client.post("/api/knowledge", json={"title": "随手记"}).json()
    categorized = client.post(
        "/api/knowledge", json={"title": "STAR 法则", "category": "简历技巧"}
    ).json()

    assert unclassified["category"] == ""
    assert categorized["category"] == "简历技巧"

    only_uncategorized = client.get("/api/knowledge/page", params={"uncategorized": "true"}).json()
    assert only_uncategorized["total"] == 1
    assert only_uncategorized["items"][0]["id"] == unclassified["id"]


def test_company_filter_related_and_companies(client, db_session):
    """#29D：company 可筛选、可做「相关知识 N 条」、可做下拉选项。"""
    bytedance = _entry(db_session, title="字节面经", company="字节跳动", category="面经")
    _entry(db_session, title="腾讯面经", company="腾讯", category="面经")

    filtered = client.get("/api/knowledge/page", params={"company": "字节跳动"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == bytedance.id

    related = client.get("/api/knowledge/related", params={"company": "字节跳动"}).json()
    assert related["total"] == 1
    assert related["items"][0]["title"] == "字节面经"

    related_by_title = client.get(
        "/api/knowledge/related", params={"company": "不存在的公司"}
    ).json()
    assert related_by_title["total"] == 0

    companies = client.get("/api/knowledge/companies").json()
    assert companies == sorted(["腾讯", "字节跳动"])


def test_related_by_job_id_links_job_detail(client, db_session):
    """#29D：job_id 可空外键关联岗位，岗位详情据此取「相关知识 N 条」。"""
    job = Job(title="后端开发", company="字节跳动")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    entry = _entry(db_session, title="这个岗位的面经", job_id=job.id)

    related = client.get("/api/knowledge/related", params={"job_id": job.id}).json()

    assert related["total"] == 1
    assert related["items"][0]["id"] == entry.id
    assert related["items"][0]["job_id"] == job.id


def test_hybrid_search_keyword_and_semantic_paths(db_session):
    """#29A 的核心验收：语义命中（标题不含关键词）与关键词命中同时进入结果。"""
    keyword_entry = _entry(
        db_session,
        title="面试卡壳了怎么接",
        content="先承认不会，再给思路。",
    )
    semantic_entry = _entry(
        db_session,
        title="被问到不会的问题",
        content="# 应对策略\n先承认，再拆解问题。",
    )

    keyword_only, diagnostics = hybrid_search(db_session, "面试卡壳了如何救场", limit=5)
    keyword_ids = {hit.entry_id for hit in keyword_only}
    assert keyword_entry.id in keyword_ids
    assert semantic_entry.id not in keyword_ids, "关键词路不应命中标题不含关键词的条目"
    assert diagnostics["fallback_reason"] == "keyword_only"

    # 向量路参与后，语义条目进入结果；关键词条目仍在（混合而非替代）。
    mixed, mixed_diagnostics = hybrid_search(
        db_session,
        "面试卡壳了如何救场",
        limit=5,
        query_vector=(1.0, 0.0),
        embedder=_fake_embedder,
    )
    mixed_ids = {hit.entry_id for hit in mixed}
    assert keyword_entry.id in mixed_ids
    assert semantic_entry.id in mixed_ids
    assert mixed_diagnostics["vector_count"] >= 1
    assert mixed_diagnostics["fallback_reason"] == ""
    hit = next(item for item in mixed if item.entry_id == semantic_entry.id)
    assert hit.used_vector is True


def test_search_endpoint_returns_brief_only(client):
    """#29A：/api/knowledge/search 只返回定位与摘要（不返回正文全文）。"""
    client.post(
        "/api/knowledge",
        json={
            "title": "答不上来的时候怎么接",
            "content": "正文很长" * 100,
            "summary": "先承认不会，再给思路。",
        },
    )

    response = client.get("/api/knowledge/search", params={"q": "答不上来"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"], "关键词命中应有结果"
    first = body["items"][0]
    assert set(first) == {"id", "title", "snippet", "score", "matched_heading", "used_vector"}
    assert "正文很长" not in json.dumps(first, ensure_ascii=False), "检索结果不得带正文全文"
    assert first["snippet"] == "先承认不会，再给思路。", "有摘要时 snippet 优先摘要（#29E）"


def test_markdown_chunks_split_by_heading(db_session):
    """#29A：按 Markdown 标题切块（标题段本身不单独成块）。"""
    entry = _entry(
        db_session,
        title="面经",
        content="# 一面\n\n问了项目。\n\n## 改进\n\n数据要更具体。",
    )

    chunks = split_markdown_chunks(entry)

    assert [chunk.heading for chunk in chunks] == ["一面", "改进"]
    assert "问了项目" in chunks[0].text
    assert "数据要更具体" in chunks[1].text


def test_assistant_search_tool_returns_compact_json(db_session):
    """#29A：助手工具 search_knowledge 返回 {id,title,snippet,score} 的紧凑 JSON。"""
    entry = _entry(
        db_session,
        title="被问到不会的问题怎么接",
        content="先承认不会。",
        summary="三步：承认、拆解、给下一步。",
    )

    result = _tool_search_knowledge(db_session, {"query": "不会的问题"})

    payload = json.loads(result.text)
    assert payload["结果"], "应有关键词命中"
    assert payload["结果"][0]["id"] == entry.id
    assert set(payload["结果"][0]) == {"id", "title", "snippet", "score"}
    assert result.link == "/knowledge"


def test_review_prompt_lists_stale_entries(client, db_session):
    """#29F：长期没更新的条目进入复习候选（每周提示一次由前端去重）。"""
    stale = _entry(db_session, title="很久没看的笔记")
    stale.updated_at = utcnow() - timedelta(days=40)
    db_session.commit()
    _entry(db_session, title="刚更新的笔记")

    body = client.get("/api/knowledge/review-prompt").json()

    assert body["count"] == 1
    assert body["items"][0]["id"] == stale.id


def test_update_keeps_new_fields(client):
    """PUT 整份替换语义下五列都能被更新（不丢字段）。"""
    created = client.post(
        "/api/knowledge",
        json={"title": "旧标题", "company": "旧公司", "reason": "旧理由"},
    ).json()

    updated = client.put(
        f"/api/knowledge/{created['id']}",
        json={
            "title": "新标题",
            "company": "新公司",
            "reason": "新理由",
            "summary": "新摘要",
            "key_points": ["要点一"],
        },
    )

    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["company"] == "新公司"
    assert body["reason"] == "新理由"
    assert body["summary"] == "新摘要"
    assert body["key_points"] == ["要点一"]

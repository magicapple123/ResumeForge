"""RF-08 分页端点测试：``/page`` 四兄弟的边界、排序与列表 DTO 收窄。

钉住的契约（rf-opt 架构 §2.5）：
- 四个分页端点在**旧上限之外**（候选 >300、进度 >500、网申/知识库 >20）仍然可翻页取到；
- 排序稳定：同 ``created_at``/``updated_at`` 时按 ``id`` desc 决胜；
- 列表 DTO **不含大字段**：knowledge 列表无 ``content``（给 200 字摘要）、网申列表无
  ``items``/``page_snapshot``（填写值走详情）；详情端点仍含全文；
- 旧列表端点行为**零改动**（候选 300 / 进度 500 / 网申 20 的兜底照旧）。

批量造数据直接经 ORM（快于逐条 POST）；HTTP 断言一律走 ``client`` 夹具。
"""

from datetime import datetime, timedelta

import pytest
from app.database import SessionLocal
from app.models.apply import TASK_KIND_COLLECT, ApplyTask
from app.models.knowledge_entry import KnowledgeEntry
from app.models.material import CandidateJob
from app.models.tracker import ApplicationTrack, normalize_key
from app.models.web_form_record import WebFormFillRecord

# 四个分页端点（契约路径，逐字）+ 收口增量：采集/投递批次分页。
PAGE_URLS = {
    "candidate": "/api/candidate-jobs/page",
    "tracks": "/api/tracker/page",
    "knowledge": "/api/knowledge/page",
    "webform": "/api/apply/webform/records/page",
    "tasks": "/api/apply/tasks/page",
}
# 详情端点（既有，全文从这里出）。
DETAIL_URLS = {
    "candidate": "/api/candidate-jobs/{id}",
    "tracks": "/api/tracker/{id}",
    "knowledge": "/api/knowledge/{id}",
    "webform": "/api/webform/records/{id}",
}
# 软删/硬删端点：既有删除路径，四个域全都有（批次没有删除端点，不参与该组用例）。
DELETE_URLS = {
    "candidate": "/api/candidate-jobs/{id}",
    "tracks": "/api/tracker/{id}",
    "knowledge": "/api/knowledge/{id}",
    "webform": "/api/webform/records/{id}",
}
ALL_DOMAINS = ("candidate", "tracks", "knowledge", "webform")
# 批次没有删除端点，只参与排序/空页/校验这几组参数化用例。
PAGE_ONLY_DOMAINS = (*ALL_DOMAINS, "tasks")

_BASE = datetime(2026, 10, 1, 12, 0, 0)


def _stamped(index: int) -> datetime:
    """每条记录一个互不相同的落库时间（模拟真实写入次序）。"""
    return _BASE + timedelta(minutes=index)


# ===== 造数据（直接 ORM，返回 id 列表，插入序 = 时间序 = id 升序） =====


def _make_candidates(count, *, status="pending", note="", stamp=None):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            fields = {"title": f"候选岗位-{i:04d}", "raw_text": f"岗位原文 {i}", "status": status}
            if note:
                fields["note"] = note
            if i == 0:
                # 第一条带超长 JD 正文：证明列表 DTO 确实不含这些大字段（非空表的负例）。
                fields["description"] = "职位描述" * 500
                fields["requirements"] = "任职要求" * 500
            rows.append(CandidateJob(created_at=stamp or _stamped(i), **fields))
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_tracks(count, *, status="applied", note="", stamp=None, company_prefix="公司"):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            company = f"{company_prefix}-{i:04d}"
            fields = {
                "company": company,
                "title": "后端开发",
                "company_key": normalize_key(company),
                "title_key": normalize_key("后端开发"),
                "status": status,
            }
            if note:
                fields["note"] = note
            if i == 0:
                fields["note"] = (note or "") + "超长备注" * 500
            moment = stamp or _stamped(i)
            rows.append(ApplicationTrack(created_at=moment, updated_at=moment, **fields))
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_knowledge(count, *, category="其他", content="", stamp=None, tags=("标签",)):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            body = content if content else f"正文 {i}"
            if i == 0:
                # 第一条正文超 200 字：验证列表只给 200 字截断摘要。
                body = "很长的正文" * 100
            rows.append(
                KnowledgeEntry(
                    title=f"条目-{i:04d}",
                    category=category,
                    tags=list(tags),
                    content=body,
                    source="手动录入",
                    updated_at=stamp or _stamped(i),
                )
            )
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_webform_records(count, *, stamp=None):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            rows.append(
                WebFormFillRecord(
                    url="https://example.com/job",
                    page_title=f"招聘页面 {i:04d}",
                    items=[{"index": 0, "field": "name", "value": "张三", "status": "filled"}],
                    page_snapshot=[{"index": 0, "label": "姓名", "value": "张三", "filled": True}],
                    filled=1,
                    created_at=stamp or _stamped(i),
                )
            )
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_tasks(count, *, kind=TASK_KIND_COLLECT, stamp=None):
    with SessionLocal() as db:
        rows = [
            ApplyTask(kind=kind, created_at=stamp or _stamped(i))
            for i in range(count)
        ]
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


_CREATORS = {
    "candidate": _make_candidates,
    "tracks": _make_tracks,
    "knowledge": _make_knowledge,
    "webform": _make_webform_records,
    "tasks": _make_tasks,
}


# ===== 旧上限之外仍可翻页 =====


def test_candidate_page_beyond_legacy_limit(client):
    ids = _make_candidates(310)
    got: list[int] = []
    for page in range(1, 5):
        resp = client.get(PAGE_URLS["candidate"], params={"page": page, "page_size": 100})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 310
        got.extend(item["id"] for item in body["items"])
    assert sorted(got) == sorted(ids)  # 310 条全部可达、不重不漏

    # 旧端点兜底行为不变：默认仍只返回 300 条（MAX_CANDIDATE_LIST）。
    legacy = client.get("/api/candidate-jobs")
    assert legacy.status_code == 200
    assert len(legacy.json()) == 300


def test_tracks_page_beyond_legacy_limit(client):
    ids = _make_tracks(520)
    got: list[int] = []
    for page in range(1, 7):
        resp = client.get(PAGE_URLS["tracks"], params={"page": page, "page_size": 100})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 520
        got.extend(item["id"] for item in body["items"])
    assert sorted(got) == sorted(ids)

    # 旧端点兜底行为不变：默认仍只返回 500 条（MAX_LIST_LIMIT）。
    legacy = client.get("/api/tracker")
    assert legacy.status_code == 200
    assert len(legacy.json()["items"]) == 500

    # 与旧列表同一排序：分页第一页的行序必须等于旧列表前 100 行的行序。
    page_one = client.get(PAGE_URLS["tracks"], params={"page": 1, "page_size": 100}).json()
    assert [item["id"] for item in page_one["items"]] == [
        item["id"] for item in legacy.json()["items"][:100]
    ]


def test_knowledge_page_beyond_default_limit(client):
    ids = _make_knowledge(25)
    first = client.get(PAGE_URLS["knowledge"], params={"page": 1, "page_size": 20})
    assert first.status_code == 200
    body = first.json()
    assert body["total"] == 25
    assert len(body["items"]) == 20
    second = client.get(PAGE_URLS["knowledge"], params={"page": 2, "page_size": 20})
    assert [item["id"] for item in second.json()["items"]] == sorted(ids[:5], reverse=True)


def test_webform_records_page_beyond_default_limit(client):
    ids = _make_webform_records(25)
    first = client.get(PAGE_URLS["webform"], params={"page": 1, "page_size": 20})
    assert first.status_code == 200
    body = first.json()
    assert body["total"] == 25
    assert len(body["items"]) == 20
    second = client.get(PAGE_URLS["webform"], params={"page": 2, "page_size": 20})
    assert [item["id"] for item in second.json()["items"]] == sorted(ids[:5], reverse=True)

    # 旧端点兜底行为不变：默认仍只返回 20 条。
    legacy = client.get("/api/webform/records")
    assert legacy.status_code == 200
    assert len(legacy.json()) == 20


# ===== 稳定排序：同时间戳时 id desc 决胜 =====


@pytest.mark.parametrize("domain", PAGE_ONLY_DOMAINS)
def test_stable_ordering_id_tiebreak(client, domain):
    """五条记录的排序键时间戳**完全相同**：页内次序必须由 id desc 决胜（新插入的在前）。"""
    ids = _CREATORS[domain](5, stamp=_BASE)
    resp = client.get(PAGE_URLS[domain], params={"page": 1, "page_size": 100})
    assert resp.status_code == 200
    assert [item["id"] for item in resp.json()["items"]] == sorted(ids, reverse=True)


# ===== 空页与越界页 =====


@pytest.mark.parametrize("domain", PAGE_ONLY_DOMAINS)
def test_empty_page_beyond_total(client, domain):
    _CREATORS[domain](1)
    resp = client.get(PAGE_URLS[domain], params={"page": 5, "page_size": 20})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"] == []


@pytest.mark.parametrize("domain", PAGE_ONLY_DOMAINS)
def test_empty_database_page(client, domain):
    resp = client.get(PAGE_URLS[domain])
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


@pytest.mark.parametrize("domain", ALL_DOMAINS)
def test_last_page_delete_then_refetch(client, domain):
    """尾页唯一一条被删后，同页再取必须 200（空页），而不是 500 或 404。"""
    ids = _CREATORS[domain](3)
    first = client.get(PAGE_URLS[domain], params={"page": 1, "page_size": 2}).json()
    # 第一页是最新的两条；尾页（第 2 页）上是 id 最小（最旧）的那条。
    assert [item["id"] for item in first["items"]] == sorted(ids, reverse=True)[:2]
    tail_id = min(ids)

    deleted = client.delete(DELETE_URLS[domain].format(id=tail_id))
    assert deleted.status_code == 204

    again = client.get(PAGE_URLS[domain], params={"page": 2, "page_size": 2})
    assert again.status_code == 200
    body = again.json()
    assert body["total"] == 2
    assert body["items"] == []


# ===== 筛选后 total 一致 =====


def test_candidate_page_filter_total_consistent(client):
    _make_candidates(3, status="pending", note="紧急补招")
    _make_candidates(2, status="imported")
    by_status = client.get(PAGE_URLS["candidate"], params={"status": "imported"}).json()
    assert by_status["total"] == 2
    assert len(by_status["items"]) == 2
    by_keyword = client.get(PAGE_URLS["candidate"], params={"keyword": "紧急补招"}).json()
    assert by_keyword["total"] == 3


def test_tracks_page_filter_total_consistent(client):
    _make_tracks(3, status="interview", company_prefix="面试公司")
    _make_tracks(2, status="rejected", company_prefix="拒信公司")
    by_status = client.get(PAGE_URLS["tracks"], params={"status": "interview"}).json()
    assert by_status["total"] == 3
    _make_tracks(2, status="applied", note="加急跟进", company_prefix="备注公司")
    by_note = client.get(PAGE_URLS["tracks"], params={"keyword": "加急跟进"}).json()
    # 关键词只命中带备注的那两条；total 与行数一致。
    assert by_note["total"] == 2
    assert len(by_note["items"]) == 2


def test_knowledge_page_filter_total_consistent(client):
    _make_knowledge(2, category="面经")
    _make_knowledge(3, category="简历技巧")
    by_category = client.get(PAGE_URLS["knowledge"], params={"category": "面经"}).json()
    assert by_category["total"] == 2
    by_q = client.get(PAGE_URLS["knowledge"], params={"q": "条目-000"}).json()
    assert by_q["total"] == len(by_q["items"]) >= 1


# ===== 列表 DTO 键集合：大字段缺席，详情仍含全文 =====


def test_candidate_page_keys_exclude_jd_body(client):
    _make_candidates(2)
    items = client.get(PAGE_URLS["candidate"], params={"page_size": 100}).json()["items"]
    assert items, "负例前提：列表非空"
    for item in items:
        assert "description" not in item
        assert "requirements" not in item
        assert "additional_info" not in item
    # 详情端点仍含全文——第一条造数记录（id 最小、排在列表末位）带超长 JD。
    detail = client.get(DETAIL_URLS["candidate"].format(id=min(item["id"] for item in items))).json()
    assert detail["description"].startswith("职位描述")


def test_tracks_page_keys_match_legacy_list(client):
    _make_tracks(2)
    page_items = client.get(PAGE_URLS["tracks"], params={"page_size": 100}).json()["items"]
    legacy_items = client.get("/api/tracker").json()["items"]
    assert page_items and legacy_items
    # 同一 DTO（TrackOut 经 _track_brief）：新旧列表的键集合必须一致。
    assert set(page_items[0]) == set(legacy_items[0])


def test_knowledge_page_keys_exclude_full_content(client):
    _make_knowledge(2)
    items = client.get(PAGE_URLS["knowledge"], params={"page_size": 100}).json()["items"]
    assert items, "负例前提：列表非空"
    for item in items:
        assert "content" not in item  # 全文缺席
        assert "content_excerpt" in item
        assert len(item["content_excerpt"]) <= 200
    # 带超长正文的是第一条造数记录（id 最小、排在列表末位）：摘要确实截到 200 字，
    # 且详情端点仍返回全文（500 字 = "很长的正文"×100，摘要恰好切在第 40 个重复处）。
    oldest_id = min(item["id"] for item in items)
    oldest = next(item for item in items if item["id"] == oldest_id)
    assert oldest["content_excerpt"] == "很长的正文" * 40
    detail = client.get(DETAIL_URLS["knowledge"].format(id=oldest_id)).json()
    assert detail["content"] == oldest["content_excerpt"] + "很长的正文" * 60
    assert len(detail["content"]) > 200


def test_webform_page_keys_exclude_fill_values(client):
    _make_webform_records(2)
    items = client.get(PAGE_URLS["webform"], params={"page_size": 100}).json()["items"]
    assert items, "负例前提：列表非空"
    for item in items:
        assert "items" not in item  # 填写值缺席
        assert "page_snapshot" not in item  # 页面正文快照缺席
        assert item["filled"] == 1  # 计数字段仍在
    # 详情端点仍含填写值与页面快照。
    detail = client.get(DETAIL_URLS["webform"].format(id=items[0]["id"])).json()
    assert detail["items"][0]["value"] == "张三"
    assert detail["page_snapshot"][0]["label"] == "姓名"


# ===== 参数校验（与既有分页端点同款 Query 约束） =====


@pytest.mark.parametrize("domain", PAGE_ONLY_DOMAINS)
def test_page_query_validation(client, domain):
    assert (
        client.get(PAGE_URLS[domain], params={"page_size": 101}).status_code == 422
    )  # le=100
    assert client.get(PAGE_URLS[domain], params={"page": 0}).status_code == 422  # ge=1


# ===== 采集/投递批次分页（RF-08 收口增量） =====


def test_tasks_page_beyond_legacy_limit(client):
    """批次历史超过旧端点 limit=100 之后，分页端点仍然全部可达。"""
    ids = _make_tasks(110)
    got: list[int] = []
    for page in range(1, 3):
        resp = client.get(PAGE_URLS["tasks"], params={"page": page, "page_size": 100})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 110
        got.extend(item["id"] for item in body["items"])
    assert sorted(got) == sorted(ids)

    # 旧端点兜底行为不变：默认 20 条、上限 100 条。
    legacy_default = client.get("/api/apply/tasks")
    assert legacy_default.status_code == 200
    assert len(legacy_default.json()) == 20
    legacy_max = client.get("/api/apply/tasks", params={"limit": 100})
    assert len(legacy_max.json()) == 100


def test_tasks_page_kind_filter_total_consistent(client):
    collect_ids = _make_tasks(3, kind="collect")
    _make_tasks(2, kind="apply")
    by_kind = client.get(PAGE_URLS["tasks"], params={"kind": "collect", "page_size": 100}).json()
    assert by_kind["total"] == 3
    assert sorted(item["id"] for item in by_kind["items"]) == sorted(collect_ids)
    other = client.get(PAGE_URLS["tasks"], params={"kind": "apply"}).json()
    assert other["total"] == 2
    # 无效 kind 与旧端点同语义：422。
    assert client.get(PAGE_URLS["tasks"], params={"kind": "bogus"}).status_code == 422


# ===== 知识库 tag 筛选（RF-08 收口增量：分页前过滤，total 反映筛选后集合） =====


def test_knowledge_page_tag_filter_total_consistent(client):
    starred = _make_knowledge(3, tags=("Star", "简历"))
    _make_knowledge(2, tags=("面经",))

    by_tag = client.get(PAGE_URLS["knowledge"], params={"tag": "Star", "page_size": 100}).json()
    assert by_tag["total"] == 3
    assert sorted(item["id"] for item in by_tag["items"]) == sorted(starred)

    # 精确成员判定（与前端 tags.includes(tag) 同语义）：子串不得命中。
    substring = client.get(PAGE_URLS["knowledge"], params={"tag": "面", "page_size": 100}).json()
    assert substring["total"] == 0
    assert substring["items"] == []


def test_knowledge_page_tag_combined_with_q(client):
    # 注意造数函数会给每组第一条塞超长正文（不含关键词），所以命中关键词的是
    # 第二组的后两条。
    _make_knowledge(2, tags=("Star",))
    _make_knowledge(3, tags=("Star",), content="STAR 法则要点")
    # tag 收窄到 5 条，q 再从中挑出命中正文的 2 条：total 反映两级筛选的交集。
    both = client.get(
        PAGE_URLS["knowledge"], params={"tag": "Star", "q": "STAR 法则", "page_size": 100}
    ).json()
    assert both["total"] == 2
    assert len(both["items"]) == 2


def test_knowledge_page_unknown_tag_returns_empty_page(client):
    _make_knowledge(3, tags=("Star",))
    resp = client.get(PAGE_URLS["knowledge"], params={"tag": "不存在的标签"})
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"items": [], "total": 0}


# ===== 知识库标签聚合（RF-08 收口补件：/api/knowledge/tags） =====


def test_knowledge_tags_dedup_sorted_and_empty_db(client):
    # 空库：空数组，不报错。
    assert client.get("/api/knowledge/tags").json() == {"tags": []}

    _make_knowledge(2, tags=("Star", "简历"))  # 两组条目共享 "Star"：必须去重成一条
    _make_knowledge(2, tags=("面经",))
    body = client.get("/api/knowledge/tags").json()
    # 字典序（Unicode 码点）升序："S" < "简" < "面"。
    assert body == {"tags": ["Star", "简历", "面经"]}


def test_knowledge_tags_excludes_deleted_entries(client):
    ids = _make_knowledge(2, tags=("Star",))
    only = _make_knowledge(1, tags=("仅此一条",))
    assert client.delete(DELETE_URLS["knowledge"].format(id=only[0])).status_code == 204
    # 软删条目的标签不再出现在下拉里（与列表/分页的 live_only 口径一致）。
    body = client.get("/api/knowledge/tags").json()
    assert body == {"tags": ["Star"]}
    assert ids  # 前置造数确实存在（防夹具静默失效）


def test_knowledge_tags_consistent_with_tag_filter(client):
    _make_knowledge(3, tags=("Star",))
    _make_knowledge(2, tags=("面经",))
    tags = client.get("/api/knowledge/tags").json()["tags"]
    assert tags == sorted(set(tags))  # 已去重且有序
    # 联动：tags 列表里的每个标签，用 tag=X 过滤分页端点都至少命中一条；
    # 具体地，"面经" 应恰好命中 2 条。
    assert client.get(PAGE_URLS["knowledge"], params={"tag": "面经"}).json()["total"] == 2
    for tag in tags:
        assert client.get(PAGE_URLS["knowledge"], params={"tag": tag}).json()["total"] >= 1

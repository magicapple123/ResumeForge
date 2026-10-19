"""简历列表排序（R14）：默认「最近修改」，可切最近生成 / 标题 / 公司 / 岗位。

为什么默认不是「最近生成」：用户在一份旧简历上改完内容后，最想让它出现在列表最上面。
``updated_at`` 由 ORM 的 ``onupdate`` 维护（改正文、调版式、改备注都算动过它），
迁移 0047 用 ``created_at`` 回填旧行，所以升级那一刻顺序不变。
"""

from __future__ import annotations

from datetime import datetime


def _manual(client, title: str) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": title, "content": {"name": "张三", "summary": "关注后端。"}, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _titles(client, **params) -> list[str]:
    response = client.get("/api/resumes", params=params)
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()["items"]]


def test_default_sort_is_most_recently_updated(client):
    first = _manual(client, "先建的那份")
    _manual(client, "后建的那份")

    # 默认顺序：后建的在前（created_at 相同刻时按 id 兜底）。
    assert _titles(client) == ["后建的那份", "先建的那份"]

    # 改动先建的那份 → 它跳回列表最上面。
    updated = client.put(
        f"/api/resumes/{first}",
        json={"name": "张三", "summary": "改过的内容。"},
    )
    assert updated.status_code == 200, updated.text

    assert _titles(client) == ["先建的那份", "后建的那份"]
    # 最近生成不变：仍然是后建的那份在前。
    assert _titles(client, sort="created_desc") == ["后建的那份", "先建的那份"]


def test_title_sort_is_ascending(client):
    _manual(client, "B 版本")
    _manual(client, "A 版本")

    assert _titles(client, sort="title_asc") == ["A 版本", "B 版本"]


def test_unknown_sort_is_rejected(client):
    response = client.get("/api/resumes", params={"sort": "by_magic"})
    assert response.status_code == 422


def test_sort_does_not_change_the_total(client):
    _manual(client, "一份")
    _manual(client, "两份")

    for sort in ("updated_desc", "created_desc", "title_asc", "company_asc", "job_title_asc"):
        response = client.get("/api/resumes", params={"sort": sort})
        assert response.status_code == 200
        assert response.json()["total"] == 2


def test_list_items_include_updated_at(client):
    """列表项要带 ``updated_at``（R14-b）：前端「最近修改」列直接用它。

    排序用 ``updated_desc`` 却拿不到时间的话，用户只能看到顺序变了、说不出为什么；
    改动之后时间必须真的往前走，否则这一列等于摆设。
    """
    resume_id = _manual(client, "带最近修改的简历")

    item = client.get("/api/resumes").json()["items"][0]
    assert item["updated_at"] is not None
    created_at = datetime.fromisoformat(item["created_at"])
    assert datetime.fromisoformat(item["updated_at"]) >= created_at

    updated = client.put(f"/api/resumes/{resume_id}", json={"name": "张三", "summary": "改过。"})
    assert updated.status_code == 200, updated.text

    item = client.get("/api/resumes").json()["items"][0]
    assert datetime.fromisoformat(item["updated_at"]) > created_at

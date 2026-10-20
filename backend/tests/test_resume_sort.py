# SPDX-License-Identifier: Apache-2.0
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


def test_title_sort_uses_pinyin_and_natural_numbers(client):
    """A→Z（F）：中文按拼音、英文按字母、数字按大小。

    旧行为是 SQLite 的 BINARY collation——所有 ASCII 排在中文前（U 开头第一），
    数字按字符比较（195 < 315 < 75）。这里把用户实际会看到的顺序钉死。
    """
    for title in ["UI设计师", "阿里巴巴", "产品经理", "第2版", "第10版"]:
        _manual(client, title)

    assert _titles(client, sort="title_asc") == [
        "阿里巴巴",
        "产品经理",
        "第2版",
        "第10版",
        "UI设计师",
    ]


def test_unknown_sort_is_rejected(client):
    response = client.get("/api/resumes", params={"sort": "by_magic"})
    assert response.status_code == 422


def test_sort_does_not_change_the_total(client):
    _manual(client, "一份")
    _manual(client, "两份")

    # T2：10 个键（5 个字段 × 升降序）都必须被接受，且过滤结果一致。
    for sort in (
        "updated_desc",
        "updated_asc",
        "created_desc",
        "created_asc",
        "title_asc",
        "title_desc",
        "company_asc",
        "company_desc",
        "job_title_asc",
        "job_title_desc",
    ):
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


# ---- T2：反向键（列头三态排序需要"再点一次反向"）与分页稳定性 ----


def _manual_with_intent(client, title: str, job_intent: str, job_id: int | None = None) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={
            "title": title,
            "content": {"name": "张三", "summary": "关注后端。", "job_intent": job_intent},
            "job_id": job_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _titles_with_ids(client, **params) -> list[tuple[int, str]]:
    response = client.get("/api/resumes", params=params)
    assert response.status_code == 200, response.text
    return [(item["id"], item["title"]) for item in response.json()["items"]]


def test_reverse_keys_mirror_the_forward_keys(client):
    """反向键必须与正向键**完全镜像**（同 collation、同二级排序，只反方向）。

    不镜像的话，用户点两下列头看到的是"顺序变了但没完全反"——比不排序更让人困惑。
    """
    for title in ["丙版本", "甲版本", "乙版本"]:
        _manual(client, title)

    assert _titles(client, sort="title_desc") == list(reversed(_titles(client, sort="title_asc")))
    assert _titles(client, sort="created_asc") == list(
        reversed(_titles(client, sort="created_desc"))
    )
    assert _titles(client, sort="updated_asc") == list(
        reversed(_titles(client, sort="updated_desc"))
    )


def test_job_title_reverse_keeps_pinyin_order(client):
    _manual_with_intent(client, "甲简历", "阿里巴巴")
    _manual_with_intent(client, "乙简历", "字节跳动")
    _manual_with_intent(client, "丙简历", "腾讯")

    asc = _titles(client, sort="job_title_asc")
    # 拼音：阿里巴巴（a…）< 腾讯（t…）< 字节跳动（z…）。
    assert asc == ["甲简历", "丙简历", "乙简历"]
    assert _titles(client, sort="job_title_desc") == list(reversed(asc))


def test_company_reverse_keeps_pinyin_order(client):
    """公司列的两个方向同样按拼音，且互为镜像。"""
    for company in ("阿里巴巴", "腾讯"):
        job = client.post("/api/jobs", json={"title": f"{company}岗位", "company": company})
        assert job.status_code == 201, job.text
        _manual_with_intent(client, f"{company}简历", "", job_id=job.json()["id"])

    asc = _titles(client, sort="company_asc")
    assert asc == ["阿里巴巴简历", "腾讯简历"]
    assert _titles(client, sort="company_desc") == list(reversed(asc))


def test_reverse_keys_keep_pagination_stable(client):
    """主排序完全相同时，靠 ``id`` 末位 tie-breaker 保证跨页不重不漏。

    title 全一样 → 主键与二级键都相等，只剩 id 能定序。没有 tie-breaker 的话
    SQLite 对等值行的顺序不保证稳定，翻页就会看到同一行两次、另一行永远看不到。
    """
    ids = [_manual(client, "同一份") for _ in range(5)]

    seen: list[int] = []
    for page in range(1, 4):
        seen.extend(
            item[0] for item in _titles_with_ids(client, sort="title_asc", page=page, page_size=2)
        )
    assert seen == ids
    assert len(set(seen)) == len(ids)

    # 反向键以 id desc 收尾，镜像关系仍然成立。
    desc: list[int] = []
    for page in range(1, 4):
        desc.extend(
            item[0] for item in _titles_with_ids(client, sort="title_desc", page=page, page_size=2)
        )
    assert desc == list(reversed(ids))


def test_company_sort_keeps_pagination_stable(client):
    """补了 id tie-breaker 的两个二级排序键：同公司同标题的跨页也不重不漏。"""
    job = client.post("/api/jobs", json={"title": "同一岗位", "company": "同一公司"})
    assert job.status_code == 201, job.text
    ids = [_manual_with_intent(client, "同一标题", "", job_id=job.json()["id"]) for _ in range(5)]

    seen: list[int] = []
    for page in range(1, 4):
        seen.extend(
            item[0] for item in _titles_with_ids(client, sort="company_asc", page=page, page_size=2)
        )
    assert seen == ids

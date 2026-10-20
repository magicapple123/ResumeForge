# SPDX-License-Identifier: Apache-2.0
"""岗位排序（R14/E/F）：五个排序键、拼音 collation、发布时间与跨页全选顺序。

从 ``test_api_jobs.py`` 拆出：原文件加完 F 的拼音断言后越过 500 行预算，
而排序用例自成一体（都靠 ``_seed_sortable_jobs`` 造三条时间线互不相同的岗位）。
"""

from datetime import datetime

from app.models.job import Job


def _seed_sortable_jobs(db_session) -> None:
    """三条时间线互不相同的岗位（R14 排序用）。

    时间戳显式给：API 创建的岗位 ``created_at`` 精度只到秒，同一批会撞在一起，排不出
    可断言的顺序。公司名用 ASCII 前缀，避免把断言绑在 SQLite 的中文码点序上。
    """
    rows = [
        ("Beta", "C公司", datetime(2026, 1, 4, 9), datetime(2026, 3, 1, 9)),
        ("Alpha", "A公司", datetime(2026, 1, 3, 9), datetime(2026, 3, 2, 9)),
        ("Gamma", "B公司", datetime(2026, 1, 1, 9), datetime(2026, 3, 3, 9)),
    ]
    for title, company, created_at, updated_at in rows:
        db_session.add(
            Job(title=title, company=company, created_at=created_at, updated_at=updated_at)
        )
    db_session.commit()


def test_job_list_sorts_by_the_five_keys_and_honours_order(client, db_session):
    """岗位排序（R14/E）：5 个排序键各自生效，显式 order 覆盖 sort 自带方向。"""
    _seed_sortable_jobs(db_session)

    def titles(**params) -> list[str]:
        return [item["title"] for item in client.get("/api/jobs", params=params).json()["items"]]

    assert titles() == ["Beta", "Alpha", "Gamma"]  # 默认 created_desc（不传参数也不变）
    assert titles(sort="created_desc") == ["Beta", "Alpha", "Gamma"]
    assert titles(sort="updated_desc") == ["Gamma", "Alpha", "Beta"]
    assert titles(sort="title_asc") == ["Alpha", "Beta", "Gamma"]
    assert titles(sort="company_asc") == ["Alpha", "Gamma", "Beta"]
    # 显式 order 覆盖 sort 自带方向（前端第二次点同一列列头时走这条）。
    assert titles(sort="created_desc", order="asc") == ["Gamma", "Alpha", "Beta"]
    assert titles(sort="title_asc", order="desc") == ["Gamma", "Beta", "Alpha"]
    # 列表项带 updated_at：排序键之一要能被前端读回来核对。
    assert "updated_at" in client.get("/api/jobs").json()["items"][0]


def test_job_title_and_company_sort_use_pinyin(client, db_session):
    """A→Z（F）：岗位标题/公司中文按拼音，ASCII 不再整体排在前面。"""
    for title, company in [
        ("UI设计师", "乙公司"),
        ("阿里巴巴", "甲公司"),
        ("产品经理", "丙公司"),
        ("第10版", "丁公司"),
        ("第2版", "戊公司"),
    ]:
        db_session.add(Job(title=title, company=company))
    db_session.commit()

    titles = [
        item["title"]
        for item in client.get("/api/jobs", params={"sort": "title_asc"}).json()["items"]
    ]
    assert titles == ["阿里巴巴", "产品经理", "第2版", "第10版", "UI设计师"]

    companies = [
        item["company"]
        for item in client.get("/api/jobs", params={"sort": "company_asc"}).json()["items"]
    ]
    assert companies == ["丙公司", "丁公司", "甲公司", "戊公司", "乙公司"]


def test_posted_desc_sorts_by_posted_date_with_import_fallback(client, db_session):
    """「发布时间」列真的按 posted_at 排（E）；解析不出日期时回落到导入日期。"""
    db_session.add_all(
        [
            Job(
                title="较早发布",
                posted_at="2026-09-01",
                created_at=datetime(2026, 10, 5, 9),
            ),
            Job(
                title="较晚发布",
                posted_at="2026-10-01",
                created_at=datetime(2026, 10, 1, 9),
            ),
            Job(
                title="发布时间无法解析",
                posted_at="3 天前",
                created_at=datetime(2026, 9, 15, 9),
            ),
            Job(title="没有发布时间", posted_at="", created_at=datetime(2026, 9, 10, 9)),
        ]
    )
    db_session.commit()

    def titles(**params) -> list[str]:
        return [item["title"] for item in client.get("/api/jobs", params=params).json()["items"]]

    assert titles(sort="posted_desc") == [
        "较晚发布",
        "发布时间无法解析",
        "没有发布时间",
        "较早发布",
    ]
    assert titles(sort="posted_desc", order="asc") == [
        "较早发布",
        "没有发布时间",
        "发布时间无法解析",
        "较晚发布",
    ]


def test_job_list_rejects_unknown_sort_values(client):
    """非法排序值必须 4xx，而不是"200 且顺序不变"（后者会让人以为参数生效了）。"""
    assert client.get("/api/jobs", params={"sort": "bogus"}).status_code == 422
    params = {"sort": "title_asc", "order": "sideways"}
    assert client.get("/api/jobs", params=params).status_code == 422
    assert client.get("/api/jobs/ids", params={"sort": "bogus"}).status_code == 422


def test_job_ids_follow_the_same_order_as_the_list(client, db_session):
    """「全选全部」拿到的 id 顺序必须与列表一致，否则批量处理顺序会莫名其妙。"""
    _seed_sortable_jobs(db_session)

    for params in (
        {},
        {"sort": "updated_desc"},
        {"sort": "company_asc", "order": "desc"},
        {"sort": "posted_desc"},
        {"sort": "title_asc"},
    ):
        listed = [item["id"] for item in client.get("/api/jobs", params=params).json()["items"]]
        assert client.get("/api/jobs/ids", params=params).json() == listed, params

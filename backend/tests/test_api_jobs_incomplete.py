# SPDX-License-Identifier: Apache-2.0
"""岗位库「数据完整度」筛选（CR-36）。

口径：缺公司 **且** 缺薪资 **且** 无来源链接（三列 trim 后都为空）才算可疑行。
只做筛选，不判定真假、不自动删；筛出来之后仍然走既有批量软删（可撤销）。

两条路径共用 ``job_queries.filtered_query``：分页列表 ``GET /api/jobs`` 与跨页全选
``GET /api/jobs/ids``。只测一条会让「看到的」和「全选拿到的」悄悄漂移。
"""

from __future__ import annotations


def _create(client, **payload):
    response = client.post("/api/jobs", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_incomplete_filter_only_returns_rows_missing_company_salary_and_url(client):
    fake = _create(client, title="首页", location="北京市", job_type="其他", status="开放中")
    _create(client, title="有公司", company="美团", location="北京市")
    _create(client, title="有链接", source_url="https://jobs.example.com/1")
    _create(client, title="有薪资", salary="300 元/天")

    response = client.get("/api/jobs", params={"incomplete_only": True, "page_size": 20})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [fake["id"]]
    assert body["items"][0]["title"] == "首页"

    ids = client.get("/api/jobs/ids", params={"incomplete_only": True})
    assert ids.status_code == 200
    assert ids.json() == [fake["id"]]


def test_incomplete_filter_treats_whitespace_only_text_as_empty(client):
    fake = _create(client, title="三个空白", company="  ", salary="\t", source_url="   ")
    _create(client, title="有薪资", company=" ", salary="300 元/天")

    body = client.get("/api/jobs", params={"incomplete_only": True}).json()

    assert [item["id"] for item in body["items"]] == [fake["id"]]


def test_incomplete_filter_disabled_keeps_previous_behaviour(client):
    """不传参 = 改动前的行为：所有存活行照常返回（不能被新条件顺带收窄）。"""
    created = [_create(client, title=title) for title in ("完全空白", "有公司", "有链接")]
    _create(client, title="有链接", source_url="https://jobs.example.com/2")

    body = client.get("/api/jobs", params={"page_size": 20}).json()

    assert body["total"] == 4
    assert {item["id"] for item in body["items"]} >= {job["id"] for job in created}
    assert set(client.get("/api/jobs/ids").json()) >= {job["id"] for job in created}
    # 显式 false 与缺省等价：/jobs/ids 不能被新参数顺带收窄（跨页全选行为不变）。
    explicit_off = client.get("/api/jobs/ids", params={"incomplete_only": False}).json()
    assert set(explicit_off) >= {job["id"] for job in created}
    assert len(explicit_off) == 4


def test_soft_deleted_rows_do_not_show_up_in_incomplete_filter(client):
    fake = _create(client, title="首页", location="北京市")
    assert client.delete(f"/api/jobs/{fake['id']}").status_code == 204

    body = client.get("/api/jobs", params={"incomplete_only": True}).json()

    assert body["total"] == 0
    assert client.get("/api/jobs/ids", params={"incomplete_only": True}).json() == []


def test_incomplete_filter_is_paginated(client):
    for index in range(3):
        _create(client, title=f"可疑行{index}", location="北京市")

    first = client.get(
        "/api/jobs", params={"incomplete_only": True, "page": 1, "page_size": 2}
    ).json()
    second = client.get(
        "/api/jobs", params={"incomplete_only": True, "page": 2, "page_size": 2}
    ).json()
    assert first["total"] == 3
    assert len(first["items"]) == 2
    assert len(second["items"]) == 1
    assert {item["id"] for item in first["items"]}.isdisjoint(
        {item["id"] for item in second["items"]}
    )

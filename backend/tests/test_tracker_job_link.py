# SPDX-License-Identifier: Apache-2.0
"""进度行 → 岗位详情的只读派生匹配（整改 #7）。

`GET /api/tracker/page` 的每行多一个 `job_link_id`：**这一行的岗位名能点去哪**。

四条口径（每条都对应一种"给错链比不给更糟"的情形）：

1. `job_id` 有值且岗位还在 → 直接就是它（投递台/岗位页来的行）；
2. `job_id` 为空但"同公司 + 岗位名相等"唯一命中 → 用那个岗位（识别导入的行）；
3. 同公司两个候选 → **不给链**（猜不出是哪一条）；
4. 岗位已软删（`deleted_at` 非空）→ **不给链**（外键 `SET NULL` 只在硬删时生效，
   软删后 `job_id` 还在，不查一次就会给出一个点进去是空详情的死链）。

另外钉住"不写库"：派生字段算完，`application_track.job_id` 必须还是空的——
一旦写进去就成了一次用户难以撤销的猜测性关联。
"""

from __future__ import annotations

from app.models.job import JOB_STATUS_OPEN, Job

BASE = {
    "company": "A公司",
    "title": "后端开发",
    "status": "applied",
    "applied_at": "2026-09-18",
}


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "手动添加",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _page(client) -> list[dict]:
    response = client.get("/api/tracker/page")
    assert response.status_code == 200
    return response.json()["items"]


def test_explicit_job_id_is_returned_as_is(client, db_session):
    job = _job(db_session)
    created = client.post("/api/tracker", json={**BASE, "job_id": job.id})
    assert created.status_code == 201

    (row,) = _page(client)
    assert row["job_id"] == job.id
    assert row["job_link_id"] == job.id


def test_unique_match_by_company_and_title_gives_a_link(client, db_session):
    """识别导入的进度 `job_id` 显式为 None，只能靠"同公司 + 岗位名"对上。"""
    job = _job(db_session)
    created = client.post("/api/tracker", json=BASE)
    assert created.status_code == 201
    assert created.json()["job_id"] is None

    (row,) = _page(client)
    assert row["job_id"] is None
    # 唯一命中 → 派生出一个可点的岗位 id。
    assert row["job_link_id"] == job.id


def test_job_title_prefix_of_track_title_also_matches(client, db_session):
    """进度标题是通知里的全称，岗位广场里是简称——前缀算同一条。"""
    job = _job(db_session, title="后端开发")
    client.post("/api/tracker", json={**BASE, "title": "后端开发（2026 校招）"})

    (row,) = _page(client)
    assert row["job_link_id"] == job.id


def test_two_candidates_in_the_same_company_give_no_link(client, db_session):
    # 两个岗位名都可能是「后端开发工程师（2026 校招）」的前缀：猜不出是哪一条，就不给链。
    _job(db_session, title="后端开发")
    _job(db_session, title="后端开发工程师")
    client.post("/api/tracker", json={**BASE, "title": "后端开发工程师（2026 校招）"})

    (row,) = _page(client)
    assert row["job_link_id"] is None


def test_soft_deleted_job_gives_no_link_on_either_path(client, db_session):
    """软删的岗位两条路都不能给链：显式 `job_id` 与"唯一命中"都要过 `deleted_at` 过滤。"""
    linked = _job(db_session, title="后端开发")
    matched = _job(db_session, title="前端开发")
    explicit = client.post("/api/tracker", json={**BASE, "job_id": linked.id}).json()["id"]
    derived = client.post("/api/tracker", json={**BASE, "title": "前端开发"}).json()["id"]

    from app.models.profile import utcnow

    for job in (linked, matched):
        job.deleted_at = utcnow()
    db_session.commit()

    rows = {row["id"]: row for row in _page(client)}
    # 显式关联：job_id 仍在（SET NULL 只在硬删时发生），但派生字段为空 → 不给死链。
    assert rows[explicit]["job_id"] == linked.id
    assert rows[explicit]["job_link_id"] is None
    assert rows[derived]["job_link_id"] is None


def test_no_candidate_stays_text(client, db_session):
    _job(db_session, title="完全不同的岗位")
    client.post("/api/tracker", json=BASE)

    (row,) = _page(client)
    assert row["job_link_id"] is None


def test_derived_link_is_not_written_back(client, db_session):
    """派生字段只影响一次显示：库里的 `job_id` 必须还是空的。"""
    job = _job(db_session)
    track_id = client.post("/api/tracker", json=BASE).json()["id"]
    _page(client)

    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["job_id"] is None
    assert detail["job_link_id"] is None  # 单条详情不做匹配（列表才是批量场景）
    assert job.id is not None

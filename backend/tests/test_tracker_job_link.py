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

2026-11-26 补齐（#7 遗留）：老列表端点 `GET /api/tracker`（契约层生成，实现见
`app/services/actions/domains/tracker.py`）同样要下发 `job_link_id`，且必须与
`/page` **逐行相等**——同一个问题不允许多出第二套行为。本文件后半段钉住三件事：
逐行对拍、三种情形（唯一命中 / 两候选 / 软删）在老端点上也成立、以及老端点的
派生匹配**批量**执行（job 表查询条数不随行数增长）。

同一批还补了 `latest_followup`（CR-19）的同一条纪律：老端点原先恒 `None`、`/page`
有值，是**同一类**"同一实体两套行为"。取值口径复用
`services/tracker_query.latest_contacted_at`，本文件同型地钉住逐 id 对拍、六种形态
与"批量不随行数增长"。
"""

from __future__ import annotations

from datetime import datetime

from app.models.followup import ApplicationFollowUp
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.tracker import ApplicationTrack
from app.services import trash
from test_apply_task_detail_queries import _count_statements

BASE = {
    "company": "A公司",
    "title": "后端开发",
    "status": "applied",
    "applied_at": "2026-09-18",
}

# 老列表端点的派生匹配预算：显式关联一次 + 候选一次。N+1 的实现是"每行再加一次"，
# 8 行的数据集会到 9 条，直接越过这条线。
MAX_JOB_LINK_STATEMENTS = 2
# 「最近一次已联系」是一条聚合查询（GROUP BY track_id）：一次封顶，逐行查就是 N+1。
MAX_FOLLOWUP_STATEMENTS = 1


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


# ===== 老列表端点 GET /api/tracker：与 /page 同源 =====


def _legacy(client) -> dict[int, dict]:
    """老列表端点按 id 索引（它与 /page 的分页/条数不同，只有 id 是对拍锚点）。"""
    response = client.get("/api/tracker")
    assert response.status_code == 200
    return {row["id"]: row for row in response.json()["items"]}


def _job_selects(statements: list[str]) -> list[str]:
    """本端点里只有派生匹配会读 ``job`` 表：这组语句的条数就是"批不批量"的证据。"""
    return [sql for sql in statements if "FROM JOB" in sql.replace("\n", " ").upper()]


def test_legacy_list_unique_match_gives_a_link(client, db_session):
    """唯一命中：老端点也要给出可点的岗位 id（它原先只对 /page 生效）。"""
    job = _job(db_session)
    client.post("/api/tracker", json=BASE)

    (row,) = _legacy(client).values()
    assert row["job_id"] is None
    assert row["job_link_id"] == job.id


def test_legacy_list_two_candidates_give_no_link(client, db_session):
    """两个候选说明猜不出是哪一条：老端点同样不给链（宁可不可点，不要链错岗位）。"""
    _job(db_session, title="后端开发")
    _job(db_session, title="后端开发工程师")
    client.post("/api/tracker", json={**BASE, "title": "后端开发工程师（2026 校招）"})

    (row,) = _legacy(client).values()
    assert row["job_link_id"] is None


def test_legacy_list_soft_deleted_job_gives_no_link_on_either_path(client, db_session):
    """软删过滤对老端点的两条通道都生效：显式 `job_id` 与"唯一命中"都不给死链。"""
    linked = _job(db_session, title="后端开发")
    matched = _job(db_session, title="前端开发")
    explicit = client.post("/api/tracker", json={**BASE, "job_id": linked.id}).json()["id"]
    derived = client.post("/api/tracker", json={**BASE, "title": "前端开发"}).json()["id"]

    from app.models.profile import utcnow

    for job in (linked, matched):
        job.deleted_at = utcnow()
    db_session.commit()

    rows = _legacy(client)
    assert rows[explicit]["job_id"] == linked.id  # SET NULL 只在硬删时发生
    assert rows[explicit]["job_link_id"] is None
    assert rows[derived]["job_link_id"] is None


def test_legacy_list_matches_page_row_by_row(client, db_session):
    """同一个问题只能有一套行为：老端点与 /page 对同一行的 `job_link_id` 必须逐条相等。

    数据集刻意混齐六种形态（显式关联 / 唯一命中 / 前缀命中 / 两候选 / 软删 / 无候选），
    这样"某一类只在其中一个端点上生效"的漂移会被逐行对拍直接抓住，而不是只抓一类。
    """
    explicit_job = _job(db_session, title="后端开发", company="甲公司")
    _job(db_session, title="后端开发", company="乙公司")
    _job(db_session, title="后端开发", company="丙公司")
    _job(db_session, title="后端开发工程师", company="丙公司")
    dead_job = _job(db_session, title="后端开发", company="丁公司")

    client.post("/api/tracker", json={**BASE, "company": "甲公司", "job_id": explicit_job.id})
    client.post("/api/tracker", json={**BASE, "company": "乙公司"})
    client.post(
        "/api/tracker", json={**BASE, "company": "丙公司", "title": "后端开发工程师（2026 校招）"}
    )
    client.post("/api/tracker", json={**BASE, "company": "丁公司"})
    client.post("/api/tracker", json={**BASE, "company": "戊公司"})

    from app.models.profile import utcnow

    dead_job.deleted_at = utcnow()
    db_session.commit()

    legacy = _legacy(client)
    page = {row["id"]: row for row in _page(client)}
    assert set(legacy) == set(page)  # 两个端点覆盖同一批行，对拍才有意义
    assert len(legacy) == 5

    for track_id, row in page.items():
        assert legacy[track_id]["job_link_id"] == row["job_link_id"], track_id

    # 逐行对拍之外再钉住绝对值：相等也可能是"两边都算错，但错得一样"。
    links = {row["company"]: row["job_link_id"] for row in legacy.values()}
    assert links["甲公司"] == explicit_job.id
    assert links["乙公司"] is not None  # 唯一命中
    assert links["丙公司"] is None  # 两候选
    assert links["丁公司"] is None  # 软删
    assert links["戊公司"] is None  # 无候选


def test_legacy_list_job_link_lookup_is_batched(client, db_session):
    """派生匹配必须批量：job 表查询条数与行数无关（8 行不能变成 8 次查询）。

    逐行查询在这份数据集上会给出 1（显式关联）+ 8（候选）= 9 条，直接越过预算。
    """
    linked = _job(db_session, title="后端开发", company="显式公司")
    client.post("/api/tracker", json={**BASE, "company": "显式公司", "job_id": linked.id})
    for index in range(7):
        company = f"公司{index}"
        _job(db_session, title="后端开发", company=company)
        client.post("/api/tracker", json={**BASE, "company": company})

    with _count_statements() as statements:
        response = client.get("/api/tracker")

    assert response.status_code == 200
    job_selects = _job_selects(statements)
    assert job_selects, "派生匹配一次都没读 job 表：守卫没落在目标路径上"
    assert len(job_selects) <= MAX_JOB_LINK_STATEMENTS, (
        f"老列表端点执行了 {len(job_selects)} 条 job 表查询（预算 {MAX_JOB_LINK_STATEMENTS} 条）。"
        "请用 services/tracker_job_link.resolve_job_links 整批算，不要逐行查：\n"
        + "\n".join(job_selects)
    )
    # 8 行都拿到了链接 → 上面的条数确实覆盖了全部行的匹配，而不是"只算了第一行"。
    assert all(row["job_link_id"] is not None for row in response.json()["items"])


# ===== 老列表端点 GET /api/tracker：latest_followup 同源（CR-19） =====


def _followup(db_session, track_id: int, decision: str, when: datetime) -> ApplicationFollowUp:
    row = ApplicationFollowUp(track_id=track_id, decision=decision, decided_at=when)
    db_session.add(row)
    return row


def test_legacy_list_matches_page_row_by_row_for_latest_followup(client, db_session):
    """老端点原先恒 `None`、`/page` 有值：同一个「已联系 · 11-25」两个入口两套结果。

    六种形态一次覆盖（口径见 ``tracker_query.latest_contacted_at``）：

    1. 多条 `contacted` → 取最新，更晚的 `replied` **不算**「已联系」；
    2. 只有 `stopped` → 不算已联系；
    3. 从未跟进 → 空；
    4. 跟进记录还在、但进度行被软删 → 两个端点都不出现这一行；
    5. 跨月边界（月末 23:59:59）原样下发，不因时区/取整漂移；
    6. `contacted` 早于 `replied` → 仍显示 `contacted` 的时刻。
    """
    track_ids = {
        company: client.post("/api/tracker", json={**BASE, "company": company}).json()["id"]
        for company in ("甲公司", "乙公司", "丙公司", "丁公司", "戊公司", "己公司")
    }

    _followup(db_session, track_ids["甲公司"], "contacted", datetime(2026, 11, 10, 9))
    _followup(db_session, track_ids["甲公司"], "contacted", datetime(2026, 11, 25, 9))
    _followup(db_session, track_ids["甲公司"], "replied", datetime(2026, 11, 26, 9))
    _followup(db_session, track_ids["乙公司"], "stopped", datetime(2026, 11, 20, 9))
    _followup(db_session, track_ids["丁公司"], "contacted", datetime(2026, 11, 22, 9))
    _followup(db_session, track_ids["戊公司"], "contacted", datetime(2026, 10, 31, 23, 59, 59))
    _followup(db_session, track_ids["己公司"], "contacted", datetime(2026, 11, 1, 8))
    _followup(db_session, track_ids["己公司"], "replied", datetime(2026, 11, 2, 8))
    db_session.commit()

    # 丁公司整行进回收站：跟进决策按 CASCADE 只在**硬删**时消失，软删期间还在库里。
    deleted = db_session.get(ApplicationTrack, track_ids["丁公司"])
    assert deleted is not None
    trash.soft_delete(db_session, "track", deleted)
    db_session.commit()

    legacy = _legacy(client)
    page = {row["id"]: row for row in _page(client)}
    assert set(legacy) == set(page)  # 两个端点覆盖同一批行，对拍才有意义
    assert track_ids["丁公司"] not in legacy  # 软删行两个端点都不返回

    for track_id, row in page.items():
        assert legacy[track_id]["latest_followup"] == row["latest_followup"], track_id

    # 逐行对拍之外再钉住绝对值：相等也可能是"两边都没实现，一起恒为空"。
    followups = {row["company"]: row["latest_followup"] for row in legacy.values()}
    assert followups["甲公司"] == "2026-11-25T09:00:00"
    assert followups["乙公司"] is None
    assert followups["丙公司"] is None
    assert followups["戊公司"] == "2026-10-31T23:59:59"
    assert followups["己公司"] == "2026-11-01T08:00:00"
    assert "丁公司" not in followups


def test_legacy_list_latest_followup_lookup_is_batched(client, db_session):
    """「最近一次已联系」必须批量：follow-up 查询条数与行数无关（8 行不能变 8 次查询）。"""
    expected: dict[str, str] = {}
    for index in range(8):
        company = f"公司{index}"
        track_id = client.post("/api/tracker", json={**BASE, "company": company}).json()["id"]
        when = datetime(2026, 11, 20, 9, 0, index)
        _followup(db_session, track_id, "contacted", when)
        expected[company] = when.isoformat()
    db_session.commit()

    with _count_statements() as statements:
        response = client.get("/api/tracker")

    assert response.status_code == 200
    followup_selects = [
        sql for sql in statements if "APPLICATION_FOLLOW_UP" in sql.replace("\n", " ").upper()
    ]
    assert followup_selects, "跟进时刻一次都没查 application_follow_up：守卫没落在目标路径上"
    assert len(followup_selects) <= MAX_FOLLOWUP_STATEMENTS, (
        f"老列表端点执行了 {len(followup_selects)} 条跟进查询"
        f"（预算 {MAX_FOLLOWUP_STATEMENTS} 条）。请用 "
        "services/tracker.latest_contacted_at 整批取，不要逐行查：\n" + "\n".join(followup_selects)
    )
    # 每行都是**自己**的最近时刻（不是"第一行的值被复用"）。
    assert {row["company"]: row["latest_followup"] for row in response.json()["items"]} == expected

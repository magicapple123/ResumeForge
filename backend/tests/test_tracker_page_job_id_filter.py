"""进度分页端点的 job_id 过滤（RF-11：岗位详情「该岗位的投递进度」深链）。

独立成文件的理由：``test_list_pagination.py`` 已贴近 500 行预算，这批用例围绕
单一新参数自成一组（只返回该岗位 / 不存在 → 空页 / 与 status 组合 / 旧端点零改动），
拆出来既守住行数预算，也不用给原文件登记豁免。
"""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models.job import Job
from app.models.tracker import ApplicationTrack, normalize_key

PAGE_URL = "/api/tracker/page"

_BASE_STAMP = datetime(2026, 10, 1, 12, 0, 0)


def _make_tracks_for_jobs():
    """给两个岗位各造几条不同状态的进度；再留一条不挂岗位的。返回 (a_id, b_id)。"""
    with SessionLocal() as db:
        a = Job(title="岗位A", company="公司A")
        b = Job(title="岗位B", company="公司B")
        db.add_all([a, b])
        db.commit()
        a_id, b_id = a.id, b.id

    with SessionLocal() as db:
        rows = []
        specs = [
            # (job_id, status, company 前缀)——岗位A 两条 applied + 一条 interview。
            (a_id, "applied", "甲"),
            (a_id, "applied", "甲"),
            (a_id, "interview", "甲"),
            (b_id, "rejected", "乙"),
            (None, "applied", "丙"),
        ]
        for i, (job, status, prefix) in enumerate(specs):
            company = f"{prefix}-公司-{i:04d}"
            moment = _BASE_STAMP + timedelta(minutes=i)
            rows.append(
                ApplicationTrack(
                    company=company,
                    title="后端开发",
                    company_key=normalize_key(company),
                    title_key=normalize_key("后端开发"),
                    status=status,
                    job_id=job,
                    created_at=moment,
                    updated_at=moment,
                )
            )
        db.add_all(rows)
        db.commit()
    return a_id, b_id


def test_tracks_page_job_id_filter_returns_only_that_job(client):
    a_id, _ = _make_tracks_for_jobs()

    by_job = client.get(PAGE_URL, params={"job_id": a_id, "page_size": 100}).json()
    assert by_job["total"] == 3
    assert all(item["company"].startswith("甲-") for item in by_job["items"])
    # 不挂岗位的那条绝不能混进来。
    assert not any(item["company"].startswith("丙-") for item in by_job["items"])


def test_tracks_page_unknown_job_id_returns_empty_page(client):
    _make_tracks_for_jobs()

    resp = client.get(PAGE_URL, params={"job_id": 999999})
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


def test_tracks_page_job_id_combined_with_status(client):
    a_id, _ = _make_tracks_for_jobs()

    combined = client.get(
        PAGE_URL, params={"job_id": a_id, "status": "interview", "page_size": 100}
    ).json()
    # 两级过滤的交集：岗位A 只有那一条 interview。
    assert combined["total"] == 1
    assert combined["items"][0]["company"].startswith("甲-")
    wrong_status = client.get(PAGE_URL, params={"job_id": a_id, "status": "rejected"}).json()
    assert wrong_status["total"] == 0


def test_tracks_page_without_job_id_unchanged_and_legacy_endpoint_untouched(client):
    a_id, b_id = _make_tracks_for_jobs()
    assert a_id != b_id

    # 不传 job_id：5 条全量，行为与从前一致。
    unfiltered = client.get(PAGE_URL, params={"page_size": 100}).json()
    assert unfiltered["total"] == 5

    # 旧列表端点零改动：不认识也不需要认识 job_id，仍返回全量。
    legacy = client.get("/api/tracker", params={"job_id": a_id}).json()
    assert legacy["total"] == 5


# ===== PR-13：stats 与导出的 job_id 贯穿（口径与列表一致） =====


def test_stats_endpoint_filters_by_job_id(client):
    """岗位深链时漏斗统计必须与列表同口径：不再出现"列表是一家公司、漏斗是全部"。"""
    a_id, _ = _make_tracks_for_jobs()

    by_job = client.get("/api/tracker/stats", params={"job_id": a_id}).json()
    assert by_job["total"] == 3
    assert by_job["status_counts"]["interview"] == 1

    # 不传 job_id：全量 5 条，行为与从前一致。
    assert client.get("/api/tracker/stats").json()["total"] == 5
    # 不存在的岗位：0，而不是混入全量。
    assert client.get("/api/tracker/stats", params={"job_id": 999999}).json()["total"] == 0


def test_export_endpoint_filters_by_job_id(client):
    a_id, b_id = _make_tracks_for_jobs()

    by_job = client.get("/api/tracker/export", params={"format": "json", "job_id": a_id})
    payload = by_job.json()
    assert payload["总数"] == 3
    assert all(row["公司"].startswith("甲-") for row in payload["记录"])
    assert not any(row["公司"].startswith("丙-") for row in payload["记录"])

    # CSV 同口径：BOM + 表头 + 3 行数据。
    csv_resp = client.get("/api/tracker/export", params={"format": "csv", "job_id": b_id})
    body = csv_resp.content.decode("utf-8-sig")
    data_lines = [line for line in body.splitlines() if line and not line.startswith("公司,")]
    assert len(data_lines) == 1

    # 不传 job_id：5 条全量，行为与从前一致。
    assert client.get("/api/tracker/export", params={"format": "json"}).json()["总数"] == 5

# SPDX-License-Identifier: Apache-2.0
"""批次 B 分页端点测试：面经/资料箱/事实台账的 ``/page``。

钉住的契约：
- 三个新 ``/page`` 端点过滤与排序与旧全量端点**同源**（旧端点行为零改动）；
- 列表行 DTO **不含大字段**：面经无 ``content``/``questions``（给 200 字摘要 +
  ``question_count``）、台账无 ``source_fact``/``candidate_wording`` 全文、资料箱
  附件元信息无 ``data_url``/``text``（RF-25 口径延续）；
- 台账 ``/page`` 的汇总用 SQL 计数，与旧端点的内存汇总**逐字段一致**；
- 软删除的记录不进分页结果。
"""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models.claim import (
    CLAIM_CATEGORIES,
    VERIFICATION_CONFIRMED,
    VERIFICATION_PENDING,
    VERIFICATION_REJECTED,
    ClaimRecord,
)
from app.models.interview_experience import InterviewExperience
from app.models.material import Material

_BASE = datetime(2026, 10, 1, 12, 0, 0)


def _stamped(index: int) -> datetime:
    return _BASE + timedelta(minutes=index)


def _make_materials(count=13):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            fields = {
                "title": f"资料-{i:04d}",
                "category": "证书" if i % 2 else "其他",
                "content": f"正文内容 {i}",
                "note": "",
                "created_at": _stamped(i),
                "updated_at": _stamped(i),
            }
            if i == 0:
                fields["files"] = [
                    {
                        "name": "证书.png",
                        "data_url": "data:image/png;base64,AAAA",
                        "text": "附件文字" * 100,
                    }
                ]
                fields["content"] = "超长正文" * 500
            rows.append(Material(**fields))
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_experiences(count=23):
    with SessionLocal() as db:
        rows = []
        for i in range(count):
            fields = {
                "title": f"面经-{i:04d}",
                "company": f"公司-{i % 3}",
                "position": "后端开发",
                "content": f"面试过程 {i}" + ("长" * 400 if i == 0 else ""),
                "questions": [f"问题 {j}" for j in range(i % 4)],
                "tags": ["标签"],
                "source": "self" if i % 2 else "peer",
                "created_at": _stamped(i),
                "updated_at": _stamped(i),
            }
            rows.append(InterviewExperience(**fields))
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


def _make_claims(count=25):
    with SessionLocal() as db:
        statuses = (VERIFICATION_CONFIRMED, VERIFICATION_PENDING, VERIFICATION_REJECTED)
        rows = []
        for i in range(count):
            fields = {
                "title": f"主张-{i:04d}",
                "category": CLAIM_CATEGORIES[i % len(CLAIM_CATEGORIES)],
                "subject": f"主体-{i % 5}",
                "source_fact": f"事实 {i}" + ("长" * 900 if i == 0 else ""),
                "candidate_wording": f"表述 {i}" + ("长" * 900 if i == 1 else ""),
                "responsibility_level": "参与",
                "verification_status": statuses[i % 3],
                "created_at": _stamped(i),
                "updated_at": _stamped(i),
            }
            rows.append(ClaimRecord(**fields))
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


# ===== 资料箱 /page =====


def test_materials_page_basic_and_ordering(client):
    _make_materials(19)
    resp = client.get("/api/materials/page")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 19
    assert len(body["items"]) == 18  # 默认一页 18 张（桌面 4 列网格，末行可留空）
    second = client.get("/api/materials/page", params={"page": 2}).json()
    assert len(second["items"]) == 1
    # 排序：updated_at desc → 最后插入的排最前
    assert body["items"][0]["title"] == "资料-0018"
    assert second["items"][0]["title"] == "资料-0000"


def test_materials_page_filters(client):
    _make_materials(13)
    body = client.get("/api/materials/page", params={"category": "证书"}).json()
    assert body["total"] == 6
    assert all(item["category"] == "证书" for item in body["items"])
    body = client.get("/api/materials/page", params={"keyword": "资料-0003"}).json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "资料-0003"


def test_materials_page_files_summary_has_no_big_fields(client):
    _make_materials(13)
    _items = client.get("/api/materials/page").json()["items"]
    with_files = [item for item in _items if item["files"]]
    if not with_files:
        with_files = client.get("/api/materials/page", params={"page": 2}).json()["items"]
    assert with_files, "0000 号资料带附件，翻到第二页必须出现"
    for entry in with_files[0]["files"]:
        assert "data_url" not in entry
        assert "text" not in entry


# ===== 面经 /page =====


def test_experiences_page_summary_shape(client):
    _make_experiences(23)
    resp = client.get("/api/interview-experiences/page")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 23
    assert len(body["items"]) == 20  # 默认一页 20
    first = body["items"][0]
    assert "content" not in first
    assert "questions" not in first
    assert len(first["content_excerpt"]) <= 200
    assert first["question_count"] == 2  # 0022 号：22 % 4 == 2 → 两条问题
    last_page = client.get("/api/interview-experiences/page", params={"page": 2}).json()
    assert len(last_page["items"]) == 3
    # 0000 号正文 400+ 字被截断成 200；问题 0 条（0 % 4）
    oldest = last_page["items"][-1]
    assert len(oldest["content_excerpt"]) == 200
    assert oldest["question_count"] == 0


def test_experiences_page_filters(client):
    _make_experiences(23)
    body = client.get("/api/interview-experiences/page", params={"keyword": "面试过程 7"}).json()
    assert body["total"] == 1
    body = client.get("/api/interview-experiences/page", params={"source": "peer"}).json()
    assert body["total"] == 12
    body = client.get("/api/interview-experiences/page", params={"company": "公司-1"}).json()
    assert body["total"] > 0
    assert all(item["company"] == "公司-1" for item in body["items"])
    # page_size 上限 100
    assert (
        client.get("/api/interview-experiences/page", params={"page_size": 200}).status_code == 422
    )


# ===== 事实台账 /page =====


def test_claims_page_sql_summary_matches_legacy_endpoint(client):
    ids = _make_claims(25)
    legacy = client.get("/api/claims").json()
    paged = client.get("/api/claims/page").json()
    for key in ("total", "confirmed_count", "pending_count", "category_counts"):
        assert paged[key] == legacy[key], key
    assert paged["total"] == 25
    assert len(paged["items"]) == 20
    first = paged["items"][0]
    assert "source_fact" not in first
    assert "candidate_wording" not in first
    assert len(first["source_fact_excerpt"]) <= 200
    assert isinstance(first["warnings"], list)
    # 软删一条后两个端点同步少一
    assert client.delete(f"/api/claims/{ids[10]}").status_code == 204
    assert client.get("/api/claims/page").json()["total"] == 24
    assert client.get("/api/claims").json()["total"] == 24


def test_claims_page_filters_and_validation(client):
    _make_claims(25)
    body = client.get("/api/claims/page", params={"status": VERIFICATION_CONFIRMED}).json()
    assert body["total"] == body["confirmed_count"]
    assert all(item["verification_status"] == VERIFICATION_CONFIRMED for item in body["items"])
    body = client.get("/api/claims/page", params={"keyword": "主体-3"}).json()
    assert body["total"] > 0
    assert client.get("/api/claims/page", params={"status": "未知状态"}).status_code == 422
    assert client.get("/api/claims/page", params={"category": "未知分类"}).status_code == 422

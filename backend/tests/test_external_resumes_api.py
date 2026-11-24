# SPDX-License-Identifier: Apache-2.0
"""``GET /api/external-resumes?include_general=true``（T6）的接口契约。

求职进度选「使用的简历」时，候选范围必须与内部简历 ``GET /api/resumes`` 逐字一致：
**本岗位 + 通用**。内部简历那边的口径是 ``job_id == ? OR job_id IS NULL``
（``services/resume/resume_read_service.py``），外部简历这里此前只能精确匹配岗位，
于是"专门写的通用简历"会从下拉里消失——同一个选择框里两组的范围不一样，用户没法解释。

钉四件事：

1. ``include_general`` 默认 ``false``：既有调用方（简历中心的外部简历列表）行为不变；
2. 为 ``true`` 时是"本岗位 + 通用"，**别的岗位**的仍然不进来；
3. 不给 ``job_id`` 时该参数无效（全库，与原来一致）；
4. 回收站里的行仍然不出现（``live_only`` 与新参数正交）。
"""

from __future__ import annotations

import pytest
from app.models.job import Job


@pytest.fixture
def records(client, db_session):
    """三份外部简历：一份挂岗位 A、一份挂岗位 B、一份通用（不挂岗位）。"""
    jobs = [Job(title="后端开发", company="示例科技"), Job(title="前端开发", company="另一家")]
    db_session.add_all(jobs)
    db_session.commit()
    rows = []
    for name, job in [
        ("resume-a.txt", jobs[0]),
        ("resume-b.txt", jobs[1]),
        ("resume-general.txt", None),
    ]:
        response = client.post(
            "/api/external-resumes",
            files={"file": (name, b"Real resume body", "text/plain")},
            data={"job_id": str(job.id)} if job is not None else {},
        )
        assert response.status_code == 201, response.text
        rows.append(response.json())
    return jobs, rows


def _ids(client, **params) -> set[int]:
    body = client.get("/api/external-resumes", params=params).json()
    assert body["total"] == len(body["items"])
    return {int(row["id"]) for row in body["items"]}


def test_the_default_stays_job_exact(client, records):
    jobs, rows = records
    assert _ids(client, job_id=jobs[0].id) == {rows[0]["id"]}


def test_include_general_adds_only_the_unbound_row(client, records):
    jobs, rows = records
    got = _ids(client, job_id=jobs[0].id, include_general="true")
    assert got == {rows[0]["id"], rows[2]["id"]}
    # 别的岗位那一份不能因为"放开通用"就混进来。
    assert rows[1]["id"] not in got


def test_include_general_is_a_no_op_without_a_job(client, records):
    _jobs, rows = records
    assert _ids(client, include_general="true") == {row["id"] for row in rows}


def test_include_general_matches_the_keyword_filter(client, records):
    """关键词与范围是两件事，要能组合：范围是"本岗位+通用"，关键词再收一次。"""
    jobs, rows = records
    assert _ids(client, job_id=jobs[0].id, include_general="true", keyword="general") == {
        rows[2]["id"]
    }


def test_include_general_keeps_trashed_rows_out(client, records):
    jobs, rows = records
    assert client.delete(f"/api/external-resumes/{rows[2]['id']}").status_code == 204
    assert _ids(client, job_id=jobs[0].id, include_general="true") == {rows[0]["id"]}

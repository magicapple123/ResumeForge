# SPDX-License-Identifier: Apache-2.0
"""简历列表的「本岗位 + 通用」口径（0066，面试关联简历下拉用）。

真实面试里候选人既可能用"专门为这个岗位写的简历"，也可能用一份通用简历，所以
``job_id=<X>&include_general=true`` 要同时返回这两类；其它岗位的简历不能混进来。
不传 ``include_general`` 时口径必须与以前**逐字一致**（只返回本岗位的）。
"""

from __future__ import annotations

from app.models.job import Job
from app.models.resume import ResumeRecord


def _job(db_session, title: str) -> Job:
    job = Job(title=title, company="示例公司")
    db_session.add(job)
    db_session.commit()
    return job


def _resume(db_session, title: str, job_id: int | None) -> ResumeRecord:
    record = ResumeRecord(title=title, job_id=job_id, content={"name": "张三"})
    db_session.add(record)
    db_session.commit()
    return record


def _titles(client, query: str) -> set[str]:
    response = client.get(f"/api/resumes{query}")
    assert response.status_code == 200, response.text
    return {item["title"] for item in response.json()["items"]}


def test_include_general_returns_this_job_and_general_resumes(client, db_session):
    backend = _job(db_session, "后端开发工程师")
    frontend = _job(db_session, "前端开发工程师")
    _resume(db_session, "后端-A", backend.id)
    _resume(db_session, "后端-B", backend.id)
    _resume(db_session, "通用简历", None)
    _resume(db_session, "前端-A", frontend.id)

    both = _titles(client, f"?job_id={backend.id}&include_general=true")
    assert both == {"后端-A", "后端-B", "通用简历"}

    # 不传 include_general：口径与以前一致（只返回本岗位的），不受新参数影响。
    only_job = _titles(client, f"?job_id={backend.id}")
    assert only_job == {"后端-A", "后端-B"}

    # 显式 false 与不传等价。
    assert _titles(client, f"?job_id={backend.id}&include_general=false") == {"后端-A", "后端-B"}
    # 没有 job_id 时 include_general 不改变任何东西（"本岗位"无从谈起）。
    assert _titles(client, "?include_general=true") == {"后端-A", "后端-B", "通用简历", "前端-A"}


def test_include_general_on_ids_endpoint(client, db_session):
    """``/ids`` 与列表共用过滤口径：批量选择与下拉看到的必须是同一批简历。"""
    backend = _job(db_session, "后端开发工程师")
    other = _job(db_session, "算法工程师")
    backend_resume = _resume(db_session, "后端-A", backend.id)
    general_resume = _resume(db_session, "通用简历", None)
    _resume(db_session, "算法-A", other.id)

    response = client.get(f"/api/resumes/ids?job_id={backend.id}&include_general=true")
    assert response.status_code == 200, response.text
    assert set(response.json()) == {backend_resume.id, general_resume.id}

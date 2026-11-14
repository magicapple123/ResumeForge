# SPDX-License-Identifier: Apache-2.0
"""外部简历的服务端筛选：关键词/岗位可组合，且在"只取最近 100 条"之前生效。

守的是"筛了个寂寞"：先截断再筛选，会让第 101 条之后的匹配永远看不到；已删除岗位不再
匹配，但它名下的简历仍要能被关键词搜到。
"""

from datetime import datetime

import pytest
from app.models.external_resume import ExternalResume
from app.models.job import Job


@pytest.fixture
def records(client, db_session):
    jobs = [
        Job(title="Agent manager", company="ByteDance"),
        Job(title="Data manager", company="Other"),
    ]
    db_session.add_all(jobs)
    db_session.commit()
    rows = []
    for name, job in [
        ("alpha.txt", jobs[0]),
        ("beta.txt", jobs[0]),
        ("gamma.txt", jobs[1]),
        ("general.txt", None),
    ]:
        response = client.post(
            "/api/external-resumes",
            files={"file": (name, b"Real resume body", "text/plain")},
            data={"job_id": str(job.id)} if job else {},
        )
        assert response.status_code == 201, response.text
        rows.append(response.json())
    return jobs, rows


@pytest.mark.parametrize("keyword", ["ByteDance", "Agent", "alpha"])
def test_search_matches_name_job_title_and_company(client, records, keyword):
    _, rows = records
    response = client.get("/api/external-resumes", params={"keyword": keyword})
    assert response.status_code == 200
    body = response.json()
    expected = rows[:1] if keyword == "alpha" else rows[:2]
    assert body["total"] == len(expected)
    assert {row["id"] for row in body["items"]} == {row["id"] for row in expected}


def test_job_filter_combines_with_keyword_and_leaves_unbound_rows_visible(client, records):
    jobs, rows = records
    body = client.get("/api/external-resumes", params={"job_id": jobs[0].id}).json()
    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {row["id"] for row in rows[:2]}
    body = client.get(
        "/api/external-resumes", params={"job_id": jobs[1].id, "keyword": "ByteDance"}
    ).json()
    assert body["total"] == 0 and body["items"] == []
    unfiltered = client.get("/api/external-resumes").json()
    assert unfiltered["total"] == 4
    assert rows[-1]["id"] in {row["id"] for row in unfiltered["items"]}


def test_deleted_job_does_not_match_but_its_resume_remains_searchable(client, db_session, records):
    jobs, rows = records
    jobs[0].deleted_at = datetime.now()
    db_session.commit()
    assert client.get("/api/external-resumes", params={"keyword": "ByteDance"}).json()["total"] == 0
    body = client.get("/api/external-resumes", params={"keyword": "alpha"}).json()
    assert body["total"] == 1 and body["items"][0]["id"] == rows[0]["id"]
    assert body["items"][0]["job_title"] == ""


def test_search_is_applied_before_the_first_hundred_limit(client, db_session, records):
    _, rows = records
    db_session.add_all(
        [
            ExternalResume(
                file_id=rows[0]["file_id"], name=f"recent-{index}.txt", text="body", text_chars=4
            )
            for index in range(101)
        ]
    )
    db_session.commit()
    unfiltered = client.get("/api/external-resumes", params={"page_size": 100}).json()
    assert unfiltered["total"] == 105 and len(unfiltered["items"]) == 100
    assert rows[0]["id"] not in {row["id"] for row in unfiltered["items"]}
    filtered = client.get(
        "/api/external-resumes", params={"page_size": 100, "keyword": "ByteDance"}
    ).json()
    assert filtered["total"] == 2 and len(filtered["items"]) == 2


@pytest.mark.parametrize("job_id", [0, -1])
def test_job_id_requires_a_positive_value(client, job_id):
    assert client.get("/api/external-resumes", params={"job_id": job_id}).status_code == 422

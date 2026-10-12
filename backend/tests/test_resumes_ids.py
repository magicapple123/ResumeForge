"""``GET /api/resumes/ids``：当前筛选下全部简历 id（不分页），跨页全选用。

对齐 ``GET /api/jobs/ids`` 的既有测试写法（test_api_jobs.py）：与列表同一份
筛选器，keyword/favorite/has_job/job_id 命中集合一致且回收站里的不算。
"""

from app.models.resume import ResumeRecord


def _seed_resume(db_session, *, title: str, keyword_text: str = "", favorite: bool = False):
    record = ResumeRecord(
        title=title,
        company="示例科技",
        content={"summary": keyword_text},
        favorite=favorite,
    )
    db_session.add(record)
    db_session.commit()
    return record.id


def test_resume_ids_matches_list_filter_across_pages(client, db_session):
    """``/resumes/ids`` 与 ``/resumes`` 是同一份筛选器：不分页返回全部匹配 id。"""
    first = _seed_resume(db_session, title="后端简历", keyword_text="Python 八股")
    second = _seed_resume(db_session, title="前端简历", keyword_text="React 简历")

    all_ids = client.get("/api/resumes/ids").json()
    assert set(all_ids) == {first, second}

    # 与列表同筛选：keyword 命中一条就只返回那一条，且与列表的 total 一致。
    filtered_list = client.get("/api/resumes", params={"keyword": "后端"}).json()
    filtered_ids = client.get("/api/resumes/ids", params={"keyword": "后端"}).json()
    assert filtered_ids == [filtered_list["items"][0]["id"]]
    assert len(filtered_ids) == filtered_list["total"] == 1

    # favorite / has_job 与列表同口径。
    favorite_id = _seed_resume(db_session, title="收藏简历", favorite=True)
    assert client.get("/api/resumes/ids", params={"favorite": True}).json() == [favorite_id]
    # 同秒创建时按 created_at desc、id desc 兜底排序，这里只关心集合。
    assert set(client.get("/api/resumes/ids", params={"favorite": False}).json()) == {
        first,
        second,
    }
    generic_id = _seed_resume(db_session, title="通用简历")
    has_job_ids = client.get("/api/resumes/ids", params={"has_job": False}).json()
    assert set(has_job_ids) >= {generic_id}

    # 回收站里的简历不算：软删除后不再被全选命中。
    client.delete(f"/api/resumes/{second}")
    remaining = client.get("/api/resumes/ids").json()
    assert second not in remaining
    assert first in remaining

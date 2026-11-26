# SPDX-License-Identifier: Apache-2.0
"""``GET /api/external-resumes`` 的接口契约：``include_general``（T6）与 ``sort``/``order``（T09）。

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
from app.services import external_resumes as service


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


# ── 服务端排序（T09 / R9-3）─────────────────────────────────────────────
#
# 三条硬要求：
# 1. `name` / `job_title` 走 `rf_pinyin`：SQLite 默认的 BINARY collation 按 UTF-8
#    **字节**比较，ASCII 名永远排在中文前面（"Alice" 第一、"张三" 沉底），中文之间
#    又按码点（"张" U+5F20 > "李" U+674E 的实际位次与拼音相反）。不测拼音就守不住
#    "按名字排"这件事本身；
# 2. 默认 `created_at desc`：不传参数的老调用方行为逐字不变；
# 3. 非法值不 500：`sort` / `order` 在接口层是 Literal，由 FastAPI 直接 422。

#: 名字 → 正文。正文长度刻意做成 短 < 中 < 长，`text_chars` 才有唯一顺序可断言。
_NAME_CASES = (
    ("张三.txt", "短"),
    ("Alice.txt", "中等篇幅"),
    ("李四.txt", "最长的一份正文内容"),
)


@pytest.fixture
def named_records(client):
    """三份名字/字数都不同的外部简历（拼音序：Alice < 李四 < 张三）。"""
    rows = []
    for name, body in _NAME_CASES:
        response = client.post(
            "/api/external-resumes",
            files={"file": (name, body.encode(), "text/plain")},
        )
        assert response.status_code == 201, response.text
        rows.append(response.json())
    return rows


def _names(client, **params) -> list[str]:
    return [
        row["name"] for row in client.get("/api/external-resumes", params=params).json()["items"]
    ]


def test_sort_name_asc_is_pinyin_order(client, named_records):
    """拼音序而不是字节序：ASCII 的 Alice 在前，中文按 li < zhang 排。"""
    assert _names(client, sort="name", order="asc") == ["Alice.txt", "李四.txt", "张三.txt"]


def test_sort_name_desc_reverses_it(client, named_records):
    assert _names(client, sort="name", order="desc") == ["张三.txt", "李四.txt", "Alice.txt"]


def test_sort_text_chars_follows_the_extracted_length(client, named_records):
    """字数也下推 SQL：前端只能排到当页，翻页就会看到"排好的顺序又乱了"。"""
    by_chars = [
        row["text_chars"]
        for row in client.get(
            "/api/external-resumes", params={"sort": "text_chars", "order": "asc"}
        ).json()["items"]
    ]
    assert by_chars == sorted(by_chars)
    assert _names(client, sort="text_chars", order="desc") == ["李四.txt", "Alice.txt", "张三.txt"]


def _id_by_name(rows, name: str) -> int:
    return next(int(row["id"]) for row in rows if row["name"] == name)


def test_sort_job_title_puts_unbound_rows_first(client, named_records, db_session):
    """岗位列：没有关联岗位的行 `coalesce` 成空串，排在两个岗位之前。"""
    db_session.add_all([Job(title="Alpha 岗"), Job(title="Beta 岗")])
    db_session.commit()
    alpha, beta = (
        int(db_session.query(Job).filter(Job.title == title).one().id)
        for title in ("Alpha 岗", "Beta 岗")
    )
    # 李四 → Beta，Alice → Alpha，张三 保持不关联。
    for name, job_id in [("李四.txt", beta), ("Alice.txt", alpha)]:
        response = client.patch(
            f"/api/external-resumes/{_id_by_name(named_records, name)}", json={"job_id": job_id}
        )
        assert response.status_code == 200, response.text
    assert _names(client, sort="job_title", order="asc") == ["张三.txt", "Alice.txt", "李四.txt"]


def test_default_sort_is_created_at_desc(client, named_records):
    """不传参数 = 改造前的行为：最近上传在前（`created_at desc, id desc`）。"""
    ids = [row["id"] for row in client.get("/api/external-resumes").json()["items"]]
    assert ids == sorted(ids, reverse=True)


@pytest.mark.parametrize(
    "params",
    [{"sort": "title"}, {"order": "up"}, {"sort": "name", "order": "sideways"}, {"sort": ""}],
)
def test_invalid_sort_values_are_422_not_500(client, params):
    """白名单之外的值必须被挡在服务层外面：500 会把"参数写错"演成"服务挂了"。"""
    assert client.get("/api/external-resumes", params=params).status_code == 422


# ── 上传 MIME 归一（T09 / R10）─────────────────────────────────────────


def test_octet_stream_is_resolved_from_the_file_name(client):
    """Windows 拿 `application/octet-stream` 敷衍 `.md`：落库前按扩展名猜一次。"""
    response = client.post(
        "/api/external-resumes",
        files={"file": ("note.md", b"# Title\n\nBody", "application/octet-stream")},
    )
    assert response.status_code == 201, response.text
    assert response.json()["mime"] == "text/markdown"


def test_resolve_mime_keeps_a_precise_browser_type():
    """浏览器给的精确值比 guess_type 更可信；猜不到就承认猜不到，别编一个类型。"""
    assert service.resolve_mime("note.txt", "text/plain; charset=utf-8") == "text/plain"
    assert service.resolve_mime("a.unknownext", service.OCTET_STREAM) == service.OCTET_STREAM

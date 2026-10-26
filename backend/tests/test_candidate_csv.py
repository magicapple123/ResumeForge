# SPDX-License-Identifier: Apache-2.0
"""备选岗位 CSV 导入/导出与跨页全选（/ids）：列集往返、逐行报错、重复跳过。"""

from app.services.candidate_jobs import stage_candidate_job

_HEADERS = "岗位名称,公司名称,岗位链接,招聘原文,备注"


def _csv(*lines: str) -> str:
    return "\n".join((_HEADERS, *lines)) + "\n"


def _stage_candidate(db_session, **overrides):
    data = {
        "title": "后端开发",
        "company": "示例科技",
        "location": "天津",
        "salary": "20-30K",
        "source_url": "https://example.com/1",
        "description": "岗位职责：负责后端服务。",
        "source": "粘贴文本",
    }
    data.update(overrides)
    candidate = stage_candidate_job(db_session, **data)
    db_session.commit()
    return candidate


def test_export_roundtrip_preserves_fields(client, db_session):
    """导出的文件不改列名就能原样导回：列名与添加表单一致、字段值来回一致。"""
    _stage_candidate(db_session)
    db_session.commit()

    export = client.post("/api/candidate-jobs/csv/export", json={"candidate_ids": [1]})
    assert export.status_code == 200, export.text
    assert export.headers["content-type"].startswith("text/csv")
    # 表头与手动添加表单同字段名；带 BOM（Excel 直开不乱码）。
    text = export.content.decode("utf-8-sig")
    assert text.splitlines()[0] == _HEADERS
    assert export.content.startswith(b"\xef\xbb\xbf")

    rows, errors = parse_rows(text)
    assert errors == []
    assert rows[0][1]["title"] == "后端开发"
    assert rows[0][1]["source_url"] == "https://example.com/1"
    assert rows[0][1]["raw_text"].startswith("岗位职责")
    # 地点/薪资已从候选 CSV 列集移除（备选阶段不分那么细）。
    assert "工作地点" not in text and "薪资范围" not in text


def test_export_flattens_newlines(client, db_session):
    """招聘原文（description 落到 raw_text 列）里的换行折叠成空格：一条候选恰好一行。"""
    _stage_candidate(db_session, description="职责一\n职责二\n职责三")
    db_session.commit()

    export = client.post("/api/candidate-jobs/csv/export", json={"candidate_ids": [1]})
    text = export.content.decode("utf-8-sig")
    assert len(text.splitlines()) == 2  # 表头 + 一条候选
    assert "职责一 职责二 职责三" in text.splitlines()[1]


def test_export_accepts_full_selection_over_old_200_limit(client):
    """全选全部导出不再被旧的 200 条上限拦下（用户 420 条导出报 422 的回归钉）。

    420 个不存在的 id 应通过 schema 校验、走到"id 不存在"的 404；超过 5000 的新上限
    仍然拒绝。
    """
    over_old = client.post(
        "/api/candidate-jobs/csv/export", json={"candidate_ids": list(range(1, 421))}
    )
    assert over_old.status_code == 404, over_old.text
    over_new = client.post(
        "/api/candidate-jobs/csv/export", json={"candidate_ids": list(range(1, 5002))}
    )
    assert over_new.status_code == 422


def test_import_preview_reports_line_numbers(client):
    body = _csv(
        "后端开发,示例科技,https://example.com/9,职责：开发,内部推荐",
        "",
        ",缺名字的,,,,",
    )
    response = client.post(
        "/api/candidate-jobs/csv/import/preview",
        files={"file": ("candidates.csv", body.encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert [row["line"] for row in preview["rows"]] == [2]
    assert preview["errors"] == [{"line": 4, "message": "岗位名称不能为空", "code": "invalid"}]


def test_import_commit_creates_candidates_and_skips_duplicates(client, db_session):
    """提交导入逐行建候选（来源=CSV 导入）；同一文件导两次，第二次整批跳过。"""
    body = _csv(
        "后端开发,示例科技,https://example.com/9,职责：开发,内部推荐",
    )
    preview = client.post(
        "/api/candidate-jobs/csv/import/preview",
        files={"file": ("candidates.csv", body.encode("utf-8"), "text/csv")},
    ).json()
    assert len(preview["rows"]) == 1

    first = client.post("/api/candidate-jobs/csv/import", json={"rows": preview["rows"]})
    assert first.status_code == 200
    assert first.json() == {"imported": 1, "failed": []}

    again = client.post("/api/candidate-jobs/csv/import", json={"rows": preview["rows"]})
    assert again.json() == {
        "imported": 0,
        "failed": [{
            "line": 2,
            "message": "备选岗位里已有这一条，已跳过",
            "code": "duplicate",
        }],
    }

    listing = client.get("/api/candidate-jobs").json()
    created = next(item for item in listing if item["title"] == "后端开发")
    assert created["source"] == "CSV 导入"
    assert created["status"] == "pending"
    assert created["source_url"] == "https://example.com/9"


def test_import_rejects_non_http_links(client):
    """链接列必须是 http(s)：坏行进错误账目，好行照常导入。"""
    body = _csv(
        "后端开发,示例科技,,,,",
        "前端开发,另一家,javascript:alert(1),,",
    )
    response = client.post(
        "/api/candidate-jobs/csv/import/preview",
        files={"file": ("candidates.csv", body.encode("utf-8"), "text/csv")},
    )
    preview = response.json()
    assert [row["line"] for row in preview["rows"]] == [2]
    assert preview["errors"] == [{
        "line": 3,
        "message": "岗位链接必须以 http:// 或 https:// 开头",
        "code": "invalid",
    }]


def test_missing_title_column_is_a_header_error():
    from app.services.candidate_csv import parse_candidate_csv

    rows, errors = parse_candidate_csv("公司名称,工作地点\n示例科技,北京\n")
    assert rows == []
    assert errors == [{
        "line": 1,
        "message": "缺少「岗位名称」列，无法识别哪一列是岗位名",
        "code": "invalid",
    }]


def test_ids_matches_list_filter_across_pages(client, db_session):
    """``/ids`` 与分页列表同一份筛选器：不分页返回全部 id，抽屉跨页全选用。"""
    _stage_candidate(
        db_session,
        title="后端开发",
        source_url="https://example.com/1",
        description="岗位职责：负责后端服务。",
    )
    _stage_candidate(
        db_session,
        title="前端开发",
        source_url="https://example.com/2",
        description="岗位职责：负责前端页面。",
    )
    db_session.commit()

    all_ids = client.get("/api/candidate-jobs/ids").json()
    assert len(all_ids) == 2

    filtered = client.get("/api/candidate-jobs/ids", params={"keyword": "后端"}).json()
    assert len(filtered) == 1

    page_list = client.get(
        "/api/candidate-jobs/page", params={"keyword": "后端", "page_size": 100}
    ).json()
    assert page_list["total"] == 1
    assert filtered == [page_list["items"][0]["id"]]

    # 删除后不再被全选命中。
    only_id = filtered[0]
    client.delete(f"/api/candidate-jobs/{only_id}")
    remaining = client.get("/api/candidate-jobs/ids").json()
    assert only_id not in remaining
    assert len(remaining) == 1


def parse_rows(text: str):
    """复用后端解析器核对导出文本（与导入同一份映射）。"""
    from app.services.candidate_csv import parse_candidate_csv

    return parse_candidate_csv(text)

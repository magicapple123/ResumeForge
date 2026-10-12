"""岗位 CSV 导入/导出：列集来回一致、逐行报错、重复跳过、编码宽容。"""

from app.services.job.job_csv import decode_csv_bytes, parse_job_csv

_HEADERS = (
    "标题,公司,地点,薪资,职位类型,状态,来源,投递链接,发布时间,职位描述,任职要求,补充信息,备注,收藏"
)


def _csv(*lines: str) -> str:
    return "\n".join((_HEADERS, *lines)) + "\n"


def test_export_roundtrip_preserves_fields(client):
    """导出的文件改都不改就能原样导回：列集与取值来回一致。"""
    created = client.post(
        "/api/jobs",
        json={"title": "后端开发", "company": "示例科技", "origin_source": "内推"},
    )
    job_id = created.json()["id"]
    export = client.post("/api/jobs/export", json={"job_ids": [job_id]})
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    # BOM 在最前（Excel 直开不乱码）。
    assert export.content.startswith(b"\xef\xbb\xbf")

    text = export.content.decode("utf-8-sig")
    rows, errors = parse_job_csv(text)
    assert errors == []
    assert len(rows) == 1
    line, data = rows[0]
    assert line == 2
    assert data["title"] == "后端开发"
    assert data["company"] == "示例科技"
    assert data["origin_source"] == "内推"
    assert data["favorite"] == ""


def test_import_preview_reports_line_numbers(client):
    """预览不落库；错误行带文件真实行号；空行不报错。"""
    body = _csv(
        "后端开发,示例科技,,,,开放中,内推,https://x.com/1,,,,,,,,",
        "",
        ",某公司,,,,,,,,,,,,",
        "算法工程师,另一家,,,,已截止,招聘会,,,,,,,,",
    )
    response = client.post(
        "/api/jobs/import/preview",
        files={"file": ("jobs.csv", body.encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert len(preview["rows"]) == 2
    assert preview["rows"][0]["line"] == 2
    assert preview["rows"][0]["data"]["title"] == "后端开发"
    # 第 4 行缺标题：报错并给出行号（第 3 行是空行，跳过不算错）。
    assert preview["errors"] == [{"line": 4, "message": "标题不能为空"}]
    assert [row["line"] for row in preview["rows"]] == [2, 5]


def test_import_commit_creates_jobs_and_skips_duplicates(client):
    """提交导入逐行建岗；同一文件导两次，第二次整批按重复跳过。"""
    body = _csv(
        "后端开发,示例科技,,,,开放中,内推,https://x.com/1,,,,,,,,",
        "算法工程师,另一家,,,,不存在,,https://x.com/2,,,,,,,,",
    )
    preview = client.post(
        "/api/jobs/import/preview",
        files={"file": ("jobs.csv", body.encode("utf-8"), "text/csv")},
    ).json()
    # 预览阶段就把非法状态拦下，提交时只有干净的行。
    assert [row["data"]["title"] for row in preview["rows"]] == ["后端开发"]

    first = client.post("/api/jobs/import", json={"rows": preview["rows"]})
    assert first.status_code == 200
    assert first.json() == {"imported": 1, "failed": []}

    again = client.post("/api/jobs/import", json={"rows": preview["rows"]})
    assert again.json() == {
        "imported": 0,
        "failed": [{"line": 2, "message": "岗位广场已有这个岗位，已跳过"}],
    }

    listing = client.get("/api/jobs", params={"keyword": "后端开发"}).json()
    assert listing["total"] == 1
    assert listing["items"][0]["origin_source"] == "内推"
    # CSV 导入不冒充任何录入方式：recognition_source 留空，source 列保持模型默认。
    assert listing["items"][0]["recognition_source"] == ""


def test_import_rejects_empty_rows(client):
    response = client.post("/api/jobs/import", json={"rows": []})
    assert response.status_code == 422


def test_missing_title_column_is_a_header_error():
    rows, errors = parse_job_csv("公司,地点\n示例科技,北京\n")
    assert rows == []
    assert errors == [{"line": 1, "message": "缺少「标题」列，无法识别哪一列是岗位名"}]


def test_decode_prefers_utf8_and_falls_back_to_gbk():
    assert decode_csv_bytes("标题,公司\n".encode("utf-8-sig")).startswith("标题")
    assert decode_csv_bytes("标题,公司\n".encode("gbk")) == "标题,公司\n"
    try:
        decode_csv_bytes(b"\xff\xfe\x00h")
    except ValueError as exc:
        assert "编码" in str(exc)
    else:  # pragma: no cover - 防呆分支
        raise AssertionError("乱码字节应当报错")


def test_import_request_rows_shape_is_validated():
    import pytest
    from app.schemas.job import JobImportRequest

    assert JobImportRequest(rows=[{"line": 2, "data": {"title": "x"}}]).rows[0].line == 2
    # line 必须是正整数（账目里的行号来自文件真实行号）。
    with pytest.raises(Exception):  # noqa: B017 - pydantic 的 ValidationError 继承自 ValueError
        JobImportRequest(rows=[{"line": 0, "data": {}}])

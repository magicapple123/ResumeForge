# SPDX-License-Identifier: Apache-2.0
"""从链接导入的 HTTP 接口（#16C / #17A-F）：预览、补详情、导入、合并与 SSRF 拒绝。

全部离线：JobFetcher 用假实现替换（真实抓取在 test_web_import_ssrf 里由 MockTransport
覆盖），接口验证走 TestClient。
"""

from __future__ import annotations

import pytest
from app.api.job_import_url import router as from_url_router
from app.api.jobs import router as jobs_router
from app.database import get_db
from app.services.web_fetch import import_service
from app.services.web_fetch.errors import WebFetchError
from app.services.web_fetch.fetcher import FetchedPage, FetchedPages
from fastapi import FastAPI
from fastapi.testclient import TestClient

LIST_URL = "https://jobs.example.com/campus/position"
LIST_PAYLOAD = {
    "data": {
        "jobs": [
            {
                "jobTitle": "后端开发工程师",
                "cityName": "北京",
                "salaryDesc": "25-40K",
                "jobUrl": "/campus/position/1",
                "companyName": "示例科技",
            },
            {
                "jobTitle": "前端开发工程师",
                "cityName": "上海",
                "salaryDesc": "20-35K",
                "jobUrl": "/campus/position/2",
                "companyName": "示例网络",
            },
            {
                "jobTitle": "算法工程师",
                "cityName": "深圳",
                "salaryDesc": "30-50K",
                "jobUrl": "/campus/position/3",
                "companyName": "示例数据",
            },
        ]
    }
}


def _list_page() -> FetchedPage:
    return FetchedPage(
        url=LIST_URL,
        status_code=200,
        content_type="application/json",
        text="",
        engine="http",
        fetched_on="2026-11-11",
        json_payloads=[LIST_PAYLOAD],
    )


def _detail_page(url: str) -> FetchedPage:
    body = (
        "岗位职责\n"
        + "负责核心系统的设计与开发，保障线上稳定性。" * 15
        + "\n任职要求\n"
        + "熟悉 Python、MySQL 与分布式系统。" * 8
        + "\n福利待遇\n六险一金、免费三餐"
    )
    html = f"<html><body><div class='job-detail'>{body}</div></body></html>"
    from app.services.web_fetch.html_utils import html_to_text

    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=html_to_text(html),
        engine="http",
        fetched_on="2026-11-11",
        html=html,
    )


class FakeFetcher:
    """按 URL 返回预置页面；没预置的 URL 抛 WebFetchError。"""

    pages: dict[str, object] = {}
    calls: list[str] = []

    def __init__(self, _db=None, *, config=None) -> None:
        self.config = config

    def fetch(self, url: str, *, engine: str | None = None) -> FetchedPage:
        FakeFetcher.calls.append(url)
        value = FakeFetcher.pages.get(url)
        if value is None:
            raise WebFetchError("这个页面抓不到")
        if isinstance(value, Exception):
            raise value
        return value  # type: ignore[return-value]

    def fetch_pages(self, url: str, *, pages: int = 1, engine: str | None = None) -> FetchedPages:
        from app.services.web_fetch.fetcher import FetchedPages

        page = self.fetch(url, engine=engine)
        return FetchedPages(
            pages=(page,), pages_fetched=1, truncated=False, stop_reason="no_next", errors=()
        )


@pytest.fixture
def client(db_session):
    """只挂本模块路由的测试应用：注册行由主代理统一合入 application_routers.py。

    这里显式 include 同一个 router 对象，验的是真实路由/依赖/错误映射，而不是另写一份。
    """
    test_app = FastAPI()
    # 本模块路由先注册；再挂岗位路由，测试里才能用 /api/jobs 建/读岗位做合并断言。
    test_app.include_router(from_url_router)
    test_app.include_router(jobs_router)

    def override_get_db():
        yield db_session

    test_app.dependency_overrides[get_db] = override_get_db
    with TestClient(test_app, client=("127.0.0.1", 50000)) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _fake_fetch(monkeypatch):
    FakeFetcher.pages = {LIST_URL: _list_page()}
    FakeFetcher.calls = []
    monkeypatch.setattr(import_service, "JobFetcher", FakeFetcher)
    yield
    FakeFetcher.pages = {}
    FakeFetcher.calls = []


def _preview(client, **overrides):
    payload = {"url": LIST_URL, "engine": "auto", "limit": 0, "intent": "job_list"}
    payload.update(overrides)
    response = client.post("/api/jobs/import/from-url/preview", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_returns_editable_rows_with_states_and_source_urls(client):
    preview = _preview(client)
    assert preview["total"] == 3
    assert preview["method"] == "rules"
    assert preview["fetched_on"] == "2026-11-11"
    row = preview["rows"][0]
    assert row["data"]["title"] == "后端开发工程师"
    assert row["data"]["source_url"].endswith("/campus/position/1")
    assert row["detail_url"].endswith("/campus/position/1")
    assert row["field_states"]["title"] == "filled"
    # 详情字段还没抓：必须是 not_fetched（待补详情），不是页面未提供。
    assert row["field_states"]["description"] == "not_fetched"
    assert row["summary"]
    assert len(row["summary"]) <= 120


def test_preview_marks_existing_jobs(client):
    created = client.post(
        "/api/jobs",
        json={
            "title": "后端开发工程师",
            "company": "示例科技",
            "source_url": "https://jobs.example.com/campus/position/1",
        },
    )
    assert created.status_code == 201, created.text
    preview = _preview(client)
    first = preview["rows"][0]
    assert first["existing_job_id"] == created.json()["id"]
    assert preview["rows"][1]["existing_job_id"] is None


def test_preview_rejects_ssrf_url_without_leaking_internal_details(client):
    import_service.JobFetcher = import_service.JobFetcher  # 用真实 fetcher 走 SSRF 校验
    from app.services.web_fetch import fetcher as fetcher_module

    original = import_service.JobFetcher
    import_service.JobFetcher = fetcher_module.JobFetcher  # type: ignore[assignment]
    try:
        response = client.post(
            "/api/jobs/import/from-url/preview",
            json={"url": "http://127.0.0.1:8005/api/health"},
        )
    finally:
        import_service.JobFetcher = original  # type: ignore[assignment]
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "127.0.0.1" not in detail
    assert "8005" not in detail
    assert detail.strip()


def test_preview_limit_caps_rows(client):
    preview = _preview(client, limit=2)
    assert len(preview["rows"]) == 2
    assert preview["total"] == 2


def test_commit_creates_jobs_and_second_import_skips_everything(client):
    preview = _preview(client)
    first = client.post(
        "/api/jobs/import/from-url/commit",
        json={"rows": preview["rows"], "fill_empty_only": False},
    )
    assert first.status_code == 200, first.text
    assert first.json()["imported"] == 3
    assert first.json()["skipped"] == []

    second = client.post(
        "/api/jobs/import/from-url/commit",
        json={"rows": preview["rows"], "fill_empty_only": False},
    )
    outcome = second.json()
    assert outcome["imported"] == 0
    assert len(outcome["skipped"]) == 3
    listing = client.get("/api/jobs", params={"keyword": "工程师"}).json()
    assert listing["total"] == 3


def test_fill_empty_only_never_touches_user_notes_or_filled_fields(client):
    created = client.post(
        "/api/jobs",
        json={
            "title": "后端开发工程师",
            "company": "示例科技",
            "source_url": "https://jobs.example.com/campus/position/1",
            "note": "用户自己写的备注",
            "favorite": True,
            "location": "已填地点",
        },
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    rows = _preview(client)["rows"]
    row = next(item for item in rows if item["data"]["title"] == "后端开发工程师")
    outcome = client.post(
        "/api/jobs/import/from-url/commit",
        json={"rows": [row], "fill_empty_only": True},
    ).json()
    assert outcome["updated"] == 1
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["note"] == "用户自己写的备注"
    assert job["favorite"] is True
    assert job["location"] == "已填地点"  # 用户已填的字段不被覆盖
    assert job["salary"] == "25-40K"  # 库内为空的字段才补
    assert job["description"] == ""  # 未补详情：不写空值、不编造 JD
    assert job["note"] == "用户自己写的备注"
    assert job["status"] == "开放中"


def test_details_fills_fields_and_keeps_completed_rows_when_one_fails(client):
    rows = _preview(client)["rows"]
    urls = [row["detail_url"] for row in rows]
    FakeFetcher.pages[urls[0]] = _detail_page(urls[0])
    FakeFetcher.pages[urls[1]] = WebFetchError("这个详情页打不开")
    FakeFetcher.pages[urls[2]] = _detail_page(urls[2])
    response = client.post(
        "/api/jobs/import/from-url/details",
        json={"rows": rows, "page_url": LIST_URL},
    )
    assert response.status_code == 200, response.text
    data = response.json()["rows"]
    assert data[0]["field_states"]["description"] == "filled"
    assert data[0]["field_states"]["requirements"] == "filled"
    assert data[0]["jd_split"] is True
    # 中间一条失败：标 fetch_failed + 原因，不拖垮整批。
    assert data[1]["field_states"]["description"] == "fetch_failed"
    assert "打不开" in data[1]["detail_error"]
    # 已完成的行保留（中断/部分失败不回滚）。
    assert data[2]["field_states"]["description"] == "filled"


def test_details_without_detail_link_marks_fetch_failed(client):
    rows = _preview(client)["rows"][:1]
    rows[0]["detail_url"] = ""
    response = client.post(
        "/api/jobs/import/from-url/details",
        json={"rows": rows, "page_url": LIST_URL},
    )
    row = response.json()["rows"][0]
    assert row["field_states"]["description"] == "fetch_failed"
    assert "详情链接" in row["detail_error"]


def test_details_rejects_more_than_one_batch(client):
    rows = _preview(client)["rows"]
    too_many = rows + rows  # 6 条 > 每批上限 5
    response = client.post(
        "/api/jobs/import/from-url/details",
        json={"rows": too_many, "page_url": LIST_URL},
    )
    assert response.status_code == 422


def test_commit_rejects_empty_rows(client):
    response = client.post("/api/jobs/import/from-url/commit", json={"rows": []})
    assert response.status_code == 422


def test_commit_failed_row_never_echoes_internal_exception_text(db_session, monkeypatch):
    """单行失败只回固定文案：内部异常原文可能带表名/路径（CodeQL stack-trace-exposure）。

    根因修在服务层：`commit_rows` 的逐行容错此前把 `str(exc)` 放进响应的
    ``failed[].message``——"异常文本 → 响应"这条链就是 CodeQL 判的泄露。这里钉住：
    原文一个字都不许出现在结果里，行号 + 标题足够定位是哪一条。
    """
    leak = "INSERT INTO user_secret (path=/home/runner/.env) failed"

    def boom(*_args, **_kwargs):
        raise ValueError(leak)

    monkeypatch.setattr(import_service, "create_job_record", boom)
    result = import_service.commit_rows(db_session, [{"data": {"title": "后端开发"}}])

    assert result["imported"] == 0
    assert len(result["failed"]) == 1
    assert result["failed"][0]["message"] == "这一条导入失败"
    assert "user_secret" not in str(result)
    assert leak not in str(result)


def test_routes_are_registered_before_the_jobs_router():
    """注册行由主代理合入 application_routers.py；这里钉住它不会静默漏掉、顺序不丢。"""
    from app.api import job_import_url, jobs
    from app.application_routers import ROUTERS

    assert job_import_url.router in ROUTERS
    assert ROUTERS.index(job_import_url.router) < ROUTERS.index(jobs.router)

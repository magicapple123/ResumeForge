"""浏览器跨站防线（LoopbackOriginGuardMiddleware）与 pick 端点回环校验的边界测试。

成功路径的写端点刻意选「保存搜索设置」（PUT /api/settings/search）这类无害操作；
退出接口（POST /api/system/shutdown）**只在 403 用例里出现**——中间件会短路请求、
端点根本不执行，同时把 ``_stop_process`` 替换成记录用的空函数兜底，就算防线回归
失效也不会真的把测试进程关掉。
"""
from app.api import system as system_api
from app.database import SessionLocal, get_db
from app.main import app
from fastapi.testclient import TestClient

# 合法的搜索设置请求体：PUT /api/settings/search 的正常载荷。
_SEARCH_PAYLOAD = {"sources": ["bing"], "searxng_url": "", "fetch_pages": 0, "max_results": 8}


def _override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_cross_origin_post_to_shutdown_is_rejected_before_the_endpoint(monkeypatch):
    """跨源网页对退出接口的 POST 必须被 403 短路。

    403 由中间件返回（detail 是防线的文案而非端点的），证明请求没到端点；同时替换
    停止线程入口兜底——万一防线回归失效，测试也只是断言失败，而不是真被关停。
    """
    calls: list[str] = []
    monkeypatch.setattr(system_api, "_stop_process", lambda: calls.append("stopped"))
    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app, client=("127.0.0.1", 50000)) as client:
            response = client.post(
                "/api/system/shutdown", headers={"Origin": "https://evil.example"}
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert "跨站" in response.json()["detail"]
    assert calls == []


def test_loopback_dev_origin_write_is_allowed(client):
    """dev 拓扑：Vite 代理透传 `Origin: http://localhost:5173`，host 是回环 → 放行。"""
    response = client.put(
        "/api/settings/search",
        json=_SEARCH_PAYLOAD,
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code != 403
    assert response.status_code == 200


def test_write_without_origin_is_allowed(client):
    """curl / 启动器 / TestClient 没有 Origin 头：方案 B 明确放行，不做白名单。"""
    response = client.put("/api/settings/search", json=_SEARCH_PAYLOAD)

    assert response.status_code != 403
    assert response.status_code == 200


def test_sec_fetch_site_cross_site_without_origin_is_rejected(client):
    """浏览器在重定向等场景可能剥掉 Origin，但会带 `Sec-Fetch-Site: cross-site`。

    用无害的 llm/records 端点验证：即便防线失效，代价只是多一条配置记录。
    """
    response = client.post(
        "/api/settings/llm/records",
        json={"name": "test", "provider": "openai", "api_key": "sk-test", "model": "gpt"},
        headers={"Sec-Fetch-Site": "cross-site"},
    )

    assert response.status_code == 403
    assert "跨站" in response.json()["detail"]


def test_get_with_evil_origin_is_allowed(client):
    """GET 全部放行：健康检查、静态资源与 SSE 流式响应不受防线影响。"""
    response = client.get("/api/settings/llm", headers={"Origin": "https://evil.example"})

    assert response.status_code != 403
    assert response.status_code == 200


def test_production_same_origin_and_loopback_origin_variants_are_allowed(client):
    """生产同源（127.0.0.1:8005）与回环 host 的写请求都要放行。"""
    for origin in (
        "http://127.0.0.1:8005",
        "http://localhost:9999",
        "http://[::1]:5173",
    ):
        response = client.put(
            "/api/settings/search", json=_SEARCH_PAYLOAD, headers={"Origin": origin}
        )
        assert response.status_code != 403, origin
        assert response.status_code == 200, origin


def test_malformed_or_null_origin_is_rejected(client):
    """带 Origin 的都是浏览器：解析不出 host 的畸形 Origin / `null` 一律按非回环 403。"""
    for origin in ("null", "not-a-url"):
        response = client.put(
            "/api/settings/search", json=_SEARCH_PAYLOAD, headers={"Origin": origin}
        )
        assert response.status_code == 403, origin


def test_pick_folder_rejects_non_loopback_clients():
    """pick 端点会弹原生模态对话框：非回环直连（含跨站借道浏览器）一律 403。"""

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, client=("192.0.2.1", 50001)) as remote:
            response = remote.post("/api/settings/export-save-location/pick")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert "本机" in response.json()["detail"]


def test_pick_folder_allows_loopback_clients(client, monkeypatch):
    """回环直连时 pick 端点照常工作（monkeypatch 掉真弹窗，只验校验放行）。"""
    monkeypatch.setattr(
        "app.api.settings.pick_directory", lambda: "C:/picked/folder"
    )

    response = client.post("/api/settings/export-save-location/pick")

    assert response.status_code == 200
    assert response.json() == {"path": "C:/picked/folder"}

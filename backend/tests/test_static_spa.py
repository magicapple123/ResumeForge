# SPDX-License-Identifier: Apache-2.0
"""RF-09 方案 A：后端同源提供前端生产静态资产（static_spa）。

覆盖：SPA 回退语义矩阵、缓存头、安全头仅静态路径、/health 与 SSE 头不受
影响、版本配对三分支（一致 / 不一致 / 缺失）。
"""

import json
import logging

import pytest
from app.static_spa import mount_static_spa
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

HTML_ACCEPT = {"accept": "text/html,application/xhtml+xml"}


def build_dist(tmp_path, *, version=None):
    """在 tmp_path 下伪造一份最小 dist：index.html + 一个内容哈希命名的资产。"""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>spa-entry</body></html>", encoding="utf-8"
    )
    (dist / "assets" / "entry-abc123.js").write_text("console.log(1);", encoding="utf-8")
    if version is not None:
        (dist / "version.json").write_text(json.dumps({"version": version}), encoding="utf-8")
    return dist


def build_app(dist, *, app_version="0.18.0") -> FastAPI:
    app = FastAPI(version=app_version)

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    @app.post("/api/echo")
    def echo():
        return {"ok": True}

    @app.get("/api/stream-probe")
    def stream_probe():
        async def gen():
            yield b"data: hi\n\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    mount_static_spa(app, dist)
    return app


def use(app) -> TestClient:
    return TestClient(app)


def test_missing_dist_keeps_pure_api_mode(tmp_path):
    app = build_app(tmp_path / "no-such-dist")
    client = use(app)
    r = client.get("/api/ping")
    assert r.status_code == 200
    # 没有静态资产就没有回退路由：根路径按未找到处理，而不是 500 或页面。
    assert client.get("/", headers=HTML_ACCEPT).status_code == 404


def test_root_serves_index_html_with_cache_and_security_headers(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert "spa-entry" in r.text
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"


def test_deep_link_falls_back_to_index_html(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/settings/some/deep/link", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert "spa-entry" in r.text


def test_post_never_falls_back(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.post("/anything", headers=HTML_ACCEPT)
    assert r.status_code == 404
    assert "spa-entry" not in r.text


def test_unknown_api_path_never_falls_back(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/api/does-not-exist", headers=HTML_ACCEPT)
    assert r.status_code == 404
    assert "detail" in r.json()


def test_method_mismatch_on_registered_api_path_returns_405(tmp_path):
    """回归闸门（QA R1）：路径已注册但方法不对必须 405，不能被 SPA 页面吞成 404。

    dist 存在时 GET 一个仅 POST 的 /api 路由——catch-all 实现会把它吞成 404
    （FULL match 抢在 partial-match 405 之前），404 处理器实现则天然保留 405。
    """
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/api/echo", headers=HTML_ACCEPT)  # /api/echo 仅 POST
    assert r.status_code == 405
    assert "spa-entry" not in r.text


def test_method_mismatch_outside_api_returns_405(tmp_path):
    """同上，但路径在 /api 之外——证明 405 语义不依赖 /api 前缀守卫。

    故意把路由注册在 mount_static_spa **之后**：404 处理器机制与注册顺序无关。
    """
    app = build_app(build_dist(tmp_path))

    @app.post("/tools/convert")
    def convert():
        return {"ok": True}

    client = use(app)
    r = client.get("/tools/convert", headers=HTML_ACCEPT)
    assert r.status_code == 405
    assert "spa-entry" not in r.text


def test_health_prefix_never_falls_back(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    # /health 不是本应用的注册路由（真实路由是 /api/health），回退守卫必须
    # 把它按 404 处理而不是当成一个前端深链接。
    assert client.get("/health", headers=HTML_ACCEPT).status_code == 404


def test_api_routes_take_priority_and_stay_clean(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/api/ping", headers=HTML_ACCEPT)
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    # /api 响应不加安全头，也不加缓存头——既有响应头一律不动。
    assert "x-content-type-options" not in r.headers
    assert "x-frame-options" not in r.headers
    assert "cache-control" not in r.headers


def test_docs_and_openapi_unaffected(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_non_html_accept_gets_404_not_index(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/some-page", headers={"accept": "application/json"})
    assert r.status_code == 404
    assert "spa-entry" not in r.text


def test_existing_asset_served_with_immutable_cache(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/assets/entry-abc123.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_missing_asset_returns_404_not_index(tmp_path):
    app = build_app(build_dist(tmp_path))
    client = use(app)
    r = client.get("/assets/missing-0000.js", headers=HTML_ACCEPT)
    assert r.status_code == 404
    assert "spa-entry" not in r.text


def test_sse_stream_headers_untouched(tmp_path):
    """/api 下的 SSE 流既有头（Cache-Control: no-cache 等）不被中间件改动。"""
    app = build_app(build_dist(tmp_path))

    client = use(app)
    with client:
        r = client.get("/api/stream-probe")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    assert "x-content-type-options" not in r.headers


def test_version_pairing_matching_version_no_error(tmp_path, caplog):
    app = build_app(build_dist(tmp_path, version="0.18.0"), app_version="0.18.0")
    with caplog.at_level(logging.ERROR, logger="app.static_spa"):
        use(app)
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_version_pairing_mismatch_logs_error_but_app_works(tmp_path, caplog):
    app = build_app(build_dist(tmp_path, version="0.19.0"), app_version="0.18.0")
    with caplog.at_level(logging.ERROR, logger="app.static_spa"):
        client = use(app)
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert errors, "版本不一致必须记 ERROR 日志"
    assert "0.19.0" in errors[0].getMessage()
    # ERROR 只是告警，不阻断：应用仍然可用。
    assert client.get("/", headers=HTML_ACCEPT).status_code == 200


def test_version_pairing_missing_file_is_debug_only(tmp_path, caplog):
    app = build_app(build_dist(tmp_path, version=None), app_version="0.18.0")
    with caplog.at_level(logging.DEBUG, logger="app.static_spa"):
        use(app)
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


@pytest.mark.parametrize("payload", [b"not json", b'{"nope": 1}'])
def test_version_pairing_unparsable_file_does_not_break_startup(tmp_path, payload):
    dist = build_dist(tmp_path)
    (dist / "version.json").write_bytes(payload)
    app = build_app(dist, app_version="0.18.0")
    client = use(app)
    assert client.get("/", headers=HTML_ACCEPT).status_code == 200


def test_dist_root_file_served_with_headers(tmp_path):
    """dist 根目录散文件（favicon 等 public/ 资产）由后端直接服务。

    回归背景：favicon 在 dist 根而非 /assets 下，之前 404 导致浏览器
    标签页永远显示默认地球图标。
    """
    dist = build_dist(tmp_path)
    (dist / "resumeforge-icon.png").write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    client = use(app)
    r = client.get("/resumeforge-icon.png")
    assert r.status_code == 200
    assert r.content == b"\x89PNG-fake-icon"
    assert r.headers["content-type"].startswith("image/png")
    # 文件名无内容哈希：no-cache + ETag 协商重验，而不是 immutable。
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_dist_root_file_missing_stays_404_for_non_html(tmp_path):
    dist = build_dist(tmp_path)
    app = build_app(dist)
    client = use(app)
    r = client.get("/resumeforge-icon.png", headers={"accept": "*/*"})
    assert r.status_code == 404
    assert "spa-entry" not in r.text


def test_dist_root_method_mismatch_returns_405(tmp_path):
    """根文件路由是 FULL match：方法不对必须 405，不被回退吞成 404（QA R1）。"""
    dist = build_dist(tmp_path)
    (dist / "resumeforge-icon.png").write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    client = use(app)
    r = client.post("/resumeforge-icon.png", headers=HTML_ACCEPT)
    assert r.status_code == 405
    assert "spa-entry" not in r.text


def test_version_json_at_dist_root_is_served_too(tmp_path):
    dist = build_dist(tmp_path, version="0.18.0")
    app = build_app(dist)
    client = use(app)
    r = client.get("/version.json")
    assert r.status_code == 200
    assert r.json() == {"version": "0.18.0"}


def test_index_html_not_shadowed_by_root_file_routes(tmp_path):
    """index.html 不注册为根文件路由：/ 与深链接仍走 SPA 回退。"""
    dist = build_dist(tmp_path)
    (dist / "resumeforge-icon.png").write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    client = use(app)
    for path in ("/", "/some/deep/link"):
        r = client.get(path, headers=HTML_ACCEPT)
        assert r.status_code == 200
        assert "spa-entry" in r.text


# 浏览器只执行 MIME 为 JavaScript 的 ES module。Windows 注册表把 `.mjs` 记成
# `text/plain`，`FileResponse` 照抄 `mimetypes.guess_type()`，pdfjs 的 worker 因此
# 被拒（「导出图片」失败在 fake worker 上）。这条守卫钉住"服务端必须自己定 MIME"。
_JS_MIME_TYPES = ("text/javascript", "application/javascript", "application/ecmascript")


@pytest.mark.parametrize("name", ["pdf.worker.min-CjEcRF4W.mjs", "entry-abc123.js"])
def test_assets_are_served_with_a_javascript_mime_type(tmp_path, name):
    dist = build_dist(tmp_path)
    (dist / "assets" / name).write_text("export const x = 1;", encoding="utf-8")
    app = build_app(dist)
    client = use(app)
    r = client.get(f"/assets/{name}")
    assert r.status_code == 200
    declared = r.headers["content-type"].split(";")[0].strip()
    assert declared in _JS_MIME_TYPES, f"{name} 被当成 {declared}，浏览器不会执行它"


# --- 审计 F1/A01：根文件路由的路径必须固定在闭包里 -------------------------------
#
# 原实现把路径写成处理函数的**带默认值形参**（`path: Path = file_path`），FastAPI 会
# 把它解释成同名查询参数，于是 `GET /resumeforge-icon.png?path=…` 就能读到任意文件；
# 而去掉默认值又会变成循环内的闭包晚绑定（所有路由指向最后一个文件）。下面四条
# 分别钉住这两件事和请求期的边界/缺失语义。


def test_each_root_file_serves_its_own_bytes(tmp_path):
    """多个根文件各自返回自己的内容——防闭包晚绑定回归。"""
    dist = build_dist(tmp_path)
    (dist / "a-icon.png").write_bytes(b"PNG-A-CONTENT")
    (dist / "b-icon.png").write_bytes(b"PNG-B-CONTENT")
    app = build_app(dist)
    client = use(app)
    assert client.get("/a-icon.png").content == b"PNG-A-CONTENT"
    assert client.get("/b-icon.png").content == b"PNG-B-CONTENT"


def test_root_file_query_parameters_cannot_change_the_response(tmp_path):
    """`?path=` / `?file=` 不能改变返回内容：路径不是查询参数，注入无从下手。"""
    dist = build_dist(tmp_path, version="0.18.0")
    (dist / "resumeforge-icon.png").write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    client = use(app)
    queries = (
        "?path=version.json",
        "?file=version.json",
        "?path=../../etc/passwd",
        "?path=/etc/passwd",
        "?path=assets/entry-abc123.js&file=version.json",
    )
    for query in queries:
        r = client.get("/resumeforge-icon.png" + query, headers={"accept": "*/*"})
        assert r.status_code == 200, query
        assert r.content == b"\x89PNG-fake-icon", query
        # 被指向的真实文件内容绝不能混进来。
        assert b"0.18.0" not in r.content, query
        assert b"console.log(1)" not in r.content, query


def test_root_file_routes_declare_no_query_parameters(tmp_path):
    """直接钉住处理函数签名：注册出来的路由不得带任何查询参数。"""
    dist = build_dist(tmp_path)
    (dist / "resumeforge-icon.png").write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    routes = [r for r in app.routes if getattr(r, "name", "") == "spa_root_file_resumeforge-icon"]
    assert routes, "dist 根文件必须注册为路由"
    assert routes[0].dependant.query_params == [], "根文件路由不允许声明任何查询参数"


def test_root_file_symlink_outside_dist_is_not_served(tmp_path):
    """越界文件不注册、也不服务：dist 内的符号链接指向 dist 外时拿不到内容。"""
    dist = build_dist(tmp_path)
    outside = tmp_path / "outside-secret.txt"
    outside.write_bytes(b"OUTSIDE-SECRET-BYTES")
    link = dist / "escape.txt"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        # Windows 上创建符号链接需要开发者模式或提权；两条边界（注册期跳过 +
        # 请求期 404）在代码里是同一份判定，这里只报告"本地无法验证"。
        pytest.skip("当前环境不允许创建符号链接，越界用例无法在本机验证")

    app = build_app(dist)
    client = use(app)
    r = client.get("/escape.txt", headers={"accept": "*/*"})
    assert r.status_code != 200
    assert b"OUTSIDE-SECRET-BYTES" not in r.content


def test_root_file_deleted_after_registration_returns_404(tmp_path):
    """注册后文件被删除：必须 404，而不是 FileResponse 的 RuntimeError(500)。"""
    dist = build_dist(tmp_path)
    icon = dist / "resumeforge-icon.png"
    icon.write_bytes(b"\x89PNG-fake-icon")
    app = build_app(dist)
    client = use(app)
    assert client.get("/resumeforge-icon.png").status_code == 200
    icon.unlink()
    r = client.get("/resumeforge-icon.png", headers={"accept": "*/*"})
    assert r.status_code == 404

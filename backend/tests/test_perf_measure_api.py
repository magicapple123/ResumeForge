# SPDX-License-Identifier: Apache-2.0
"""PR-17：性能测量工具（scripts/measure_api_perf.py）的资格测试。

审计 C-1 指出旧测量脚本用 ``create_all`` 建 fixture——没有 Alembic/FTS 派生
索引，列表吞吐与 FTS 搜索收益的数字都不可信。这组测试钉住修好后的工具：

1. fixture 用真实 Alembic head 建库（与 stress_seed 同一份 schema 实现），
   库内 ``alembic_version`` == 迁移链 head、``knowledge_fts`` 存在、知识库
   搜索的 EXPLAIN QUERY PLAN 命中 FTS；
2. CHECKS 清单里每个测点路径都对应真实注册的路由（404 检测）；
3. SLO 判定 fail-closed：超阈值/测量错误 → FAILED + 退出码非 0。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import inspect, text

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import measure_api_perf as perf  # noqa: E402 - 模块导入必须无副作用（见 docstring）

SMOKE_COUNTS = {"jobs": 12, "resumes": 3, "tracks": 12, "candidates": 2, "knowledge": 3}


def _alembic_head(engine) -> str:
    from alembic.script import ScriptDirectory
    from app.database_migrations import build_alembic_config

    config = build_alembic_config(engine)
    return str(ScriptDirectory.from_config(config).get_current_head())


@pytest.fixture()
def small_fixture(tmp_path):
    """一套小型真实-Alembic-head fixture 库（几秒内建好），测后清理。"""
    saved_env = {
        key: os.environ.get(key) for key in ("DATABASE_URL", "LOG_FILE_ENABLED", "PYTHONUTF8")
    }
    db_path = tmp_path / "perf-fixture" / "fixture.db"
    info = perf.build_fixture_database(db_path, SMOKE_COUNTS)
    try:
        yield db_path, info
    finally:
        info["engine"].dispose()
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_endpoint_routes_registered():
    """CHECKS 清单每个测点都命中真实注册路由；旧全量接口不进清单。"""
    from app.main import app

    terms = {"knowledge": "面试技巧", "job": "后端开发工程师"}
    endpoints = perf.resolve_endpoints(terms)
    assert len(endpoints) == len(perf.ENDPOINT_TEMPLATES)
    for endpoint in endpoints:
        assert perf.route_exists(app, endpoint["method"], endpoint["url"]), (
            f"测点 {endpoint['url']} 未注册在 app 上（404 会被当成测量样本）"
        )
    # 负样本：matcher 必须能识别未注册路径，否则上面的断言形同虚设。
    assert not perf.route_exists(app, "GET", "/api/definitely-not-a-route")
    # POST /api/jobs 是真实存在的创建端点，不能当负样本；DELETE /api/stats 才是。
    assert perf.route_exists(app, "POST", "/api/jobs")
    assert not perf.route_exists(app, "DELETE", "/api/stats")
    # 分页端点在清单里，旧全量端点不在（对照审计 C-3）。
    urls = {endpoint["url"] for endpoint in endpoints}
    assert any(url.startswith("/api/tracker/page") for url in urls)
    assert any(url.startswith("/api/tracker/stats") for url in urls)
    assert any(url.startswith("/api/knowledge/page") for url in urls)
    assert "/api/knowledge" not in {url.split("?")[0] for url in urls} or any(
        url.split("?")[0] == "/api/knowledge/page" for url in urls
    )


def test_fixture_uses_real_alembic_head_with_fts(small_fixture):
    """fixture 库内 alembic_version==head、FTS 表存在、搜索计划走 FTS。"""
    _db_path, info = small_fixture
    engine = info["engine"]
    assert info["schema_head"] == _alembic_head(engine)

    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == _alembic_head(engine)
    assert "knowledge_fts" in set(inspect(engine).get_table_names())

    terms = perf.derive_search_terms(engine)
    assert terms.get("knowledge"), "fixture 里应该有可用的知识库搜索词"
    validation = perf.validate_database(engine, terms)
    assert validation["alembic_head_matches"] is True
    assert validation["knowledge_fts_table"] is True
    assert validation["fts_search_plan_uses_fts"] is True
    assert any("knowledge_fts" in detail for detail in validation["fts_search_plan"])


def test_measure_endpoint_smoke(small_fixture):
    """measure_endpoint 端到端冒烟：预热/采样/SQL 捕获/错误率都在结果里。"""
    from app.database import get_db
    from app.main import app
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    _db_path, info = small_fixture
    engine = info["engine"]
    session_factory = sessionmaker(bind=engine)

    def _override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override
    try:
        client = TestClient(app, client=("127.0.0.1", 50000))
        result = perf.measure_endpoint(
            client,
            engine,
            "GET",
            "/api/knowledge/page?page=1&page_size=5",
            name="knowledge_page_smoke",
            warmup=1,
            samples=2,
        )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert "error" not in result, result.get("error")
    assert result["error_rate"] == 0
    assert result["samples"] == 2
    assert result["p50_ms"] >= 0 and result["p95_ms"] >= result["p50_ms"]
    assert result["query_count"] >= 1, "SQL 捕获应至少记录到一条语句"
    assert result["size_bytes"] > 0


def test_evaluate_slo_fail_closed():
    """超阈值 → FAILED；测量出错 → FAILED；退出码非 0。"""
    results = [
        {"name": "ok", "url": "/api/jobs?page=1&page_size=20", "p50_ms": 10.0, "p95_ms": 120.0},
        {"name": "slow", "url": "/api/tracker/page?page_size=20", "p50_ms": 200.0, "p95_ms": 999.0},
        {"name": "broken", "url": "/api/stats", "error": "HTTP 500: boom"},
    ]
    verdicts = perf.evaluate_slo(results, default_p95_ms=300.0)
    by_name = {verdict["name"]: verdict for verdict in verdicts}
    assert by_name["ok"]["status"] == "passed"
    assert by_name["slow"]["status"] == "failed"
    assert by_name["broken"]["status"] == "failed"
    assert perf.exit_code_for(verdicts) != 0
    assert perf.exit_code_for([v for v in verdicts if v["name"] == "ok"]) == 0


def test_percentile_nearest_rank_matches_spec():
    """30 个样本的 p95 = 第 ceil(0.95*30)=29 个值（口径钉住）。"""
    values = [float(i) for i in range(1, 31)]
    assert perf.percentile_nearest_rank(sorted(values), 95) == 29.0
    assert perf.percentile_nearest_rank(sorted(values), 50) == 15.0

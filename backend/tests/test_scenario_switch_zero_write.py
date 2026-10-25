# SPDX-License-Identifier: Apache-2.0
"""A2/§15.1：切换职业场景零业务写入（网络断言 + DB 差异双证据）。

前端已有"切换场景只写 sessionStorage、不产生任何写方法请求"的组件测试；这里补
**服务端侧**的第二份证据：UI 切换时实际会发的请求只有目录/列表两个 GET，执行它们
前后对全部业务表逐表做行级内容哈希，必须完全一致。

同时覆盖 §15.3 的日志边界：日志记录上下文版本（origin/id/revision/hash）与任务 id，
但不记录场景正文（名称）与就业状态。
"""

from __future__ import annotations

import hashlib
import json
import logging

import pytest
from app.application import app as fastapi_app
from app.database import Base, SessionLocal
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from sqlalchemy import select
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _business_tables_snapshot() -> dict[str, str]:
    """每张业务表：按主键排序的整行 JSON 的内容哈希（不含内部 sqlite 表）。"""
    db = SessionLocal()
    try:
        snapshot: dict[str, str] = {}
        for table in Base.metadata.sorted_tables:
            rows = [
                dict(row._mapping)
                for row in db.execute(select(table).order_by(*table.primary_key.columns))
            ]
            payload = json.dumps(rows, ensure_ascii=False, sort_keys=True, default=str)
            snapshot[table.name] = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return snapshot
    finally:
        db.close()


def _create_scenario(client, name: str):
    response = client.post(
        "/api/career-scenarios",
        json={
            "name": name,
            "config": {
                "purpose": "career_change",
                "career_stage": "experienced",
                "target_industries": ["制造业"],
                "target_function": "数据分析",
                "employment_status": "unemployed",
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_switching_scenarios_makes_no_business_writes(client):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _create_scenario(client, "场景一")
    _create_scenario(client, "场景二")
    assert (
        client.post(
            "/api/resumes/manual",
            json={"title": "已有简历", "content": {"name": "张三"}, "job_id": job["id"]},
        ).status_code
        == 201
    )

    before = _business_tables_snapshot()
    # 模拟一次 UI 场景切换会发出的全部请求：拉目录 + 拉已保存场景（多窗口/重开也重复拉）。
    for _ in range(3):
        assert client.get("/api/career-scenarios/catalog").status_code == 200
        assert client.get("/api/career-scenarios").status_code == 200
    after = _business_tables_snapshot()

    assert before == after
    # 双证据之一（网络层）：切换只会走这两个读端点；目录端点只有 GET，
    # 集合端点的 GET 与 POST（新建场景）同路径，本次调用的是 GET（DB 差异已证零写）。
    paths = fastapi_app.openapi()["paths"]
    assert set(paths["/api/career-scenarios/catalog"]) == {"get"}
    assert "get" in paths["/api/career-scenarios"]


def test_context_logging_records_version_hash_not_scenario_body(client, monkeypatch, caplog):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client, "秘密场景名")
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    with caplog.at_level(logging.INFO, logger="app.api.resumes.generate_routes"):
        started = client.post(
            "/api/resumes/generate/tasks",
            json={
                "job_id": job["id"],
                "options": {
                    "career_context": {
                        "scenario_id": scenario["id"],
                        "expected_revision": scenario["revision"],
                    }
                },
            },
        )
        assert started.status_code == 201, started.text
        final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    messages = [
        record.getMessage()
        for record in caplog.records
        if "简历生成上下文已冻结" in record.getMessage()
    ]
    assert messages, "冻结上下文时必须留下可检索的版本日志"
    line = messages[0]
    assert "transport=task" in line
    assert "task_id=" in line
    assert "context_sha256=" in line
    assert "scenario_id=" in line
    # 不记录场景正文（名称）与就业状态等私有信息。
    assert "秘密场景名" not in caplog.text
    assert "unemployed" not in line

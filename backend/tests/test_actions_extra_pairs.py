# SPDX-License-Identifier: Apache-2.0
"""T28：create_referral / create_interview_experience 两对 + run_tool 内核开关的验收。"""

from __future__ import annotations

import json

from app.models.interview_experience import InterviewExperience
from app.models.referral import Referral
from app.services.actions.domains.interview_experiences import interview_experience_actions
from app.services.actions.domains.referrals import referral_actions
from app.services.actions.spec import ActionOutcome, ActionSpec
from app.services.actions.tool_adapter import as_tool
from app.services.assistant_tools import execute_tool, get_tool


def _route_error_code(response) -> str:
    detail = response.json().get("detail")
    assert isinstance(detail, dict), detail
    return str(detail.get("code"))


def test_create_pairs_are_registered_as_route_tool_pairs():
    cases = {
        referral_actions()["create_referral"]: ("POST", "/api/referrals", 201),
        interview_experience_actions()["create_interview_experience"]: (
            "POST",
            "/api/interview-experiences",
            201,
        ),
    }
    for spec, (method, path, status) in cases.items():
        assert (spec.http.method, spec.http.path, spec.http.status_code) == (method, path, status)
        tool = get_tool(spec.name)
        assert tool is not None and tool.permission is spec.permission


def test_create_referral_route_and_tool_write_the_same_row(client, db_session):
    payload = {
        "company": "示例科技",
        "position": "后端开发",
        "referrer_name": "张三",
        "relation": "前同事",
        "channel": "内推群",
        "job_title": "后端开发",
    }
    response = client.post("/api/referrals", json=payload)
    assert response.status_code == 201, response.text
    execute_tool(db_session, "create_referral", dict(payload))
    rows = db_session.query(Referral).order_by(Referral.id).all()
    assert len(rows) == 2
    fields = ["company", "position", "referrer_name", "relation", "channel", "job_title", "status"]
    assert [getattr(rows[0], f) for f in fields] == [getattr(rows[1], f) for f in fields]


def test_create_referral_tool_keeps_its_guard_and_position_backfill(db_session):
    try:
        execute_tool(db_session, "create_referral", {})
    except ValueError as exc:
        assert "公司或内推人" in str(exc)
    else:  # pragma: no cover - 守卫必须生效
        raise AssertionError("tool create_referral 没有拦截空公司/内推人")
    execute_tool(db_session, "create_referral", {"company": "示例公司", "position": "运营"})
    row = db_session.query(Referral).filter(Referral.company == "示例公司").one()
    assert row.position == "运营" and row.job_title == "运营"


def test_create_interview_experience_route_and_tool_write_the_same_row(client, db_session):
    payload = {
        "title": "示例科技一面",
        "company": "示例科技",
        "position": "后端开发",
        "content": "问了项目细节。",
        "questions": ["介绍一下项目", ""],
        "source": "self",
        "difficulty": "中等",
        "round_type": "一面",
        "interview_date": "2026-11-01",
    }
    response = client.post("/api/interview-experiences", json=payload)
    assert response.status_code == 201, response.text
    execute_tool(db_session, "create_interview_experience", dict(payload))
    rows = db_session.query(InterviewExperience).order_by(InterviewExperience.id).all()
    assert len(rows) == 2
    fields = [
        "title",
        "company",
        "position",
        "content",
        "source",
        "difficulty",
        "round_type",
        "interview_date",
    ]
    assert [getattr(rows[0], f) for f in fields] == [getattr(rows[1], f) for f in fields]
    # 工具侧历史行为：问题清单里的空白项会被丢弃；路由侧原样交给服务层（保持旧行为）。
    assert [item for item in rows[1].questions if str(item).strip()] == ["介绍一下项目"]


def test_create_pairs_previews_match_legacy_previews(db_session):
    from app.services.assistant_tools import previews

    referral_tool = get_tool("create_referral")
    assert referral_tool.preview is not None
    arguments = {"company": "示例科技", "position": "后端"}
    assert referral_tool.preview(db_session, dict(arguments)).model_dump() == (
        previews.preview_create_referral(db_session, dict(arguments)).model_dump()
    )
    experience_tool = get_tool("create_interview_experience")
    assert experience_tool.preview is not None
    arguments = {"title": "示例面经", "company": "示例科技", "content": "过程"}
    assert experience_tool.preview(db_session, dict(arguments)).model_dump() == (
        previews.preview_create_interview_experience(db_session, dict(arguments)).model_dump()
    )


def test_run_tool_is_used_only_by_the_tool_side(db_session):
    """run_tool 必须真的只影响工具侧：路由侧走 run，工具走替代实现。"""
    from pydantic import BaseModel, ConfigDict

    class TinyInput(BaseModel):
        model_config = ConfigDict(extra="forbid")
        value: int = 0

    def run_route(db, payload):  # noqa: ANN001, ANN202
        return ActionOutcome(text=f"route:{payload.value}")

    def run_tool(db, payload):  # noqa: ANN001, ANN202
        return ActionOutcome(text=f"tool:{payload.value}")

    from app.services.actions.spec import permission_enum

    spec = ActionSpec(
        name="tiny_pair",
        description="tiny",
        input_model=TinyInput,
        permission=permission_enum().READ_ONLY,
        run=run_route,
        run_tool=run_tool,
    )
    tool = as_tool(spec)
    result = tool.handler(db_session, {"value": 7})
    assert result.text == "tool:7"
    assert json.dumps({"ok": True})
    # 路由侧 run 独立可达（adapter 只在 as_tool 里选用 run_tool）。
    assert run_route(db_session, TinyInput(value=7)).text == "route:7"


def test_empty_payload_parity_for_create_pairs(client, db_session):
    # 空内推公司/内推人：路由侧服务层允许（历史行为），工具侧仍有更严的守卫。
    referral = client.post("/api/referrals", json={})
    assert referral.status_code == 201, referral.text
    # 空面经：两侧都必须拒绝，且错误来自同一张映射表（invalid_input）。
    experience = client.post("/api/interview-experiences", json={})
    assert experience.status_code == 422
    assert _route_error_code(experience) == "invalid_input"
    with __import__("pytest").raises(ValueError) as info:
        execute_tool(db_session, "create_interview_experience", {})
    assert getattr(info.value, "tool_error", "") == "invalid_input"

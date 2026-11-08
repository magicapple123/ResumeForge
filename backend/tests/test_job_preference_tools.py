# SPDX-License-Identifier: Apache-2.0
"""求职偏好助手工具（期二 T12）：注册 / 预览 / 必走提案 / 审批执行来源。

四条核心性质：

1. 三个工具都经 ActionSpec 注册，权限 / preview / service_entry 正确；
2. 两个写工具登记进 policy.ALWAYS_PROPOSAL_TOOLS：writable=True（write_full）下仍生成提案，
   handler 一次都不跑（模型不能改自己的下一轮输入）；
3. 无确认时执行 user_stated 写入 → 抛错（来源约束不是摆设）；
4. 走「以后都这样」审批后，偏好行 source=user_stated 且 source_proposal_id 指向该提案
   （approve 端点先执行 handler 再 mark_executed，所以执行期提案状态是 approved）。
"""

from __future__ import annotations

import asyncio
import json

import pytest
from app.database import SessionLocal
from app.models.assistant import AssistantWriteProposal
from app.models.job_preference import (
    PREF_SOURCE_USER_EDITED,
    PREF_SOURCE_USER_STATED,
    PREF_STATE_SUPERSEDED,
)
from app.runtime import dataset_scope
from app.services import job_preference_service as service
from app.services.assistant.assistant_tool_exec import run_tool_call
from app.services.assistant_tools import _TOOLS, execute_tool, get_tool, proposal_store
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.authorization import approve_proposal, consume, reject_proposal
from app.services.assistant_tools.policy import ToolExecutionContext

_WRITE_TOOLS = ("create_job_preference", "update_job_preference")


def _ctx(writable: bool = False) -> ToolExecutionContext:
    return ToolExecutionContext(
        dataset_id=dataset_scope.current_dataset_id(),
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=writable,
    )


def _tool_call(name: str, arguments: dict) -> dict:
    return {"id": "call_pref_1", "function": {"name": name, "arguments": json.dumps(arguments)}}


def _seed_active(db, kind: str = "target_city", value=None):
    return service.upsert_preference(
        db, kind, ["杭州"] if value is None else value, source=PREF_SOURCE_USER_EDITED
    ).record


def _create_proposal(db, tool_name: str, arguments: dict):
    tool = get_tool(tool_name)
    assert tool is not None
    preview = tool.preview(db, arguments)
    return proposal_store.create(_ctx(), tool_name, arguments, preview, db=db)


@pytest.fixture(autouse=True)
def _clean_proposals():
    proposal_store.reset_store()
    yield
    proposal_store.reset_store()


# ===== 注册与权限 =====


def test_three_tools_are_registered_with_contract_metadata():
    tools = {tool.name: tool for tool in _TOOLS}
    expected = {
        "get_job_preferences": ToolPermission.READ_ONLY,
        "create_job_preference": ToolPermission.REVERSIBLE_WRITE,
        "update_job_preference": ToolPermission.REVERSIBLE_WRITE,
    }
    for name, permission in expected.items():
        tool = tools[name]
        assert tool.permission is permission
        assert tool.writes is permission.is_write
        assert tool.service_entry in {
            "job_preference_service.list_preferences",
            "job_preference_service.upsert_preference",
        }
    assert tools["get_job_preferences"].preview is None
    for name in _WRITE_TOOLS:
        assert tools[name].preview is not None
        assert tool_policy.requires_proposal(name, writable=True) is True
        assert name in tool_policy.ALWAYS_PROPOSAL_TOOLS
    # 既有两条不能被覆盖掉（集合是增量登记）。
    assert {"create_skill", "update_skill"} <= tool_policy.ALWAYS_PROPOSAL_TOOLS


def test_tool_schemas_expose_the_expected_parameters():
    create_schema = get_tool("create_job_preference").parameters
    assert set(create_schema["required"]) == {"kind", "value"}
    assert set(create_schema["properties"]) == {"kind", "value", "note"}
    update_schema = get_tool("update_job_preference").parameters
    assert set(update_schema["required"]) == {"pref_id", "value"}
    assert set(update_schema["properties"]) == {"pref_id", "value", "note"}
    assert get_tool("get_job_preferences").parameters["properties"] == {}


def test_write_full_still_turns_into_a_proposal(db_session):
    """write_full（writable=True）下仍走提案：ALWAYS_PROPOSAL_TOOLS 的核心验收。"""
    record = asyncio.run(
        run_tool_call(
            _tool_call("create_job_preference", {"kind": "target_city", "value": ["杭州"]}),
            None,
            SessionLocal,
            _ctx(writable=True),
        )
    )
    assert record["ok"] is True
    assert record["changed"] is False
    proposal = record["proposal"]
    assert proposal["status"] == "pending"
    assert proposal["preview"]["target"] == "求职偏好 · 城市"
    # handler 一次都没跑：库里没有偏好行。
    assert db_session.query(AssistantWriteProposal).count() == 1
    assert service.list_preferences(db_session) == []


def test_no_consent_preview_contains_before_and_after(db_session):
    _seed_active(db_session, value=["杭州"])
    record = asyncio.run(
        run_tool_call(
            _tool_call("create_job_preference", {"kind": "target_city", "value": ["北京"]}),
            None,
            SessionLocal,
            _ctx(writable=False),
        )
    )
    changes = record["proposal"]["preview"]["changes"]
    assert changes[0]["before"] == "杭州"
    assert changes[0]["after"] == "北京"
    assert record["proposal"]["preview"]["scope"] == "更新 1 项偏好"


# ===== 无来源写入必须抛错 =====


def test_direct_execution_without_proposal_is_rejected(db_session):
    """绕过提案直调 handler（受信调用方路径）：来源约束在服务层拒绝，库里零写入。"""
    with pytest.raises(ValueError, match="用户确认提案|已确认"):
        execute_tool(
            db_session,
            "create_job_preference",
            {"kind": "target_city", "value": ["杭州"]},
        )
    assert service.list_preferences(db_session) == []


def test_rejected_proposal_cannot_write_user_stated(db_session):
    proposal = _create_proposal(
        db_session, "create_job_preference", {"kind": "target_city", "value": ["杭州"]}
    )
    reject_proposal(proposal.proposal_id, db=db_session)
    tool = get_tool("create_job_preference")
    with pytest.raises(ValueError, match="来源提案|用户确认提案"):
        tool.handler(db_session, {"kind": "target_city", "value": ["杭州"]})
    assert service.list_preferences(db_session) == []


# ===== 「以后都这样」审批链路 =====


def test_approve_flow_writes_user_stated_with_the_proposal_id(client, db_session):
    arguments = {"kind": "target_city", "value": ["杭州", "上海"]}
    proposal = _create_proposal(db_session, "create_job_preference", arguments)
    db_session.commit()

    response = client.post(f"/api/assistant/write-proposals/{proposal.proposal_id}/approve")
    assert response.status_code == 200, response.text
    assert "已记住城市" in response.json()["summary"]

    db_session.expire_all()
    record = db_session.query(type(service.list_active_preferences(db_session)[0])).one()
    assert record.source == PREF_SOURCE_USER_STATED
    assert record.source_proposal_id == proposal.proposal_id
    assert record.value == ["杭州", "上海"]
    stored = (
        db_session.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal.proposal_id)
        .one()
    )
    assert stored.status == "executed"
    # 列表接口同源可见（source 是协议值，不是展示串）。
    listed = client.get("/api/job-preferences").json()
    assert listed["items"][0]["kind"] == "target_city"
    assert listed["items"][0]["source"] == PREF_SOURCE_USER_STATED
    assert listed["items"][0]["label"] == "城市"


def test_approve_flow_update_supersedes_old_version(client, db_session):
    old = _seed_active(db_session, value=["杭州"])
    arguments = {"pref_id": old.pref_id, "value": ["北京"]}
    proposal = _create_proposal(db_session, "update_job_preference", arguments)
    db_session.commit()

    response = client.post(f"/api/assistant/write-proposals/{proposal.proposal_id}/approve")
    assert response.status_code == 200, response.text
    db_session.expire_all()
    old_row = db_session.get(type(old), old.id)
    assert old_row is not None and old_row.state == PREF_STATE_SUPERSEDED
    current = service.active_pref(db_session, service.current_dataset_key(), "target_city")
    assert current is not None and current.value == ["北京"]
    assert current.source_proposal_id == proposal.proposal_id


def test_approved_but_not_executed_still_counts_as_consent(db_session):
    """approve 端点执行 handler 时提案状态是 approved（之后才 mark_executed）。"""
    proposal = _create_proposal(
        db_session, "create_job_preference", {"kind": "target_city", "value": ["杭州"]}
    )
    grant = approve_proposal(proposal.proposal_id, db=db_session)
    tool_name, stored = consume(proposal.proposal_id, grant["token"], db=db_session)
    assert tool_name == "create_job_preference"
    result = get_tool(tool_name).handler(db_session, stored)
    assert result.changed is True
    assert stored["kind"] == "target_city"


# ===== 读工具 =====


def test_get_job_preferences_reads_active_only(db_session):
    _seed_active(db_session, value=["杭州"])
    _seed_active(db_session, value=["北京"])  # 旧值转 superseded
    result = execute_tool(db_session, "get_job_preferences", {})
    assert "北京" in result.text
    assert "杭州" not in result.text  # superseded 不出现在工具结果里
    assert result.summary == "查看了 1 条求职偏好"

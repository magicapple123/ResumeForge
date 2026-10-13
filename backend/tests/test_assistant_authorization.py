"""RF-01 写入提案授权测试：一次性核销、参数绑定、数据集绑定、token 不进模型消息。"""

import pytest
from app.runtime import dataset_scope
from app.services.assistant_tools import _TOOLS, execute_tool
from app.services.assistant_tools import authorization as auth
from app.services.assistant_tools.authorization import (
    WritePreview,
    WriteProposalError,
    approve_proposal,
    consume,
    create_proposal,
    get_proposal,
    reject_proposal,
)
from app.services.assistant_tools.policy import ToolExecutionContext

_TARGET_TOOL = "create_reminder"


def _ctx(dataset_id: str = "main") -> ToolExecutionContext:
    # generation 取当前真实值（PR-03 起提案作用域同时绑定 id+generation，
    # 硬编码 1 会在同进程先前用例推进 generation 后失配）。
    return ToolExecutionContext(
        dataset_id=dataset_id,
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=False,
    )


def _preview() -> WritePreview:
    return WritePreview(target="日历提醒新提醒", scope="新增 1 条", changes=[])


@pytest.fixture(autouse=True)
def _clean_store():
    auth.reset_store()
    yield
    auth.reset_store()


def _proposal(arguments: dict | None = None):
    return create_proposal(
        _ctx(),
        _TARGET_TOOL,
        arguments or {"title": "复盘", "remind_at": "2026-10-12T10:00:00"},
        _preview(),
    )


def test_approve_then_consume_returns_the_stored_arguments():
    arguments = {"title": "复盘", "remind_at": "2026-10-12T10:00:00"}
    proposal = _proposal(arguments)
    assert proposal.status == "pending"
    grant = approve_proposal(proposal.proposal_id)
    assert grant["tool_name"] == _TARGET_TOOL
    tool_name, stored = consume(proposal.proposal_id, grant["token"])
    assert tool_name == _TARGET_TOOL
    assert stored == arguments
    final = get_proposal(proposal.proposal_id)
    assert final.status == "approved"  # consume 只烧 token；终态由 mark_executed 置


def test_consume_burns_the_token_exactly_once():
    proposal = _proposal()
    grant = approve_proposal(proposal.proposal_id)
    consume(proposal.proposal_id, grant["token"])
    with pytest.raises(WriteProposalError) as excinfo:
        consume(proposal.proposal_id, grant["token"])
    assert excinfo.value.status_code == 409


def test_double_approve_is_rejected():
    proposal = _proposal()
    approve_proposal(proposal.proposal_id)
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal(proposal.proposal_id)
    assert excinfo.value.status_code == 409


def test_rejected_proposal_cannot_be_approved():
    proposal = _proposal()
    reject_proposal(proposal.proposal_id)
    assert get_proposal(proposal.proposal_id).status == "rejected"
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal(proposal.proposal_id)
    assert excinfo.value.status_code == 409


def test_expired_proposal_cannot_be_approved(monkeypatch):
    monkeypatch.setattr(auth, "PROPOSAL_TTL_SECONDS", -1)
    proposal = _proposal()
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal(proposal.proposal_id)
    assert excinfo.value.status_code == 409


def test_token_mismatch_is_rejected():
    proposal = _proposal()
    approve_proposal(proposal.proposal_id)
    with pytest.raises(WriteProposalError) as excinfo:
        consume(proposal.proposal_id, "not-the-token")
    assert excinfo.value.status_code == 409


def test_cross_dataset_proposal_is_rejected(monkeypatch):
    proposal = _proposal()
    monkeypatch.setattr(
        "app.services.assistant_tools.authorization.dataset_scope.current_dataset_id",
        lambda: "0123456789abcdef",
    )
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal(proposal.proposal_id)
    assert excinfo.value.status_code == 409
    assert "数据集" in str(excinfo.value)


def test_unknown_proposal_is_404():
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal("deadbeef")
    assert excinfo.value.status_code == 404


def test_tampered_arguments_fail_the_digest_check():
    proposal = _proposal({"title": "复盘", "remind_at": "2026-10-12T10:00:00"})
    grant = approve_proposal(proposal.proposal_id)
    auth.verify_arguments(proposal.proposal_id, grant["arguments"])
    with pytest.raises(WriteProposalError):
        auth.verify_arguments(proposal.proposal_id, {"title": "被换掉的写入"})


def test_model_cannot_self_approve_without_a_proposal():
    """模型文本声称"用户已确认"产生不了任何授权：没有提案 id 就没有可批准对象。"""
    with pytest.raises(WriteProposalError) as excinfo:
        approve_proposal("model-invented-id")
    assert excinfo.value.status_code == 404


def test_stream_write_without_consent_becomes_a_proposal_not_an_execution(db_session, monkeypatch):
    """流层集成：writable=False 时写工具转提案，handler 一次都不跑，token 不在回给模型的文本里。"""

    def _boom(db, arguments):  # pragma: no cover - 被调用即失败
        raise AssertionError("未确认的写入不应该执行 handler")

    monkeypatch.setattr("app.services.assistant_tools.report_tools.create_reminder_record", _boom)
    import asyncio

    from app.api.assistant_tool_exec import run_tool_call
    from app.database import SessionLocal

    call = {
        "id": "call_1",
        "function": {
            "name": _TARGET_TOOL,
            "arguments": '{"title": "复盘", "remind_at": "2026-10-12T10:00:00"}',
        },
    }
    record = asyncio.run(run_tool_call(call, None, SessionLocal, _ctx()))
    assert record["ok"] is True
    proposal = record["proposal"]
    assert proposal["status"] == "pending"
    assert "提案" in record["result_text"]
    # token 不出现在任何回给模型/前端之外的载荷里（WriteProposalOut 根本不含 token 字段）。
    assert "token" not in record["result_text"]
    assert all("token" not in key for key in proposal)


def test_stream_write_with_consent_executes_directly(db_session):
    """allow_write=True 的请求：写工具直接执行（开关本身就是显式同意）。"""
    import asyncio

    from app.api.assistant_tool_exec import run_tool_call
    from app.database import SessionLocal

    call = {
        "id": "call_2",
        "function": {
            "name": _TARGET_TOOL,
            "arguments": '{"title": "复盘", "remind_at": "2026-10-12T10:00:00"}',
        },
    }
    ctx = ToolExecutionContext(
        dataset_id=_ctx().dataset_id,
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=True,
    )
    record = asyncio.run(run_tool_call(call, None, SessionLocal, ctx))
    assert record["ok"] is True
    assert record["changed"] is True
    assert "proposal" not in record


def test_execute_tool_legacy_path_still_works_for_trusted_callers(db_session):
    """受信调用方（测试/内部）不带 ctx 直调的历史行为保持：写工具可执行。"""
    tool = next(t for t in _TOOLS if t.name == _TARGET_TOOL)
    assert tool.writes
    result = execute_tool(
        db_session, _TARGET_TOOL, {"title": "复盘", "remind_at": "2026-10-12T10:00:00"}
    )
    assert result.changed is True

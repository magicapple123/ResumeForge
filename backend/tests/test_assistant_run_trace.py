# SPDX-License-Identifier: Apache-2.0
"""T21 运行轨迹字段测试：白名单 / 脱敏 / 授权决策 / revision / 有界内存记录 / 不持久化。"""

import ast
import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.schemas.setting import LLMConfig
from app.services.assistant_run_trace import (
    AUTHORIZATION_DECISIONS,
    MAX_TOOL_NAME_CHARS,
    RUN_FIELDS,
    STATUSES,
    STEP_FIELDS,
    ModelUsage,
    RunTraceRecorder,
    authorization_decision,
    revision_from_tool_payload,
    step_from_tool_call,
)
from app.services.assistant_run_trace_redact import (
    FORBIDDEN_KEYS,
    forbidden_keys_in,
    redact_summary,
)
from app.services.llm.base import LLMDelta
from app.services.llm.usage import LLMUsage
from test_assistant import (
    _configure_llm,
    _create_conversation,
    _events,
    _ScriptedProvider,
    _tool_call,
)

T0 = datetime(2026, 11, 7, 4, 0, tzinfo=UTC)
T1 = T0 + timedelta(milliseconds=250)


def _usage() -> ModelUsage:
    return ModelUsage(
        model="deepseek-flash",
        prompt_tokens=11,
        completion_tokens=7,
        total_tokens=18,
        finish_reason="stop",
    )


def _step(record=None, **overrides):
    source = {"name": "list_jobs", "ok": True, "summary": "查看了岗位列表"}
    if record is not None:
        source = record
    kwargs = {
        "record": source,
        "run_id": "run-1",
        "step": 0,
        "started_at": T0,
        "finished_at": T1,
    }
    kwargs.update(overrides)
    return step_from_tool_call(**kwargs)


def test_step_view_contains_exactly_whitelisted_fields():
    """轨迹步只暴露 STEP_FIELDS：多一个键都算越界（to_view 白名单）。"""
    view = _step().to_view()
    assert tuple(view) == STEP_FIELDS
    assert set(view) == set(STEP_FIELDS)
    assert view["run_id"] == "run-1" and view["step"] == 0 and view["tool"] == "list_jobs"
    assert view["started_at"] == T0.isoformat()
    assert view["duration_ms"] == 250
    assert forbidden_keys_in(view) == []


def test_step_view_never_carries_source_payload():
    """源 record 里的参数/正文/附件/Key/提示词全部不进轨迹（只读派生 + 白名单）。"""
    secret_resume = "张三的简历正文：负责后端开发，手机 13812345678"
    record = {
        "name": "update_resume_field",
        "ok": True,
        "summary": "修改了简历的一个字段",
        "arguments": {"value": secret_resume},
        "content": secret_resume,
        "attachments": [{"name": "resume.pdf", "text": secret_resume}],
        "api_key": "sk-live-abcdefghijklmnop",
        "prompt": "系统提示词原文",
        "reasoning_content": "思维链原文",
        "result_text": json.dumps({"revision": 9, "content": secret_resume}, ensure_ascii=False),
    }

    view = _step(record=record).to_view()
    dumped = json.dumps(view, ensure_ascii=False)
    for sentinel in (
        secret_resume,
        "resume.pdf",
        "sk-live-abcdefghijklmnop",
        "系统提示词原文",
        "思维链原文",
    ):
        assert sentinel not in dumped
    assert forbidden_keys_in(view) == []
    assert "arguments" not in view and "result_text" not in view
    assert view["revision"] == 9


def test_derivation_does_not_mutate_source_record():
    """只读派生：源 record 逐字节不变（后续接线时调用方能安全复用）。"""
    record = {"name": "list_jobs", "ok": True, "summary": "查看岗位", "arguments": {"x": 1}}
    before = copy.deepcopy(record)
    _step(record=record)
    assert record == before


def test_summary_is_redacted_and_truncated():
    """摘要脱敏：邮箱/手机/密钥/家目录掩码，换行折叠，≤120 字。"""
    masked = redact_summary(
        "用户 a@example.com 电话 13812345678\n密钥 sk-live-abcdefghij\n"
        "路径 C:\\Users\\alice\\resume.docx " + "很长的摘要" * 40,
    )
    assert "@example.com" not in masked
    assert "13812345678" not in masked
    assert "sk-live-abcdefghij" not in masked
    assert "C:\\Users\\alice" not in masked
    assert "\n" not in masked
    assert len(masked) <= 120
    assert "[已脱敏]" in masked


def test_redact_summary_rejects_non_string():
    assert redact_summary(None) == ""
    assert redact_summary(123) == ""


@pytest.mark.parametrize(
    "kwargs, expected",
    [
        ({"writes": False, "writable": False}, "not_required"),
        ({"writes": True, "writable": True}, "approved"),
        ({"writes": True, "writable": False}, "pending_approval"),
        ({"writes": True, "writable": True, "allowed": False}, "denied"),
        ({"writes": False, "writable": False, "allowed": False}, "denied"),
    ],
)
def test_authorization_decision_matrix(kwargs, expected):
    """授权决策：只读不要求同意；写工具按 writable 分 approved / pending_approval；未授权 denied。"""
    decision = authorization_decision(**kwargs)
    assert decision == expected
    assert decision in AUTHORIZATION_DECISIONS


@pytest.mark.parametrize(
    "record, kwargs, expected",
    [
        ({"name": "list_jobs", "ok": True}, {}, "ok"),
        ({"name": "create_job", "ok": False, "error": "boom"}, {}, "failed"),
        (
            {"name": "create_job", "ok": True, "proposal": {"proposal_id": "p1"}},
            {},
            "proposal_pending",
        ),
        ({"name": "create_job", "ok": True}, {"authorization": "denied"}, "refused"),
        ({"name": "list_jobs", "ok": True}, {"cancelled": True}, "cancelled"),
    ],
)
def test_status_derivation_matrix(record, kwargs, expected):
    """状态由 record + 授权决策派生，且只在既定枚举内。"""
    step = _step(record=record, **kwargs)
    assert step.status == expected
    assert step.status in STATUSES


def test_unknown_authorization_decision_is_rejected():
    with pytest.raises(ValueError, match="未知授权决策"):
        _step(authorization="maybe")


def test_model_usage_projection_reads_only_whitelisted_attributes():
    """用量投影只读 5 个白名单属性；行上的正文/Key/成本列一律不碰。"""
    row = SimpleNamespace(
        model="deepseek-flash",
        prompt_tokens=11,
        completion_tokens=7,
        total_tokens=18,
        finish_reason="stop",
        cost_estimate=0.12,
        input_scope="resume+profile+job",
        content="简历正文",
        api_key="sk-live-abcdefghij",
    )
    usage = ModelUsage.from_llm_usage(row)
    view = _step(usage=usage).to_view()
    assert view["model"] == "deepseek-flash"
    assert (view["prompt_tokens"], view["completion_tokens"], view["total_tokens"]) == (11, 7, 18)
    assert view["finish_reason"] == "stop"
    dumped = json.dumps(view, ensure_ascii=False)
    assert "简历正文" not in dumped and "sk-live-abcdefghij" not in dumped
    # 缺失行与未知 token 保持 None，不用 0 冒充。
    empty = _step(usage=ModelUsage.from_llm_usage(None)).to_view()
    assert empty["model"] == "" and empty["prompt_tokens"] is None


def test_revision_extraction_only_takes_the_integer():
    """revision 只取整数：JSON 结果里的其它字段（正文）不复制。"""
    assert revision_from_tool_payload({"result_text": '{"revision": 9, "content": "正文"}'}) == 9
    assert revision_from_tool_payload({"revision": 12}) == 12
    assert revision_from_tool_payload({"result_text": "不是 JSON"}) is None
    assert revision_from_tool_payload({"result_text": '{"revision": true}'}) is None
    assert revision_from_tool_payload({"result_text": '{"revision": -1}'}) is None
    assert revision_from_tool_payload({}) is None
    # 超长结果不解析（防止把大段正文拉进解析路径）。
    huge = '{"revision": 9, "content": "' + "x" * 30_000 + '"}'
    assert revision_from_tool_payload({"result_text": huge}) is None


def test_recorder_requires_an_active_run():
    recorder = RunTraceRecorder()
    with pytest.raises(RuntimeError, match="没有进行中的 run"):
        recorder.record_step(tool="list_jobs")
    recorder.begin_run(run_id="run-1")
    with pytest.raises(RuntimeError, match="已有进行中的 run"):
        recorder.begin_run(run_id="run-2")
    recorder.end_run()
    with pytest.raises(RuntimeError, match="没有进行中的 run"):
        recorder.end_run()
    assert recorder.current_run() is None


def test_recorder_step_numbers_are_monotonic_and_bounded():
    """每个 run 最多保留最近 N 步；溢出丢最旧但编号不复用（便于发现"漏了一步"）。"""
    recorder = RunTraceRecorder(max_runs=5, max_steps_per_run=3)
    recorder.begin_run(run_id="run-1")
    for index in range(5):
        recorder.record_step({"name": f"tool_{index}", "ok": True})
    run = recorder.current_run()
    assert run is not None
    assert [step["step"] for step in run["steps"]] == [2, 3, 4]
    assert [step["tool"] for step in run["steps"]] == ["tool_2", "tool_3", "tool_4"]


def test_recorder_bounds_runs_and_keeps_chronological_order():
    recorder = RunTraceRecorder(max_runs=2)
    recorder.begin_run(run_id="run-1")
    recorder.end_run()
    recorder.begin_run(run_id="run-2")
    recorder.end_run()
    recorder.begin_run(run_id="run-3")
    recorder.end_run()
    runs = recorder.snapshot()["runs"]
    assert [run["run_id"] for run in runs] == ["run-2", "run-3"]
    for run in runs:
        assert tuple(run) == RUN_FIELDS


def test_snapshot_is_detached_and_json_serializable():
    recorder = RunTraceRecorder()
    recorder.begin_run(run_id="run-1", conversation_id=3, request_id="req-1")
    recorder.record_step({"name": "list_jobs", "ok": True})
    recorder.end_run(status="ok")
    snapshot = recorder.snapshot()
    assert snapshot["version"] == 1
    json.dumps(snapshot)  # 视图里不允许出现 datetime 等不可序列化对象
    snapshot["runs"][0]["steps"].clear()
    snapshot["runs"].clear()
    assert len(recorder.snapshot()["runs"]) == 1
    assert len(recorder.snapshot()["runs"][0]["steps"]) == 1
    recorder.clear()
    assert recorder.snapshot() == {"version": 1, "runs": []}


def test_run_view_contains_only_whitelisted_fields():
    recorder = RunTraceRecorder()
    recorder.begin_run(run_id="run-1")
    recorder.record_step({"name": "list_jobs", "ok": True})
    run = recorder.end_run()
    assert tuple(run) == RUN_FIELDS
    assert forbidden_keys_in(run) == []
    assert {key for key in RUN_FIELDS} - set(run) == set()


def test_forbidden_keys_helper_detects_planted_keys():
    """检测器自检：埋进嵌套结构的越界键必须被找出来（否则上一条断言等于恒真）。"""
    planted = {"runs": [{"steps": [{"content": "正文"}]}], "attachments": []}
    found = forbidden_keys_in(planted)
    assert found == ["attachments", "content"]
    assert set(found) <= FORBIDDEN_KEYS


def test_module_adds_no_persistence_layer():
    """本阶段（Lead 要求）只做内存记录：模块不得 import DB/落盘 API，也不建模型表。"""
    source = Path(
        __import__("app.services.assistant_run_trace", fromlist=["__file__"]).__file__
    ).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert imported.isdisjoint({"sqlalchemy", "sqlite3", "alembic"}), (
        f"轨迹模块不得引入持久化依赖：{sorted(imported)}"
    )
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert "open" not in called, "轨迹模块不得直接读写文件"
    models_dir = Path(__file__).resolve().parents[1] / "app" / "models"
    assert not (models_dir / "assistant_run_trace.py").exists(), (
        "T21 持久化需要 Lead 统一分配迁移号；建表前不要新增模型文件"
    )
    assert MAX_TOOL_NAME_CHARS == 64


def _runtime_provider(rounds):
    """真实接线用假 Provider：补上 config/last_usage，模拟真实 provider 的这两个属性。"""
    provider = _ScriptedProvider(rounds)
    provider.config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model="assistant-model",
    )
    provider.last_usage = LLMUsage(
        model="assistant-model",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        elapsed_ms=12,
        finish_reason="stop",
    )
    return provider


def _send_message(client, conversation_id: int, content: str, *, allow_write: bool = False):
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": content, "allow_write": allow_write},
    )
    assert response.status_code == 200
    return response


def _assistant_trace(client, conversation: dict) -> dict:
    conversation_detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assistant_message = conversation_detail["messages"][1]
    return assistant_message["context"]["run_trace"]


def test_real_stream_persists_whitelisted_run_trace(client, monkeypatch):
    """真实流路径：run_trace 随助手消息 context 落库（chat_message.context JSON，零迁移）。"""
    _configure_llm(client)
    provider = _runtime_provider(
        [
            [LLMDelta(text="我来查一下。"), _tool_call("list_jobs", {})],
            [LLMDelta(text="你目前有 0 个岗位。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    events = _events(_send_message(client, conversation["id"], "我一共有几个岗位？"))
    done = events[-1]
    assert done["type"] == "done"
    trace = done["message"]["context"]["run_trace"]
    assert trace["version"] == 1
    assert trace["run_id"].startswith(f"run-{done['message']['id']}-")
    assert trace["status"] == "ok"
    assert trace["step_count"] == len(trace["steps"]) == 1
    step = trace["steps"][0]
    assert tuple(step) == STEP_FIELDS
    assert step["tool"] == "list_jobs"
    assert step["status"] == "ok"
    assert step["authorization"] == "not_required"
    assert step["model"] == "assistant-model"
    assert (step["prompt_tokens"], step["completion_tokens"], step["total_tokens"]) == (10, 5, 15)
    assert step["finish_reason"] == "stop"
    assert step["revision"] is None
    assert step["started_at"] and step["finished_at"] and step["duration_ms"] >= 0
    assert step["summary"] and "岗位" in step["summary"]
    dumped = json.dumps(trace, ensure_ascii=False)
    assert "assistant-secret" not in dumped
    assert forbidden_keys_in(trace) == []
    # 落库与历史回看同源：GET 会话拿到的 context 与 done 事件里的那份一致。
    assert _assistant_trace(client, conversation)["steps"][0]["tool"] == "list_jobs"


def test_real_stream_trace_records_pending_approval_for_proposal(client, monkeypatch):
    """写工具未获写入同意 → 转提案：轨迹步状态 proposal_pending、授权 pending_approval。"""
    _configure_llm(client)
    provider = _runtime_provider(
        [
            [_tool_call("create_job", {"title": "字节跳动后端实习"})],
            [LLMDelta(text="已经生成提案，等你确认。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    events = _events(
        _send_message(client, conversation["id"], "帮我把字节跳动的后端实习岗位存进去")
    )
    assert any(event["type"] == "write_proposal" for event in events)
    step = _assistant_trace(client, conversation)["steps"][0]
    assert step["tool"] == "create_job"
    assert step["status"] == "proposal_pending"
    assert step["authorization"] == "pending_approval"
    assert step["revision"] is None
    dumped = json.dumps(_assistant_trace(client, conversation), ensure_ascii=False)
    assert "assistant-secret" not in dumped
    assert forbidden_keys_in(step) == []


def test_real_stream_trace_records_failed_tool_step(client, monkeypatch):
    """工具失败不拖垮整轮回复，但轨迹里这一步必须是 failed（不是 ok）。"""
    _configure_llm(client)
    provider = _runtime_provider(
        [
            [_tool_call("get_job", {"job_id": 999})],
            [LLMDelta(text="没找到这个岗位。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    _events(_send_message(client, conversation["id"], "看看 999 号岗位"))
    trace = _assistant_trace(client, conversation)
    assert trace["status"] == "ok"  # 整轮回复成功
    assert trace["steps"][0]["status"] == "failed"  # 单步失败如实记录
    assert trace["steps"][0]["authorization"] == "not_required"

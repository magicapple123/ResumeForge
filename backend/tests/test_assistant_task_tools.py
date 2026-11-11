# SPDX-License-Identifier: Apache-2.0
"""18A 长任务工具：计划数字、建/查/取消、提案预览与端到端（假 provider）。

三条工具把跨轮批量活交给现有 agent_task。本文件钉住最容易坏的四件事：

1. **N 条 / M 步来自库，不来自模型**：简历条目数现读 v2 文档、岗位 id 逐条验存在；
2. **计划与执行同一份**：预览卡与 task_create 调用同一个 build_task_plan（不会出现
   "卡片说 12 条、任务实际 3 步"）；
3. **未确认不落库**：默认权限下写工具只出提案卡，批准前 agent_task 表零行；
4. **取消保留已完成**：cancelled 后已完成步骤仍是 done，未完成步骤 skipped。
"""

from __future__ import annotations

import pytest
from _assistant_breadth_support import (
    ScriptedProvider,
    configure_llm,
    create_conversation,
    events,
    patch_provider,
    register_task_tools,
    send,
    tool_call,
)
from app.models.agent_task import AgentTask
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.services import agent_task_service
from app.services.assistant_tools._tools_specs_tasks import TASK_TOOLS
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.task_tools import (
    ASSISTANT_TASK_SOURCE,
    TASK_KINDS,
    _preview_task_cancel,
    _preview_task_create,
    _tool_task_cancel,
    _tool_task_create,
    _tool_task_status,
    build_task_plan,
)


def _seed_resume(db_session, projects: int = 3) -> ResumeRecord:
    """一份 v1 形状的简历（读侧自动转 v2）；projects 条 = 可批量改写的条目数。"""
    record = ResumeRecord(
        title="后端简历",
        content={
            "name": "张示例",
            "projects": [
                {"name": f"项目{index}", "role": "负责人", "description": ["做了这件事"]}
                for index in range(projects)
            ],
        },
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _seed_jobs(db_session, count: int = 2) -> list[Job]:
    jobs = [Job(title=f"后端实习 {index}", company=f"示例公司{index}") for index in range(count)]
    db_session.add_all(jobs)
    db_session.commit()
    for job in jobs:
        db_session.refresh(job)
    return jobs


def _task_count(db_session) -> int:
    db_session.expire_all()
    return db_session.query(AgentTask).count()


# ===== 计划：数字来自库 =====


def test_resume_batch_edit_counts_real_sections(db_session):
    resume = _seed_resume(db_session, projects=4)
    plan = build_task_plan(
        db_session,
        "resume_batch_edit",
        {"resume_id": resume.id, "instruction": "按 STAR 重写", "section": "projects"},
    )
    assert plan.item_count == 4
    assert plan.kind == "resume_batch_edit"
    assert len(plan.steps) == 3
    assert "4 条" in plan.items_label


def test_resume_batch_edit_whole_document_counts_all_entry_sections(db_session):
    resume = _seed_resume(db_session, projects=2)
    plan = build_task_plan(
        db_session, "resume_batch_edit", {"resume_id": resume.id, "instruction": "改具体一点"}
    )
    assert plan.item_count >= 2


def test_job_import_uses_requested_limit(db_session):
    plan = build_task_plan(
        db_session, "job_import", {"url": "https://example.com/campus", "limit": 37}
    )
    assert plan.item_count == 37
    assert len(plan.steps) == 3
    assert "37" in plan.title


def test_match_batch_counts_existing_jobs_only(db_session):
    jobs = _seed_jobs(db_session, count=3)
    plan = build_task_plan(db_session, "match_batch", {"job_ids": [job.id for job in jobs]})
    assert plan.item_count == 3
    assert len(plan.steps) == 3


def test_greeting_batch_counts_jobs(db_session):
    jobs = _seed_jobs(db_session, count=2)
    plan = build_task_plan(
        db_session,
        "greeting_batch",
        {"job_ids": [job.id for job in jobs], "template": "你好，我对这个岗位很感兴趣"},
    )
    assert plan.item_count == 2


@pytest.mark.parametrize(
    ("kind", "params", "message"),
    [
        ("unknown_kind", {}, "未知的任务类型"),
        ("resume_batch_edit", {"instruction": "改"}, "resume_id"),
        ("job_import", {"url": "ftp://example.com", "limit": 3}, "http"),
        ("job_import", {"url": "https://example.com", "limit": 500}, "limit"),
        ("match_batch", {"job_ids": []}, "job_ids"),
        ("match_batch", {"job_ids": [999999]}, "不存在"),
        ("greeting_batch", {"job_ids": list(range(1, 61))}, "最多"),
    ],
)
def test_invalid_plans_raise_chinese_errors(db_session, kind, params, message):
    _seed_jobs(db_session, count=1)  # 让 job 1 存在，只剩"超上限"触发
    with pytest.raises(ValueError) as excinfo:
        build_task_plan(db_session, kind, params)
    assert message in str(excinfo.value)


# ===== handler：建 / 查 / 取消 =====


def test_task_create_writes_agent_task_with_planned_steps(db_session):
    jobs = _seed_jobs(db_session, count=2)
    result = _tool_task_create(
        db_session, {"kind": "match_batch", "params": {"job_ids": [job.id for job in jobs]}}
    )
    assert result.changed is True and result.link == "/"
    assert "2 个岗位" in result.summary and "3 步" in result.summary
    db_session.expire_all()
    task = db_session.query(AgentTask).one()
    assert task.source == ASSISTANT_TASK_SOURCE
    assert task.status == "draft"
    assert len(task.steps) == 3
    assert [step.step_index for step in task.steps] == [0, 1, 2]


def test_task_status_reports_progress_and_current_step(db_session):
    resume = _seed_resume(db_session)
    created = _tool_task_create(
        db_session,
        {
            "kind": "resume_batch_edit",
            "params": {"resume_id": resume.id, "instruction": "按 STAR 重写"},
        },
    )
    db_session.expire_all()
    task = db_session.query(AgentTask).one()
    status = _tool_task_status(db_session, {"task_id": task.id})
    assert status.changed is False
    assert "0/3" in status.summary
    assert '"current_step"' in status.text
    assert created.changed is True


def test_task_status_missing_task_raises_value_error(db_session):
    with pytest.raises(ValueError) as excinfo:
        _tool_task_status(db_session, {"task_id": 999})
    assert "不存在" in str(excinfo.value)


def test_task_cancel_keeps_finished_steps(db_session):
    resume = _seed_resume(db_session)
    _tool_task_create(
        db_session,
        {
            "kind": "resume_batch_edit",
            "params": {"resume_id": resume.id, "instruction": "按 STAR 重写"},
        },
    )
    task = db_session.query(AgentTask).one()
    agent_task_service.start(db_session, task.id)
    agent_task_service.advance_step(db_session, task.id, 0)
    result = _tool_task_cancel(db_session, {"task_id": task.id})
    assert result.changed is True
    db_session.expire_all()
    task = db_session.query(AgentTask).one()
    assert task.status == "cancelled"
    statuses = [step.status for step in task.steps]
    assert statuses[0] == "done"
    assert statuses[1:] == ["skipped", "skipped"]
    # 已取消再取消：服务层幂等，不报错、不重复写。
    again = _tool_task_cancel(db_session, {"task_id": task.id})
    assert again.changed is True


# ===== 预览：写明 N 条 / M 步，且不写库 =====


def test_task_create_preview_states_count_and_steps_without_writing(db_session):
    jobs = _seed_jobs(db_session, count=3)
    before = _task_count(db_session)
    preview = _preview_task_create(
        db_session, {"kind": "match_batch", "params": {"job_ids": [job.id for job in jobs]}}
    )
    assert "3 条" in preview.scope and "3 步" in preview.scope
    assert [change.field for change in preview.changes[:3]] == ["任务标题", "将处理", "预计步骤"]
    assert len(preview.changes) == 3 + 3
    assert _task_count(db_session) == before  # 预览绝不建任务


def test_task_cancel_preview_marks_irreversible_scope(db_session):
    resume = _seed_resume(db_session)
    _tool_task_create(
        db_session,
        {
            "kind": "resume_batch_edit",
            "params": {"resume_id": resume.id, "instruction": "按 STAR 重写"},
        },
    )
    task = db_session.query(AgentTask).one()
    preview = _preview_task_cancel(db_session, {"task_id": task.id})
    assert "不能恢复为进行中" in preview.scope
    assert preview.changes[0].after == "已取消"


# ===== 声明（Tool specs）=====


def test_task_tools_declare_permissions_and_previews():
    by_name = {tool.name: tool for tool in TASK_TOOLS}
    assert set(by_name) == {"task_create", "task_status", "task_cancel"}
    assert by_name["task_status"].permission is ToolPermission.READ_ONLY
    assert by_name["task_create"].permission is ToolPermission.REVERSIBLE_WRITE
    assert by_name["task_cancel"].permission is ToolPermission.REVERSIBLE_WRITE
    for name, tool in by_name.items():
        assert isinstance(tool.description, str) and tool.description.strip()
        assert tool.parameters.get("type") == "object"
        assert tool.service_entry and tool.service_entry.startswith("agent_task_service.")
        assert (tool.preview is not None) is (tool.permission is not ToolPermission.READ_ONLY), name
    assert by_name["task_create"].parameters["properties"]["kind"]["enum"] == list(TASK_KINDS)


def test_task_rules_block_holds_the_three_judgement_lines():
    from app.services.assistant.assistant_task_rules import TASK_RULES_BLOCK

    assert "20 次" in TASK_RULES_BLOCK  # >20 次工具调用才建任务
    assert "只改一个字段" in TASK_RULES_BLOCK and "不得建任务" in TASK_RULES_BLOCK
    assert "一轮内能做完" in TASK_RULES_BLOCK


# ===== 端到端：未确认 → 提案卡；批准 → 任务卡 =====


def test_unconfirmed_task_create_shows_proposal_and_writes_nothing(client, db_session, monkeypatch):
    register_task_tools(monkeypatch)
    configure_llm(client)
    jobs = _seed_jobs(db_session, count=2)
    provider = ScriptedProvider(
        [
            [
                tool_call(
                    "task_create",
                    {
                        "kind": "match_batch",
                        "params": {"job_ids": [job.id for job in jobs]},
                    },
                )
            ],
            [],
        ]
    )
    patch_provider(monkeypatch, provider)
    conversation = create_conversation(client)

    response = send(client, conversation["id"], "帮我把这两个岗位批量匹配一下")
    event_list = events(response)
    tool_event = next(event for event in event_list if event["type"] == "tool")
    assert tool_event["name"] == "task_create"
    assert tool_event["changed"] is False
    proposal = next(event for event in event_list if event["type"] == "write_proposal")
    assert proposal["proposal"]["preview"]["target"].startswith("新建 Agent 任务")
    assert "2 个岗位" in proposal["proposal"]["preview"]["scope"]
    assert _task_count(db_session) == 0  # 未确认：一个字节都没写

    # 批准提案 → 任务卡真的建出来，且步骤与预览一致。
    approved = client.post(
        f"/api/assistant/write-proposals/{proposal['proposal']['proposal_id']}/approve"
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["changed"] is True
    db_session.expire_all()
    task = db_session.query(AgentTask).one()
    assert len(task.steps) == 3
    assert task.source == ASSISTANT_TASK_SOURCE


def test_single_field_edit_does_not_create_a_task(client, db_session, monkeypatch):
    """18A 反例：只改一个字段时不应建任务（提示词规则 + 工具本身不会自动建）。

    这里钉的是**执行链**：模型若照规则不用 task_create，就绝不会多出一行 agent_task；
    upgrade 的反例（"每个小需求都变成后台任务"）由提示词规则与评测用例另外守住。
    """
    register_task_tools(monkeypatch)
    configure_llm(client)
    provider = ScriptedProvider([[tool_call("list_jobs", {})], []])
    patch_provider(monkeypatch, provider)
    conversation = create_conversation(client)
    send(client, conversation["id"], "把 1 号岗位的标题里加个空格")
    assert _task_count(db_session) == 0


def test_assistant_page_task_strip_can_query_tasks_by_source(client, db_session, monkeypatch):
    """前端任务条按 source=assistant 过滤；数据来自既有 /api/agent-tasks 端点（不改契约）。"""
    register_task_tools(monkeypatch)
    resume = _seed_resume(db_session)
    _tool_task_create(
        db_session,
        {
            "kind": "resume_batch_edit",
            "params": {"resume_id": resume.id, "instruction": "按 STAR 重写"},
        },
    )
    response = client.get("/api/agent-tasks")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["source"] == ASSISTANT_TASK_SOURCE
    assert len(items[0]["steps"]) == 3

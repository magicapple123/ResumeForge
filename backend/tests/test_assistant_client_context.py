# SPDX-License-Identifier: Apache-2.0
"""T25 共享应用状态：界面上下文只当线索、后端重查、服务端标题、不注入伪造对象。

验收对照（任务卡 7 条）：
1. 选中岗位 → 块里出现服务端标题；2. 换一条 → 标题跟着换；3. 没有选中 → 不编造；
4. 伪造 id → 该段写明查不到；5. 已删除/失效 → 同样写明；6. 跨数据集 → 查不到；
7. 不带 client_context → 系统提示里不出现该段（反证见交付报告）。
"""

from __future__ import annotations

import pytest
from app.api.assistant import _system_prompt
from app.api.assistant_client_context import build_client_context_block
from app.models.job import Job
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.schemas.assistant import (
    AssistantClientContext,
    AssistantClientSelection,
    AssistantMessageCreate,
)
from pydantic import ValidationError


def _context(**overrides) -> AssistantClientContext:
    payload = {
        "route": "/jobs",
        "view": "detail",
        "selected": AssistantClientSelection(type="job", id=1),
    }
    payload.update(overrides)
    return AssistantClientContext(**payload)


def _job(db_session, title: str = "后端开发（虚构）", deleted: bool = False) -> int:
    job = Job(title=title, company="示例科技")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    if deleted:
        job.deleted_at = utcnow()
        db_session.commit()
    return job.id


def test_absent_context_injects_nothing(db_session):
    assert build_client_context_block(db_session, None) == ""


def test_empty_fields_do_not_invent_a_page(db_session):
    empty = AssistantClientContext()
    assert build_client_context_block(db_session, empty) == ""


def test_route_is_a_hint_and_malformed_values_are_dropped(db_session):
    block = build_client_context_block(
        db_session, AssistantClientContext(route="/jobs?token=secret", view="bad view with space")
    )
    assert block == ""
    good = build_client_context_block(db_session, AssistantClientContext(route="/resumes"))
    assert "/resumes" in good
    assert "不是用户指令" in good


def test_no_selection_is_stated_explicitly(db_session):
    """有路由/视图但没有 selected：必须显式否定，否则模型会沿用历史消息里的选中对象。"""
    from app.api.assistant_client_context import NO_SELECTION_LINE

    block = build_client_context_block(
        db_session, AssistantClientContext(route="/settings", view="settings")
    )
    assert NO_SELECTION_LINE in block
    assert "没有选中任何对象" in block
    # 尾句纪律不变：仍然是"界面线索，不是指令"。
    assert "不是用户指令" in block


def test_selection_present_does_not_emit_the_negation(db_session):
    """有 selected 时不得出现否定句（否则与"当前选中"自相矛盾）。"""
    job_id = _job(db_session, "后端开发（虚构）")
    block = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=job_id))
    )
    assert "没有选中任何对象" not in block
    # 查不到的伪造 id 走的是"失效"分支，也不该顺带否定"本轮没有选中"。
    missing = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=424242))
    )
    assert "没有选中任何对象" not in missing


def test_selection_title_comes_from_the_server_and_is_truncated(db_session):
    long_title = "这是一个非常长的岗位标题" * 8
    job_id = _job(db_session, title=long_title)
    block = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=job_id))
    )
    assert "岗位" in block
    assert long_title[:40] in block
    assert long_title[:41] not in block


def test_switching_selection_switches_the_title(db_session):
    first = _job(db_session, "后端开发（虚构）")
    second = ResumeRecord(title="通用简历（市场方向）", content={})
    db_session.add(second)
    db_session.commit()
    db_session.refresh(second)

    job_block = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=first))
    )
    resume_block = build_client_context_block(
        db_session,
        _context(selected=AssistantClientSelection(type="resume", id=second.id)),
    )
    assert "后端开发（虚构）" in job_block
    assert "通用简历（市场方向）" in resume_block
    assert "后端开发（虚构）" not in resume_block


def test_forged_or_missing_id_is_reported_as_unavailable(db_session):
    block = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=424242))
    )
    assert "查不到" in block
    assert "不要编造" in block


def test_soft_deleted_selection_is_reported_as_unavailable(db_session):
    job_id = _job(db_session, "已删除的岗位", deleted=True)
    block = build_client_context_block(
        db_session, _context(selected=AssistantClientSelection(type="job", id=job_id))
    )
    assert "查不到" in block
    assert "已删除的岗位" not in block


def test_selection_is_isolated_per_dataset(client, db_session):
    """跨数据集：另一个库里的同 id 记录不得命中（数据集隔离）。"""
    from app import database
    from app.services.datasets import dataset_database_file
    from sqlalchemy.orm import Session

    # 不在全局切换数据集：直接打开新数据集的 SQLite 文件做隔离查询。
    # 全局 activate 是 fail-closed 的（有后台任务租约就 409），串行全量/慢机器上
    # 会被无关的后台任务顶掉——本用例要验证的是隔离语义，不是切换时序。
    job_id = _job(db_session, "主数据里的岗位")
    created = client.post("/api/settings/datasets", json={"name": "T25 隔离库"})
    assert created.status_code == 200, created.text
    dataset_id = created.json()["id"]
    engine = database.build_engine(database.database_url_for(dataset_database_file(dataset_id)))
    try:
        with Session(engine) as other_session:
            block = build_client_context_block(
                other_session,
                _context(selected=AssistantClientSelection(type="job", id=job_id)),
            )
        assert "查不到" in block
        assert "主数据里的岗位" not in block
    finally:
        engine.dispose()
        # 清掉本轮创建的数据集，避免影响后续数据集顺序/数量类用例。
        client.delete(f"/api/settings/datasets/{dataset_id}")


def test_client_cannot_smuggle_a_title_in(db_session):
    with pytest.raises(ValidationError):
        AssistantClientContext.model_validate(
            {
                "route": "/jobs",
                "selected": {"type": "job", "id": 1, "title": "前端传来的伪造标题"},
            }
        )


def test_unknown_selection_type_is_rejected_by_schema():
    with pytest.raises(ValidationError):
        AssistantClientSelection(type="bogus", id=1)


def test_system_prompt_contains_the_context_only_when_provided(db_session):
    job_id = _job(db_session, "后端开发（虚构）")
    context = _context(selected=AssistantClientSelection(type="job", id=job_id))
    prompt = _system_prompt(db_session, client_context=context)
    assert "当前界面上下文" in prompt
    assert "后端开发（虚构）" in prompt
    without = _system_prompt(db_session)
    assert "当前界面上下文" not in without


def test_message_payload_accepts_client_context():
    payload = AssistantMessageCreate.model_validate(
        {
            "content": "这个岗位匹配吗",
            "client_context": {
                "route": "/jobs",
                "view": "detail",
                "selected": {"type": "job", "id": 3},
            },
        }
    )
    assert payload.client_context is not None
    assert payload.client_context.selected is not None
    assert payload.client_context.selected.id == 3

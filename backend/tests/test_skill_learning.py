# SPDX-License-Identifier: Apache-2.0
"""#31D/#31E/#31F 技能学习：生成触发、四段草稿、近义去重、版本与验证闭环。

验收判据（问题清单 #31 与 task-14）：
- 触发条件：>=2 次对话重复 / 用户说「以后都这么做」/ 连续 >=5 步成功；不满足不提议；
- 失败轨迹不生成（任一步失败即整条轨迹不合格）；
- 四段内容缺一不可；默认**不启用**（generated=True、validation_status=pending）；
- 近义检测命中时提议更新已有技能，version 自增；对话启用行记录引用版本；
- 90 天未加载 → 只提示归档，不自动删；
- 自动生成不写 assistant_skill_file。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from app.models.assistant import (
    AssistantConversationSkill,
    AssistantSkill,
    ChatConversation,
    ChatMessage,
)
from app.models.profile import utcnow
from app.services.assistant import skill_learning
from sqlalchemy import inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision


def _migrated_engine(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'skill-migration.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    return engine


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_migration_0016_adds_skill_learning_columns_and_round_trips(tmp_path):
    """升级加列 → 降级删列 → 再升级恢复；不碰技能内容与关联行。"""
    engine = _migrated_engine(tmp_path)
    try:
        skill_columns = _columns(engine, "assistant_skill")
        assert {
            "when_to_use",
            "steps",
            "pitfalls",
            "version",
            "generated",
            "validation_status",
            "last_loaded_at",
        } <= skill_columns
        assert "skill_version" in _columns(engine, "assistant_conversation_skill")
        assert alembic_version_of(engine) == head_revision()

        # 退到本迁移之前（按 revision 名定位父版本）：链尾再加迁移（0017 已落地）
        # 时，downgrade -1 只会退掉更新的那条，本迁移的列仍在。
        command.downgrade(build_alembic_config(engine), prior_revision("_skill_learning"))
        assert alembic_version_of(engine) != head_revision()
        downgraded = _columns(engine, "assistant_skill")
        assert "when_to_use" not in downgraded
        assert "version" not in downgraded
        assert "skill_version" not in _columns(engine, "assistant_conversation_skill")
        # 只删自己的列：技能表原有列与数据不动。
        assert "name" in downgraded
        assert "prompt" in downgraded

        command.upgrade(build_alembic_config(engine), "head")
        assert _columns(engine, "assistant_skill") == skill_columns
        assert "skill_version" in _columns(engine, "assistant_conversation_skill")
    finally:
        engine.dispose()


def _draft(**overrides):
    base = {
        "name": "简历量化改写",
        "description": "把经历改写成带数字的表述",
        "when_to_use": "用户要求量化简历经历时",
        "steps": ["找到可量化的结果", "补上数字与时间范围"],
        "pitfalls": ["不要编造没有的数字"],
    }
    base.update(overrides)
    return skill_learning.parse_skill_draft(base)


def test_parse_skill_draft_requires_all_four_sections():
    assert _draft() is not None
    assert skill_learning.parse_skill_draft({}) is None
    assert _draft(steps=[]) is None
    assert _draft(name="") is None
    assert _draft(when_to_use="") is None
    assert skill_learning.parse_skill_draft({"name": "x"}) is None


def test_generation_triggers():
    """三个触发条件各自成立/不成立；失败步打断连续成功计数。"""
    assert skill_learning.detect_repeat_workflow([["a", "b"], ["a", "b"]]) is True
    assert skill_learning.detect_repeat_workflow([["a"], ["b"]]) is False
    assert skill_learning.detect_repeat_workflow([[], []]) is False

    assert skill_learning.user_requested_persistent_rule(["以后都这么做"]) is True
    assert skill_learning.user_requested_persistent_rule(["帮我改一下简历"]) is False

    assert skill_learning.long_success_trajectory([True] * 5) is True
    assert skill_learning.long_success_trajectory([True, True, False, True, True, True]) is False
    assert skill_learning.long_success_trajectory([True] * 4) is False


def test_failed_trajectory_does_not_generate(db_session):
    """#31F：任一步失败即整条轨迹不合格——检测不到 long_success 触发、也没有草稿。"""
    conversation = ChatConversation(title="失败轨迹")
    db_session.add(conversation)
    db_session.commit()
    records = [{"name": f"tool_{index}", "ok": index != 2} for index in range(6)]
    db_session.add(
        ChatMessage(
            conversation_id=conversation.id,
            role="assistant",
            content="我试了几步但失败了",
            status="complete",
            context={"tool_calls": records},
        )
    )
    db_session.commit()

    result = skill_learning.detect_from_conversation(db_session, conversation.id)

    assert "long_success_trajectory" not in result["triggers"]
    assert result["draft"] is None


def test_successful_trajectory_produces_pending_draft(db_session):
    """连续 5 步成功 → 触发 + 确定性兜底四段草稿。"""
    conversation = ChatConversation(title="成功轨迹")
    db_session.add(conversation)
    db_session.commit()
    records = [{"name": f"tool_{index}", "ok": True} for index in range(5)]
    db_session.add(
        ChatMessage(
            conversation_id=conversation.id,
            role="assistant",
            content="完成了",
            status="complete",
            context={"tool_calls": records},
        )
    )
    db_session.commit()

    result = skill_learning.detect_from_conversation(db_session, conversation.id)

    assert "long_success_trajectory" in result["triggers"]
    draft = skill_learning.parse_skill_draft(result["draft"])
    assert draft is not None
    assert len(draft.steps) == 5


def test_accept_draft_creates_pending_disabled_skill_without_files(db_session):
    """默认不启用：#31D 生成的技能不自动挂到对话、不写知识文件、标 pending。"""
    draft = _draft()
    assert draft is not None
    skill, mode = skill_learning.accept_draft(db_session, draft)

    assert mode == "create"
    assert skill.generated is True
    assert skill.validation_status == skill_learning.SKILL_VALIDATION_PENDING
    assert skill.version == 1
    assert skill.files == []
    assert db_session.query(AssistantConversationSkill).count() == 0
    assert skill.when_to_use == draft.when_to_use
    assert "注意事项" in skill.prompt


def test_accept_draft_updates_near_duplicate_and_bumps_version(db_session):
    """#31E：近义命中 → 提议更新已有技能而不是新建；version 自增、重新待验证。"""
    existing = AssistantSkill(
        name="简历量化改写",
        description="把经历改写成带数字的表述",
        prompt="旧提示词",
        version=3,
    )
    db_session.add(existing)
    db_session.commit()
    draft = _draft(name="简历量化改写方法", description="把经历改写成带量化数字的表述")
    assert draft is not None

    duplicate = skill_learning.near_duplicate_skill(db_session, draft)
    assert duplicate is not None and duplicate.id == existing.id

    skill, mode = skill_learning.accept_draft(db_session, draft, existing_skill=duplicate)

    assert mode == "update"
    assert skill.id == existing.id
    assert skill.version == 4
    assert skill.validation_status == skill_learning.SKILL_VALIDATION_PENDING
    assert db_session.query(AssistantSkill).count() == 1


def test_accept_draft_rejects_same_name_conflict(db_session):
    db_session.add(AssistantSkill(name="简历量化改写", description="x", prompt="x"))
    db_session.commit()
    draft = _draft()
    assert draft is not None
    with pytest.raises(ValueError):
        skill_learning.accept_draft(db_session, draft)


def test_validate_and_archive_candidates(db_session):
    """验证闭环 + 90 天未加载提示归档（只提示，不删除）。"""
    draft = _draft()
    assert draft is not None
    skill, _mode = skill_learning.accept_draft(db_session, draft)
    validated = skill_learning.mark_validated(db_session, skill)
    assert validated.validation_status == skill_learning.SKILL_VALIDATION_VALIDATED

    stale, _mode = skill_learning.accept_draft(
        db_session, _draft(name="长期没用过的技能", description="一年没加载")
    )
    stale.last_loaded_at = utcnow() - timedelta(days=100)
    db_session.commit()
    candidates = skill_learning.archive_candidates(db_session)
    assert [item.id for item in candidates] == [stale.id]
    # 只提示，不自动删：技能仍在。
    assert db_session.get(AssistantSkill, stale.id) is not None


def test_build_skill_prompt_records_load_and_version(db_session):
    """#31E：加载技能时写 last_loaded_at，并把引用版本快照进对话关联行。"""
    from app.services.assistant.assistant_skills import build_skill_prompt

    conversation = ChatConversation(title="技能加载")
    db_session.add(conversation)
    db_session.commit()
    skill = AssistantSkill(
        name="量化改写",
        description="把经历改成数字表述",
        prompt="要求：用数字描述结果",
        version=2,
    )
    db_session.add(skill)
    db_session.commit()
    db_session.add(AssistantConversationSkill(conversation_id=conversation.id, skill_id=skill.id))
    db_session.commit()

    prompt = build_skill_prompt(db_session, conversation.id)

    assert "量化改写" in prompt
    db_session.refresh(skill)
    assert skill.last_loaded_at is not None
    row = db_session.query(AssistantConversationSkill).one()
    assert row.skill_version == 2


def test_api_learning_flow(client, db_session):
    """API 闭环：accept（待验证）→ validate；archive-candidates；detect 证据不足为空。"""
    accepted = client.post(
        "/api/assistant/skills/learning/accept",
        json={
            "draft": {
                "name": "简历量化改写",
                "description": "把经历改写成带数字的表述",
                "when_to_use": "用户要求量化时",
                "steps": ["找结果", "补数字"],
                "pitfalls": ["不要编造"],
            }
        },
    )
    assert accepted.status_code == 201, accepted.text
    body = accepted.json()
    assert body["validation_status"] == "pending"
    assert body["generated"] is True
    assert body["mode"] == "create"

    validated = client.post(f"/api/assistant/skills/learning/{body['skill_id']}/validate")
    assert validated.status_code == 200
    assert validated.json()["validation_status"] == "validated"

    assert client.get("/api/assistant/skills/learning/archive-candidates").json() == []

    conversation = ChatConversation(title="无信号")
    db_session.add(conversation)
    db_session.commit()
    detected = client.get(
        "/api/assistant/skills/learning/detect",
        params={"conversation_id": conversation.id},
    )
    assert detected.status_code == 200
    assert detected.json()["triggers"] == []
    assert detected.json()["draft"] is None


def test_api_rejects_incomplete_draft(client):
    response = client.post(
        "/api/assistant/skills/learning/accept",
        json={
            "draft": {
                "name": "缺步骤",
                "description": "没有步骤",
                "when_to_use": "任意",
                "steps": [],
                "pitfalls": [],
            }
        },
    )
    assert response.status_code == 422

# SPDX-License-Identifier: Apache-2.0
"""#31 收尾守卫（task-4）：待验证技能不可启用 + 记忆抽取执行体复查开关。

两条性质都是"用户关掉/没确认的东西不能自己生效"：

1. 自动生成的技能默认待验证；在**挂到对话**与**启用**两个入口都必须 409，
   直到用户在技能页确认（validation_status=validated）。手写/导入技能不受影响。
2. 记忆抽取任务在空闲时入队，执行时用户可能已经关掉自动整理开关：
   执行体必须复查开关，关闭时零新增记忆（入队侧 should_schedule 的检查不够）。
"""

from __future__ import annotations

import asyncio

from app.models.ai_task import AiTask
from app.models.assistant import AssistantSkill, ChatConversation, ChatMessage
from app.models.assistant_memory import AssistantMemory
from app.services.ai_task_handlers_memory import handle_memory_extract
from app.services.assistant import memory


def _skill(
    db_session,
    *,
    name: str,
    generated: bool = True,
    validation_status: str = "pending",
) -> AssistantSkill:
    skill = AssistantSkill(
        name=name,
        description="测试技能",
        prompt="要求：测试",
        generated=generated,
        validation_status=validation_status,
        version=1,
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    return skill


def _conversation(db_session, title: str = "测试对话") -> ChatConversation:
    conversation = ChatConversation(title=title)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation


# ===== 1. 待验证技能不可启用 =====


def test_pending_skill_cannot_be_attached_to_a_conversation(client, db_session):
    """挂到对话 = 实际启用；pending 技能必须 409，且错误文案指向「先在技能页确认」。"""
    conversation = _conversation(db_session)
    pending = _skill(db_session, name="待验证技能")

    response = client.put(
        f"/api/assistant/conversations/{conversation.id}/skills",
        json={"skill_ids": [pending.id]},
    )

    assert response.status_code == 409, response.text
    assert "待验证" in response.json()["detail"]
    # 拦住了就不能留下半截关联行。
    assert (
        db_session.query(AssistantSkill)
        .filter(AssistantSkill.id == pending.id)
        .one()
        .validation_status
        == "pending"
    )


def test_validated_skill_can_be_attached(client, db_session):
    conversation = _conversation(db_session)
    validated = _skill(db_session, name="已验证技能", validation_status="validated")

    response = client.put(
        f"/api/assistant/conversations/{conversation.id}/skills",
        json={"skill_ids": [validated.id]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["skill_ids"] == [validated.id]


def test_manual_skill_is_not_affected_by_the_pending_guard(client, db_session):
    """手写/导入技能 generated=False 且 validation_status 为空：照常可挂。"""
    conversation = _conversation(db_session)
    manual = _skill(db_session, name="手写技能", generated=False, validation_status="")

    response = client.put(
        f"/api/assistant/conversations/{conversation.id}/skills",
        json={"skill_ids": [manual.id]},
    )

    assert response.status_code == 200, response.text


def test_pending_skill_cannot_be_enabled_via_patch(client, db_session):
    """旧工作台的启用开关接口同样拦：pending → 409；validated → 200。"""
    pending = _skill(db_session, name="待验证开关")
    response = client.patch(f"/api/assistant/skills/{pending.id}", json={"enabled": True})
    assert response.status_code == 409, response.text
    assert "待验证" in response.json()["detail"]

    validated = _skill(db_session, name="已验证开关", validation_status="validated")
    ok = client.patch(f"/api/assistant/skills/{validated.id}", json={"enabled": True})
    assert ok.status_code == 200, ok.text
    assert ok.json()["enabled"] is True


def test_pending_skill_cannot_be_enabled_via_put_update(client, db_session):
    """F1（交叉复核 P2）：整份更新入口 PUT /api/assistant/skills/{id} 也不能启用 pending。

    action 契约层把 PendingSkillError 映射成 conflict → HTTP 409（detail 是
    {code, message} 结构）；assistant_skills.update_skill 的同一道闸也保护助手工具路径。
    """
    pending = _skill(db_session, name="PUT 待验证")
    response = client.put(f"/api/assistant/skills/{pending.id}", json={"enabled": True})
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    message = detail.get("message", "") if isinstance(detail, dict) else str(detail)
    assert "待验证" in message
    # 整份更新里夹带 enabled 同样拦（不能借改描述绕过）。
    mixed = client.put(
        f"/api/assistant/skills/{pending.id}",
        json={"description": "新描述", "enabled": True},
    )
    assert mixed.status_code == 409, mixed.text

    validated = _skill(db_session, name="PUT 已验证", validation_status="validated")
    assert (
        client.put(f"/api/assistant/skills/{validated.id}", json={"enabled": True}).status_code
        == 200
    )

    manual = _skill(db_session, name="PUT 手工", generated=False, validation_status="")
    manual_ok = client.put(f"/api/assistant/skills/{manual.id}", json={"enabled": True})
    assert manual_ok.status_code == 200, manual_ok.text
    assert manual_ok.json()["enabled"] is True


def test_pending_skill_cannot_be_attached_at_conversation_creation(client, db_session):
    """新建会话时带技能同样拦（避免绕过 PUT 的另一条入口）。"""
    pending = _skill(db_session, name="建会话时待验证")

    response = client.post(
        "/api/assistant/conversations",
        json={"title": "新对话", "skill_ids": [pending.id]},
    )

    assert response.status_code == 409, response.text


# ===== 2. 记忆抽取执行体复查开关 =====


class _Context:
    """最小 AiTaskContext stub：只记录调用，不真起线程。"""

    def __init__(self, session, payload):
        self.session = session
        self.payload = payload
        self.result_ref = None
        self.progress: list[tuple[int, str]] = []
        self.driven = 0

    def set_progress(self, progress: int, message: str = "") -> None:
        self.progress.append((int(progress), message))

    def set_result(self, result_ref: dict) -> None:
        self.result_ref = result_ref

    def check_canceled(self) -> None:
        return None

    def drive(self, coro) -> None:
        self.driven += 1
        asyncio.run(coro)


def _seed_extractable_conversation(db_session) -> ChatConversation:
    conversation = _conversation(db_session, title="可抽取对话")
    db_session.add_all(
        [
            ChatMessage(
                conversation_id=conversation.id,
                role="user",
                content="我只看杭州和上海的机会",
                status="complete",
            ),
            ChatMessage(
                conversation_id=conversation.id,
                role="assistant",
                content="好的，只记杭州和上海。",
                status="complete",
            ),
        ]
    )
    db_session.commit()
    return conversation


def test_memory_extract_skips_when_switch_was_turned_off_after_enqueue(db_session):
    """开启 → 入队 → 用户关掉 → 执行：零新增记忆，任务按成功跳过收尾。"""
    conversation = _seed_extractable_conversation(db_session)
    memory.set_auto_extract(db_session, True)
    # 模拟"入队之后用户又关掉"：任务行仍在，执行时开关为 false。
    db_session.add(
        AiTask(
            kind="assistant_memory_extract",
            payload={"conversation_id": conversation.id},
            label="整理助手记忆",
        )
    )
    db_session.commit()
    memory.set_auto_extract(db_session, False)

    ctx = _Context(db_session, {"conversation_id": conversation.id})
    handle_memory_extract(ctx)

    assert db_session.query(AssistantMemory).count() == 0
    assert ctx.result_ref == {
        "conversation_id": conversation.id,
        "skipped": "disabled",
    }
    assert ctx.driven == 0, "开关关闭时不应再调模型"


def test_memory_extract_runs_when_switch_is_on(db_session, monkeypatch):
    """开关打开时执行体照常抽取（空结果也算成功），证明复查没有误伤正常路径。"""
    conversation = _seed_extractable_conversation(db_session)
    memory.set_auto_extract(db_session, True)

    class _Provider:
        async def chat(self, messages):
            return "[]"

    monkeypatch.setattr(
        "app.services.ai_task_handlers_memory.create_provider",
        lambda config: _Provider(),
    )
    monkeypatch.setattr("app.services.ai_task_handlers_memory.get_llm_config", lambda db: None)
    ctx = _Context(db_session, {"conversation_id": conversation.id})

    handle_memory_extract(ctx)

    assert ctx.result_ref is not None
    assert ctx.result_ref.get("parsed") is True
    assert db_session.query(AssistantMemory).count() == 0

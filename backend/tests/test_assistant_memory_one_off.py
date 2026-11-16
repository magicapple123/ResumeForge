# SPDX-License-Identifier: Apache-2.0
"""I-05 一次性动作过滤（从 ``test_assistant_memory`` 拆出，原文件已顶 500 行硬预算）。

三条判据：动作词开头的 value 判为一次性；整条丢弃（不是存下来再过滤）；
带稳定描述标志的仍算偏好，不能误杀。
"""

from app.models.assistant_memory import AssistantMemory
from app.services.assistant import memory


def test_one_off_action_filter_drops_action_phrases():
    """I-05：以动作词开头且不含稳定描述的 value 一律判为一次性动作。"""
    for value in ("投递后端开发岗位", "帮我看看这份作品集", "改一下这段话", "看看那份总结"):
        assert memory.is_one_off_action(value) is True, value
    # 边界样例：带稳定描述标志的仍算偏好（明确长期方向），不能误杀。
    for value in ("投递后端开发（长期方向）", "后端开发", "只看杭州和上海"):
        assert memory.is_one_off_action(value) is False, value


def test_apply_operations_rejects_one_off_target_role(db_session):
    """I-05 验收①：模型把「投后端岗」记成 target_role 时，落库前整条丢弃。"""
    counts = memory.apply_operations(
        db_session,
        [
            {"op": "ADD", "kind": "target_role", "value": "投递后端开发岗位"},
            {"op": "ADD", "kind": "target_role", "value": "帮我看看这份作品集"},
        ],
    )

    assert counts["dropped"] == 2
    assert counts["add"] == 0
    assert db_session.query(AssistantMemory).count() == 0


def test_apply_operations_keeps_stable_preferences_when_action_words_appear(db_session):
    """I-05 验收②：「我只找上海或杭州的后端岗」仍产出 target_role + city。"""
    counts = memory.apply_operations(
        db_session,
        [
            {"op": "ADD", "kind": "target_role", "value": "后端开发"},
            {"op": "ADD", "kind": "city", "value": "上海"},
            {"op": "ADD", "kind": "city", "value": "杭州", "key": "杭州"},
        ],
    )

    assert counts["dropped"] == 0
    active = {(item.kind, item.value) for item in memory.active_memories(db_session)}
    assert ("target_role", "后端开发") in active
    assert {kind for kind, _ in active if kind == "city"} == {"city"}
    assert len([v for k, v in active if k == "city"]) == 2

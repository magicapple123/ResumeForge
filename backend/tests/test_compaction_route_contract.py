# SPDX-License-Identifier: Apache-2.0
"""守卫：``POST /api/assistant/conversations/{id}/compact`` 的**失败契约**是 503，不是 500。

三段式改造（准备 worker → 摘要模型 → 落库 worker）把"建不出 provider"挪进了准备段，
于是 ``CompactionUnavailable`` 有了**两个**抛出点：准备段和摘要调用。两处都表示"模型这会儿
不可用"——用户稍后重试有意义，原文与既有摘要一条都没被动过。任何一个漏出 ``except``
都会被应用的兜底处理器翻成 500，前端就再也给不出"稍后重试"的引导语。

既有用例（``tests/test_assistant_compaction.py``，488 行）覆盖 dry-run 不写库、404、设置项
往返，但没有一条钉 503；那个文件已贴 500 行预算，所以这条契约单独放这里。
"""

from __future__ import annotations

from typing import Any

import pytest
from app.models.assistant import ChatMessage
from app.services.assistant import assistant_compaction_store as store
from test_assistant import _create_conversation


def _history(client: Any, db_session: Any, rounds: int = 8) -> int:
    """建一个"有可摘要内容"的会话（8 轮，最近 6 轮不动，最旧 2 轮可压）。"""
    conversation_id = int(_create_conversation(client)["id"])
    for index in range(rounds):
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="user",
                content=f"第 {index + 1} 轮提问：" + "问" * 60,
                status="complete",
            )
        )
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="assistant",
                content=f"第 {index + 1} 轮回答：" + "答" * 60,
                status="complete",
            )
        )
    db_session.commit()
    return conversation_id


def test_real_run_without_usable_model_returns_503(client: Any, db_session: Any) -> None:
    """没配模型就真跑：503（不是 500），且**不写库**——原文与摘要都保持原样。"""
    conversation_id = _history(client, db_session)

    response = client.post(f"/api/assistant/conversations/{conversation_id}/compact", json={})

    assert response.status_code == 503, response.text
    assert "尚未配置" in response.json()["detail"] or response.json()["detail"]
    db_session.expire_all()
    assert store.load_compaction(db_session, conversation_id) == {}, "失败不写库"


def test_unavailable_in_prepare_phase_also_maps_to_503(
    client: Any, db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """准备段抛 ``CompactionUnavailable`` 也必须落 503。

    这条正是审接线时发现的洞：``plan_manual_compaction`` 在"建 provider 抛异常"时抛同一个
    异常类，如果调用点在 ``try`` 外，异常会一路冒到应用的兜底处理器 → 500。
    """
    conversation_id = _history(client, db_session)

    def boom(_db: Any, _conversation_id: int, *, dry_run: bool) -> Any:  # noqa: ANN401
        raise store.CompactionUnavailable("尚未配置大模型 API")

    monkeypatch.setattr("app.api.assistant_compaction_api.plan_manual_compaction", boom)

    response = client.post(f"/api/assistant/conversations/{conversation_id}/compact", json={})

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "尚未配置大模型 API"

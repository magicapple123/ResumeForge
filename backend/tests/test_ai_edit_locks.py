# SPDX-License-Identifier: Apache-2.0
"""W06 lock_content 的服务端闸门集成测试（AI 写入路径）。

契约（be-prov 的 fact_locks.enforce_ai_content 是唯一入口）：无违规正常落库；锁定条目正文
被改/被删 → 409 + code="fact_lock_conflict"，violations 含 kind="lock_content"/field="content"/
lock_id=0/固定 reason；隐藏与锁标记不算正文变化；事实锁与正文锁叠加时一次返回全部违规；
用户手写保存（PUT content）不经过闸门——锁的是 AI 行为。走真实 HTTP 端点（/revise）。
"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig

CONTENT_LOCK_CHANGED = "锁定条目正文被改动"
CONTENT_LOCK_MISSING = "锁定条目在本次修改后已不存在"


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
                "lock_content": True,
            },
        ],
    }


def _create_resume(client, content: dict | None = None) -> int:
    payload = {"title": "正文锁测试", "content": content or _content()}
    response = client.post("/api/resumes/manual", json=payload)
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _record(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    async def chat(self, messages, *, thinking: bool = True):
        return json.dumps(self._payload, ensure_ascii=False)


def _install_provider(monkeypatch, payload: dict) -> None:
    provider = FakeProvider(payload)

    def _get_config(db):  # noqa: ANN001 - 与既有 patch 契约一致
        return LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        )

    monkeypatch.setattr("app.api.resumes.get_llm_config", _get_config)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: provider)


def _revise(client, resume_id: int, base_revision: int):
    return client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "把表达改得更精炼", "base_revision": base_revision},
    )


def test_revision_without_locks_still_writes_body(client, monkeypatch):
    """基线：没有锁时 AI 修订照常落库（闸门不能误伤正常路径）。"""
    entry = {"company": "示例科技有限公司", "role": "后端实习生", "description": ["原有要点"]}
    plain = {"name": "张示例", "summary": "一段总结", "experience": [entry]}
    resume_id = _create_resume(client, plain)
    before = _record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {"company": "示例科技有限公司", "role": "后端实习生", "description": ["原有要点"]}
            ],
        },
    )

    response = _revise(client, resume_id, before["revision"])
    assert response.status_code == 200, response.text
    assert response.json()["content"]["summary"] == "改过的总结"
    assert _record(client, resume_id)["content"]["summary"] == "改过的总结"


def test_locked_entry_content_change_is_rejected_with_stable_code(client, monkeypatch):
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["改写了锁定条目的正文"],
                },
            ],
        },
    )

    response = _revise(client, resume_id, before["revision"])

    assert response.status_code == 409, response.text
    payload = response.json()
    assert payload["code"] == "fact_lock_conflict"
    lock = next(item for item in payload["violations"] if item["kind"] == "lock_content")
    assert lock["lock_id"] == 0
    assert lock["field"] == "content"
    assert lock["path"] == "experience.0"
    assert lock["reason"] == CONTENT_LOCK_CHANGED
    assert lock["locked_value"] == "" and lock["current_value"] == ""
    # 拒绝时一个字段都不写：正文与版本号都不变。
    after = _record(client, resume_id)
    assert after["content"] == before["content"]
    assert after["revision"] == before["revision"]


def test_partial_lock_keeps_locked_entry_and_allows_unlocked_change(client, monkeypatch):
    """部分锁定：锁定的那条原样保留（锁标记由服务端补回），未锁的那条可以改。"""
    content = {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["锁定条目的原文"],
                "lock_content": True,
            },
            {
                "id": "expobj0002",
                "company": "另一家公司",
                "role": "后端实习生",
                "description": ["未锁条目的原文"],
            },
        ],
    }
    resume_id = _create_resume(client, content)
    before = _record(client, resume_id)
    # 模型输出通常不带 id/锁标记：锁定条目按"同栏目同下标"仍要被认出且正文逐字未变。
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["锁定条目的原文"],
                },
                {
                    "company": "另一家公司",
                    "role": "后端实习生",
                    "description": ["未锁条目改写后的正文"],
                },
            ],
        },
    )

    response = _revise(client, resume_id, before["revision"])

    assert response.status_code == 200, response.text
    saved = _record(client, resume_id)["content"]["experience"]
    assert saved[0]["description"] == ["锁定条目的原文"]
    # 锁标记是服务端状态：模型没回显也必须还在，否则"AI 一改写，锁自动消失"。
    assert saved[0]["lock_content"] is True
    assert saved[1]["description"] == ["未锁条目改写后的正文"]


def test_deleting_a_locked_entry_is_rejected(client, monkeypatch):
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    _install_provider(monkeypatch, {"summary": "只剩总结的简历"})

    response = _revise(client, resume_id, before["revision"])

    assert response.status_code == 409, response.text
    payload = response.json()
    assert payload["code"] == "fact_lock_conflict"
    lock = next(item for item in payload["violations"] if item["kind"] == "lock_content")
    assert lock["reason"] == CONTENT_LOCK_MISSING
    assert lock["path"] == "experience.0"
    assert _record(client, resume_id)["content"] == before["content"]


def test_hidden_and_lock_flags_are_not_content_changes(client, monkeypatch):
    """隐藏/锁标记本身不算正文变化：锁的是内容，不是可见性开关。"""
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "一段总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["负责合成数据接口"],
                    "hidden": True,
                }
            ],
        },
    )

    response = _revise(client, resume_id, before["revision"])

    assert response.status_code == 200, response.text
    saved = _record(client, resume_id)["content"]["experience"][0]
    # 隐藏标记属于可见性状态、由客户端保存；AI 输出里的 hidden 不进入正文。
    assert saved["lock_content"] is True
    assert saved["description"] == ["负责合成数据接口"]


def test_lock_flag_and_hidden_changes_are_not_content_payload():
    """纯函数口径：隐藏/锁标记的变化不算"正文被改动"（只有正文载荷参与比较）。"""
    from types import SimpleNamespace

    from app.services.resume import fact_locks

    old = {
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例公司",
                "role": "工程师",
                "description": ["原有要点"],
                "lock_content": True,
            }
        ]
    }
    candidate = {
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例公司",
                "role": "工程师",
                "description": ["原有要点"],
                "lock_content": False,
                "hidden": True,
                "lock_layout": True,
            }
        ]
    }
    assert fact_locks.validate_content_locks(SimpleNamespace(content=old), candidate) == []


def test_content_lock_and_fact_lock_stack_together(client, monkeypatch):
    """正文锁与事实锁叠加：一次 409 返回两类违规（不让用户逐次试错）。"""
    resume_id = _create_resume(client)
    locked = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "number", "path": "summary"},
    )
    assert locked.status_code == 201, locked.text
    before = _record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["同时改了锁定条目的正文"],
                }
            ],
        },
    )

    response = _revise(client, resume_id, before["revision"])

    assert response.status_code == 409, response.text
    violations = response.json()["violations"]
    kinds = {item["kind"] for item in violations}
    assert "lock_content" in kinds, violations
    assert kinds - {"lock_content"}, violations  # 事实锁违规也在同一份 409 里
    assert _record(client, resume_id)["content"] == before["content"]


def test_manual_content_save_by_the_user_is_not_blocked(client):
    """锁的是 AI 行为：用户自己手写保存锁定条目必须成功（否则锁等于不可编辑）。"""
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    content = before["content"]
    content["experience"][0]["description"] = ["用户自己改的正文"]

    response = client.put(f"/api/resumes/{resume_id}/content", json={"content": content})
    assert response.status_code == 200, response.text
    saved = _record(client, resume_id)["content"]["experience"][0]
    assert saved["description"] == ["用户自己改的正文"]
    assert saved["lock_content"] is True

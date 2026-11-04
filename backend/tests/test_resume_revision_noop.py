# SPDX-License-Identifier: Apache-2.0
"""问题 16：「AI 修改简历」的两处静默无操作必须变成可判断的结果。

三条不变量（对应问题清单的验收 1–4）：

1. **空指令 = 整体重写**：走的是重写提示词，要求每个文本块都给新值；模型拿空 updates
   回来按失败处理（502 + 可重试），不落库、不报"修改成功"。
2. **有指令但模型没执行**：409 + ``revision_not_applied``，并列出被事实锁挡住的字段。
3. **正常指令不回退**：只改点名项，其余逐字保留。

2026-11-03 实测的现象是 R2（空指令，6 tokens，正文一字未变）与 R3（要求改公司名，HTTP 200
但正文没变、没有任何提示）。这两条都在这里钉住。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.base import LLMError
from app.services.resume.document_revision import (
    REVISION_NOT_APPLIED_CODE,
    RevisionNotApplied,
    editable_document_values,
    revise_document,
)
from tests.document_test_support import make_document

COMPANY = "云启数据科技有限公司"


def _doc() -> dict:
    return make_document(
        header=[
            {
                "kind": "field",
                "id": "hd0000001",
                "key": "name",
                "value": "张示例",
                "placement": "name",
            }
        ],
        sections=[
            {
                "key": "summary",
                "kind": "text",
                "entries": [
                    {
                        "id": "en0000001",
                        "items": [{"kind": "text", "id": "tx0000001", "text": "负责后端接口开发"}],
                    }
                ],
            },
            {
                "key": "experience",
                "kind": "entries",
                "entries": [
                    {
                        "id": "en0000002",
                        "items": [
                            {
                                "kind": "field",
                                "id": "fd0000001",
                                "key": "company",
                                "value": COMPANY,
                                "placement": "title",
                            },
                            {
                                "kind": "field",
                                "id": "fd0000002",
                                "key": "start_date",
                                "value": "2021-03",
                                "placement": "meta",
                            },
                            {"kind": "text", "id": "tx0000002", "text": "实现订单查询接口"},
                        ],
                    }
                ],
            },
        ],
    )


def _text_values(document: dict) -> list[dict]:
    return [item for item in editable_document_values(document) if item["key"] == "text"]


def _field(document: dict, key: str) -> object:
    return next(item["value"] for item in editable_document_values(document) if item["key"] == key)


def _provider(payload: dict | str):
    """假 provider：把 ``payload`` 原样当模型输出（dict 会被序列化）。"""

    class FakeProvider:
        def __init__(self) -> None:
            self.messages: list[dict] = []

        async def chat(self, messages, *, thinking: bool = True):
            self.messages = messages
            return payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    return FakeProvider()


class _RewriteProvider:
    """模拟"整体重写"：所有 text 块都换一种说法，事实字段一字不动。"""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def chat(self, messages, *, thinking: bool = True):
        self.messages = messages
        updates = [
            {"path": item["path"], "value": f"{item['value']}（重写后的表述）"}
            for item in _text_values(_doc())
        ]
        return json.dumps({"updates": updates}, ensure_ascii=False)


# ===== 1. 空指令走「重写」提示词 =====


@pytest.mark.asyncio
async def test_empty_instruction_switches_to_the_rewrite_rules():
    provider = _RewriteProvider()

    revised = await revise_document(provider, _doc(), None, "   ")

    system = provider.messages[0]["content"]
    assert "整体重写" in system
    # 旧的廉价出口必须消失：它给了模型"返回空数组"这个零成本选项。
    assert "无须修改时返回空 updates" not in system
    assert "空 updates 数组" not in system
    # 表达变了、事实逐字不变。
    assert _text_values(revised)[0]["value"] == "负责后端接口开发（重写后的表述）"
    assert _field(revised, "company") == COMPANY
    assert _field(revised, "start_date") == "2021-03"


@pytest.mark.asyncio
async def test_targeted_instruction_keeps_the_verbatim_rule():
    provider = _provider({"updates": [{"path": _text_values(_doc())[0]["path"], "value": "精简"}]})

    revised = await revise_document(provider, _doc(), None, "把总结改短")

    system = provider.messages[0]["content"]
    assert "逐字保留" in system
    assert "整体重写" not in system
    assert _text_values(revised)[0]["value"] == "精简"
    # 没被点名的字段逐字保留（含事实）。
    assert _field(revised, "company") == COMPANY


# ===== 2. 空 updates：两种原因分开报 =====


@pytest.mark.asyncio
async def test_empty_rewrite_output_is_a_retryable_error_not_a_silent_success():
    provider = _provider({"updates": []})

    with pytest.raises(LLMError) as excinfo:
        await revise_document(provider, _doc(), None, "")

    # 空指令下"什么都没写"是模型没干活，可重试；不是用户的错，也不是事实锁的错。
    assert not isinstance(excinfo.value, RevisionNotApplied)
    assert "重写" in str(excinfo.value)


@pytest.mark.asyncio
async def test_rewrite_that_returns_the_same_wording_is_rejected():
    """一字未改的"重写"等于没重写：不能落库后回一句"修改成功"。"""
    updates = [{"path": item["path"], "value": item["value"]} for item in _text_values(_doc())]

    with pytest.raises(LLMError):
        await revise_document(_provider({"updates": updates}), _doc(), None, "")


@pytest.mark.asyncio
async def test_empty_updates_with_an_instruction_names_the_fact_field():
    provider = _provider({"updates": []})

    with pytest.raises(RevisionNotApplied) as excinfo:
        await revise_document(provider, _doc(), None, f"把公司名「{COMPANY}」改成「字节跳动」")

    targets = excinfo.value.targets
    assert [item["value"] for item in targets] == [COMPANY]
    assert [item["kind"] for item in targets] == ["institution"]
    # 只报用户点名的那一项，不把整份简历列成"被挡住"。
    assert len(targets) == 1


@pytest.mark.asyncio
async def test_empty_updates_without_a_named_fact_field_reports_no_fields():
    with pytest.raises(RevisionNotApplied) as excinfo:
        await revise_document(_provider({"updates": []}), _doc(), None, "再润色一下")

    assert excinfo.value.targets == []


# ===== 3. 正常指令不回退（API 落库）+ 两条明确响应 =====


def _install_provider(monkeypatch, payload: dict) -> None:
    provider = _provider(payload)

    def _get_config(_db):  # noqa: ANN001 - 与既有 patch 契约一致
        return LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        )

    monkeypatch.setattr("app.api.resumes.get_llm_config", _get_config)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: provider)


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={
            "title": "静默无操作回归",
            "content": {
                "name": "张示例",
                "summary": "一段总结",
                "experience": [
                    {"company": "示例公司", "role": "后端工程师", "description": ["原有要点"]}
                ],
            },
        },
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _record(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_instruction_the_model_ignores_returns_409_with_the_blocked_field(client, monkeypatch):
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    _install_provider(monkeypatch, {"updates": []})

    response = client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "把公司名「示例公司」改成「字节跳动」"},
    )

    assert response.status_code == 409, response.text
    payload = response.json()
    assert payload["code"] == REVISION_NOT_APPLIED_CODE
    assert "请" not in payload["detail"]  # detail 只写原因，动作由前端 errorGuidance 给
    assert [item["value"] for item in payload["blocked_fields"]] == ["示例公司"]
    # 不落库：正文与版本都没动。
    after = _record(client, resume_id)
    assert after["revision"] == before["revision"]
    assert after["content"] == before["content"]


def test_empty_instruction_with_empty_updates_is_502_and_does_not_save(client, monkeypatch):
    resume_id = _create_resume(client)
    before = _record(client, resume_id)
    _install_provider(monkeypatch, {"updates": []})

    response = client.post(f"/api/resumes/{resume_id}/revise", json={"instructions": ""})

    assert response.status_code == 502, response.text
    assert "重写" in response.json()["detail"]
    after = _record(client, resume_id)
    assert after["revision"] == before["revision"]
    assert after["content"] == before["content"]


def test_targeted_change_still_saves(client, monkeypatch):
    """反向守卫：真改了表达的正常指令照旧落库，别把整条路径拦掉。"""
    resume_id = _create_resume(client)
    _install_provider(
        monkeypatch,
        {
            "summary": "改写后的总结",
            "experience": [
                {"company": "示例公司", "role": "后端工程师", "description": ["原有要点"]}
            ],
        },
    )

    response = client.post(
        f"/api/resumes/{resume_id}/revise", json={"instructions": "把总结改得更精炼"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["revision"] == _record(client, resume_id)["revision"]

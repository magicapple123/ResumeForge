"""按用户指令修订简历（局部修改 / 整体重生成）的边界与落库行为。

风险点集中在两处：**身份字段绝不能被模型改变**（提示词里根本不给，输出后代码回填），
以及**模型输出一份"空简历"时必须拒绝**而不是把用户现有内容覆盖掉。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.resume import ResumeContent
from app.schemas.setting import LLMConfig
from app.services.llm.base import LLMError
from app.services.resume.resume_revision import MAX_INSTRUCTION_CHARS, revise_resume


def _content() -> ResumeContent:
    return ResumeContent(
        name="张示例",
        phone="13800000000",
        email="zhang@example.com",
        # 1×1 透明 PNG：photo 字段有"内容与声明格式一致"的校验，不能用假串。
        photo=(
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        summary="一段总结",
        experience=[
            {
                "company": "示例科技有限公司",
                "role": "示例岗位",
                "description": ["负责示例模块开发"],
            }
        ],
        skills=[{"name": "Python", "level": "熟练"}],
    )


def _revised_payload(summary: str = "改过的总结") -> str:
    """模型输出：只含业务内容，不含任何身份字段（与真实行为一致）。"""
    return json.dumps(
        {
            "summary": summary,
            "experience": [
                {"company": "示例科技有限公司", "role": "示例岗位", "description": ["负责示例模块开发"]}
            ],
            "skills": [{"name": "Python", "level": "熟练"}],
        },
        ensure_ascii=False,
    )


@pytest.mark.asyncio
async def test_identity_fields_are_restored_from_the_original_resume():
    """身份字段不进提示词、输出后由代码回填——模型看不见也改不了。"""
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages):
            captured["system"] = messages[0]["content"]
            captured["prompt"] = messages[-1]["content"]
            return _revised_payload()

    original = _content()
    revised = await revise_resume(FakeProvider(), original, None, "把总结改得更精炼")

    assert revised.name == "张示例"
    assert revised.phone == "13800000000"
    assert revised.email == "zhang@example.com"
    assert revised.photo.startswith("data:image/png;base64,")
    assert revised.summary == "改过的总结"
    # 提示词里不能出现任何身份字段值。
    assert "张示例" not in captured["prompt"]
    assert "13800000000" not in captured["prompt"]
    assert "zhang@example.com" not in captured["prompt"]


@pytest.mark.asyncio
async def test_targeted_mode_states_the_change_scope():
    """局部模式：指令与"只改提出的内容"的约束必须出现在提示词里。"""
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages):
            captured["prompt"] = messages[-1]["content"]
            return _revised_payload()

    await revise_resume(FakeProvider(), _content(), None, "把总结改得更精炼")

    assert "把总结改得更精炼" in captured["prompt"]
    assert "逐字保留" in captured["prompt"]
    assert "整体重新生成" not in captured["prompt"].split("修改要求")[-1]


@pytest.mark.asyncio
async def test_full_regenerate_mode_is_explicit():
    """空指令 = 整体重生成：提示词切换到"事实不变、表达重写"分支。"""
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages):
            captured["prompt"] = messages[-1]["content"]
            return _revised_payload()

    await revise_resume(FakeProvider(), _content(), None, "   ")

    assert "整体重新生成" in captured["prompt"]
    # 局部模式的占位不能渲染出用户指令段（空指令渲染后不该有"逐字保留"约束）。
    assert "逐字保留" not in captured["prompt"]


@pytest.mark.asyncio
async def test_instructions_longer_than_budget_are_truncated():
    assert MAX_INSTRUCTION_CHARS == 2000
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages):
            captured["prompt"] = messages[-1]["content"]
            return _revised_payload()

    long_instruction = "改" * (MAX_INSTRUCTION_CHARS + 500)
    await revise_resume(FakeProvider(), _content(), None, long_instruction)
    assert "改" * MAX_INSTRUCTION_CHARS in captured["prompt"]
    assert "改" * (MAX_INSTRUCTION_CHARS + 1) not in captured["prompt"]


@pytest.mark.asyncio
async def test_empty_model_output_is_rejected():
    """模型输出空 JSON 会被解析成"只剩身份字段的空简历"，必须拒绝而不是落库。"""

    class FakeProvider:
        async def chat(self, _messages):
            return "{}"

    with pytest.raises(LLMError):
        await revise_resume(FakeProvider(), _content(), None, "改点什么")


@pytest.mark.asyncio
async def test_unparsable_output_raises_llm_error():
    class FakeProvider:
        async def chat(self, _messages):
            return "这不是 JSON"

    with pytest.raises(LLMError):
        await revise_resume(FakeProvider(), _content(), None, "改点什么")


def test_oversized_resume_is_rejected_before_calling_the_model():
    """简历超出安全预算时如实拒绝：截断再回填会把"逐字保留"变成谎言。"""
    from app.services.resume.resume_revision import _resume_prompt_json

    # summary 的 schema 上限是 50000 字，取 20000 字即可越过 12000 的提示词预算。
    huge = ResumeContent(name="张示例", summary="字" * 20_000)
    with pytest.raises(ValueError):
        _resume_prompt_json(huge)


# ===== API 集成：/resumes/{id}/revise =====


@pytest.fixture()
def _resume_record(client):
    """直接建一条手写简历记录，返回它的 id。"""
    resp = client.post(
        "/api/resumes/manual",
        json={
            "job_id": None,
            "content": {
                "name": "张示例",
                "phone": "13800000000",
                "summary": "原始总结",
                "experience": [
                    {"company": "示例公司", "role": "工程师", "description": ["原有要点"]}
                ],
            },
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_revise_requires_llm_config(client, _resume_record):
    response = client.post(
        f"/api/resumes/{_resume_record}/revise", json={"instructions": "改一下总结"}
    )
    assert response.status_code == 400
    assert "配置大模型" in response.json()["detail"]


def test_revise_updates_the_record_and_clears_warnings(
    client, _resume_record, monkeypatch
):
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="integration-secret",
        model="integration-model",
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200
    # 先给记录塞一条旧告警，修订后应被清空（旧告警基于旧正文，不再适用）。
    from app.database import SessionLocal
    from app.models.resume import ResumeRecord

    db = SessionLocal()
    try:
        record = db.get(ResumeRecord, _resume_record)
        record.warnings = ["旧的告警"]
        db.commit()
    finally:
        db.close()

    class FakeProvider:
        async def chat(self, _messages):
            return json.dumps(
                {
                    "summary": "修订后的总结",
                    "experience": [
                        {"company": "示例公司", "role": "工程师", "description": ["原有要点"]}
                    ],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr(
        "app.api.resumes.create_provider", lambda _config: FakeProvider()
    )
    response = client.post(
        f"/api/resumes/{_resume_record}/revise", json={"instructions": "把总结改成：修订后的总结"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content"]["summary"] == "修订后的总结"
    # 身份字段由服务端回填，即使模型输出里没有。
    assert body["content"]["name"] == "张示例"
    assert body["warnings"] == []

    # 修订写回的是同一条记录，不新建。
    listing = client.get("/api/resumes").json()
    assert listing["total"] == 1

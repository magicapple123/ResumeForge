"""测试连接探针的短输出契约：max_tokens 压到 64，连通性检查不陪跑长生成。

用户反馈"快模型测连接也要等很久"：探针原本继承用户配置的输出上限（或不限制），
一次最小对话也要等模型把完整长度跑完。压缩后探针只验证"模型回话了"。
"""

from app.schemas.setting import LLMConfig


def test_probe_caps_max_tokens(client, db_session, monkeypatch):
    captured: dict[str, int] = {}

    class FakeProvider:
        async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
            return "正常"

    def fake_create_provider(resolved):
        captured["max_tokens"] = resolved.max_tokens
        return FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=LLMConfig(
            base_url="https://api.example.com/v1", api_key="k", model="m", max_tokens=4096
        ).model_dump(),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["max_tokens"] == 64


def test_probe_caps_unlimited_output_too(client, db_session, monkeypatch):
    captured: dict[str, int] = {}

    class FakeProvider:
        async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
            return "正常"

    def fake_create_provider(resolved):
        captured["max_tokens"] = resolved.max_tokens
        return FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=LLMConfig(
            base_url="https://api.example.com/v1", api_key="k", model="m", max_tokens=0
        ).model_dump(),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["max_tokens"] == 64

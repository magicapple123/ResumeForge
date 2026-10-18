"""全局 AI 润色（R17）：选区润色接口的校验、模型未配置、提示词约束与失败口径。"""

import json

import pytest
from app.schemas.resume_writing import (
    MAX_SELECTION_INSTRUCTION_CHARS,
    MAX_SELECTION_TEXT_CHARS,
    PolishSelectionRequest,
)
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMError
from app.services.resume.resume_writing import polish_selection
from pydantic import ValidationError

POLISH_PATH = "/api/writing/polish-selection"
SELECTED_TEXT = "负责后端接口开发，接口稳定性不错"
INSTRUCTION = "改成 STAR 结构"


class SelectionProvider(BaseLLMProvider):
    """返回预设 JSON 的假模型，并记录它收到的消息，供断言提示词约束。"""

    def __init__(self, payload):
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.payload = payload
        self.messages: list[list[dict]] = []

    async def chat(self, messages, *, thinking: bool = True):
        self.messages.append(messages)
        return json.dumps(self.payload, ensure_ascii=False)

    async def stream_chat(self, messages):
        yield ""


def _use_provider(monkeypatch, provider) -> None:
    monkeypatch.setattr("app.api.resume_writing.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.resume_writing.create_provider", lambda _config: provider)


def test_selection_polish_requires_a_model(client):
    """没有模型时给的是「去设置页配置」这句可执行提示，而不是 500。"""
    response = client.post(POLISH_PATH, json={"text": SELECTED_TEXT, "instruction": ""})
    assert response.status_code == 400
    assert "配置大模型" in response.json()["detail"]


def test_selection_polish_rejects_text_longer_than_the_limit(client):
    """超长选中文本在 schema 层就 422：不外发，也不悄悄截断后只润色半段。"""
    response = client.post(POLISH_PATH, json={"text": "字" * (MAX_SELECTION_TEXT_CHARS + 1)})
    assert response.status_code == 422


def test_selection_polish_rejects_instruction_longer_than_the_limit(client):
    response = client.post(
        POLISH_PATH,
        json={
            "text": SELECTED_TEXT,
            "instruction": "改" * (MAX_SELECTION_INSTRUCTION_CHARS + 1),
        },
    )
    assert response.status_code == 422


def test_selection_polish_rejects_blank_text_and_unknown_fields():
    """纯空白没有语义；多余字段一律拒收（extra="forbid"，挡住"顺手带上整份简历"）。"""
    with pytest.raises(ValidationError):
        PolishSelectionRequest(text="   \n\t ")
    with pytest.raises(ValidationError):
        PolishSelectionRequest(text=SELECTED_TEXT, resume={"summary": "整份简历"})
    # 首尾空白被 strip，正文本身不受影响。
    assert PolishSelectionRequest(text=f"  {SELECTED_TEXT}  ").text == SELECTED_TEXT


def test_selection_polish_endpoint_returns_result(client, monkeypatch):
    provider = SelectionProvider({"result": "负责后端接口开发，可用性提升到 99.9%"})
    _use_provider(monkeypatch, provider)

    response = client.post(POLISH_PATH, json={"text": SELECTED_TEXT, "instruction": "更简洁"})

    assert response.status_code == 200
    assert response.json() == {"result": "负责后端接口开发，可用性提升到 99.9%"}


def test_selection_polish_prompt_carries_the_no_new_facts_constraint(client, monkeypatch):
    """提示词里必须有「不得新增事实」这条硬约束，且注入了选中文字与用户要求。"""
    provider = SelectionProvider({"result": "改写结果"})
    _use_provider(monkeypatch, provider)

    client.post(POLISH_PATH, json={"text": SELECTED_TEXT, "instruction": INSTRUCTION})

    prompt = provider.messages[0][1]["content"]
    assert "不得新增事实" in prompt
    assert SELECTED_TEXT in prompt
    assert INSTRUCTION in prompt
    # 反例守卫：提示词里不许出现"编造""可以补充未提供的信息"这类放水措辞。
    assert "编造" not in prompt
    assert "可以补充" not in prompt


async def test_selection_polish_injects_a_placeholder_for_a_blank_instruction():
    """用户没写要求时不能把空的 ``{{ instruction }}`` 直接留给模型。"""
    provider = SelectionProvider({"result": "改写结果"})
    await polish_selection(provider, SELECTED_TEXT, "   ")

    prompt = provider.messages[0][1]["content"]
    assert "{{ instruction }}" not in prompt
    assert "{{ text }}" not in prompt
    assert "按简历规范做通用润色" in prompt


async def test_selection_polish_service_rejects_an_empty_result():
    provider = SelectionProvider({"result": "   "})
    with pytest.raises(LLMError):
        await polish_selection(provider, SELECTED_TEXT, "")


def test_selection_polish_empty_result_is_a_502(client, monkeypatch):
    provider = SelectionProvider({"result": ""})
    _use_provider(monkeypatch, provider)

    response = client.post(POLISH_PATH, json={"text": SELECTED_TEXT})

    assert response.status_code == 502
    assert "润色失败" in response.json()["detail"]

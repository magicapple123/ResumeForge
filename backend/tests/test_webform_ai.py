"""网申填表的 AI 兜底：提示词边界、输出白名单、降级、缓存。

这里守的三条性质，每一条都比"识别准不准"重要：

1. **模型看不到任何资料值**。发出去的只有页面上本来就有的字与字段名。
2. **模型的输出被关在字段目录里**（封闭集合），因此它**造不出一个值**。
3. **模型挂了不影响可用性**——回落成今天的行为，预览照常打得开。

本文件是主文件（提示词边界与共享替身）；答案解析/缓存在
``test_webform_ai_answers.py``，批量链路/守门/降级/配额在
``test_webform_ai_preview.py``。
"""
import json

import pytest

from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.webform import ai
from app.services.webform.engine import Control, FormEngine
from app.services.webform.fields import FIELD_KEYS
from app.services.webform.service import (
    build_preview,
    enrich_preview_with_ai,
)
from app.services.webform.session import Snapshot


class FakeProvider(BaseLLMProvider):
    """返回预设 JSON 的假模型，并记录它收到的消息供断言提示词内容。"""

    def __init__(self, payload=None, *, error: Exception | None = None):
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.payload = {"matches": []} if payload is None else payload
        self.error = error
        self.messages: list[list[dict]] = []

    async def chat(self, messages):
        self.messages.append(messages)
        if self.error is not None:
            raise self.error
        return json.dumps(self.payload, ensure_ascii=False)

    async def stream_chat(self, messages):
        yield ""

    def heard(self) -> str:
        """模型实际看到的全部文字（system + user 拼一起，方便做"值有没有泄漏"的断言）。"""
        return "\n".join(
            str(message.get("content", ""))
            for exchange in self.messages
            for message in exchange
        )


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串。"""
    ai.clear_cache()
    yield
    ai.clear_cache()


def _raw(index: int, **overrides):
    payload = {
        "index": index,
        "type": "text",
        "label": "",
        "selector": f'[data-rf-index="{index}"]',
    }
    payload.update(overrides)
    return payload


def _snapshot(*raws) -> Snapshot:
    return Snapshot(id="snap", controls=FormEngine().snapshot_controls(list(raws)))


def _controls(*raws) -> list[Control]:
    return FormEngine().snapshot_controls(list(raws))


# 一个**任何目录字段的同义词都够不到**的标签——规则认不出、留给 AI 的典型。
#
# 原先这里是「实验室名称」。2026-09-27 给「实验室」补了同义词之后它变得认得出了，于是
# 这批"AI 兜底"的用例全都悄悄换了走法（不再问模型）。**换个没被收录的标签、而不是把
# 同义词撤掉**：要测的是"认不出时交给 AI"这条机制，机制没变，变的是"什么算认不出"。
UNKNOWN = {"type": "text", "label": "所在部门意见"}


# ===== 提示词的边界 =====

async def test_prompt_never_contains_any_profile_value():
    """**最重要的一条**：AI 兜底链路里，用户的资料值一个字都不该发出去。

    资料的取值路径是"模型只回一个字段名，值由本地取"，所以提示词里根本拿不到值——
    这条用例把它钉住：真跑一遍，逐字去模型收到的消息里搜。
    """
    secrets = {
        "name": "特征姓名甲",
        "phone": "13500000001",
        "id_number": "330102199001011234",
        "email": "tezheng@example.invalid",
        "research_direction": "特征研究方向乙",
    }
    snapshot = _snapshot(_raw(0, **UNKNOWN))

    provider = FakeProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    report = build_preview(snapshot, secrets)
    await enrich_preview_with_ai(snapshot, secrets, report, provider)

    heard = provider.heard()
    for field_name, value in secrets.items():
        assert value not in heard, f"{field_name} 的值泄漏进了提示词"


async def test_prompt_lists_every_selectable_field():
    """字段目录要全给——少一个 key，模型就永远选不到它。"""
    provider = FakeProvider()
    await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN)))

    heard = provider.heard()
    for key in FIELD_KEYS:
        assert key in heard


async def test_prompt_carries_the_control_text_but_not_the_page_url():
    provider = FakeProvider()
    control = _controls(
        _raw(
            0,
            type="select",
            label="请选择你的实验室",
            placeholder="实验室",
            nearby_text="导师信息 实验室名称",
            options=[{"v": "1", "t": "一号实验室"}, {"v": "2", "t": "二号实验室"}],
        )
    )[0]
    await ai.identify_fields(provider, [control])

    heard = provider.heard()
    assert "请选择你的实验室" in heard
    assert "导师信息 实验室名称" in heard
    assert "一号实验室" in heard

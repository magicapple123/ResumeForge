"""「问历历」精简问答的纯逻辑单测（不涉轮询与注入，只钉护栏）。"""

import pytest

from app.services.webform.live_assistant import (
    ASK_MAX_CHARS,
    ASK_TOO_LONG_NOTE,
    HISTORY_TURNS,
    REPLY_MAX_CHARS,
    AssistantAskError,
    append_exchange,
    ask,
    build_ask_messages,
    new_history,
)


class FakeProvider:
    """记录调用次数与消息、按脚本回答的假模型。"""

    def __init__(self, reply: str = "好的", error: Exception | None = None):
        self.reply = reply
        self.error = error
        self.calls: list[list[dict[str, str]]] = []

    async def chat(self, messages):
        self.calls.append(messages)
        if self.error is not None:
            raise self.error
        return self.reply


def test_overlong_question_never_reaches_the_model():
    """问题超 2000 字直接回固定文案，**零模型调用**——护栏必须省钱。"""
    provider = FakeProvider()
    history = new_history()

    answer = ask(provider, history, "问" * (ASK_MAX_CHARS + 1))

    assert answer == ASK_TOO_LONG_NOTE
    assert provider.calls == []


def test_reply_is_trimmed_with_an_honest_note():
    """回答超 4000 字截断并如实注明，不静默吞掉后文。"""
    provider = FakeProvider(reply="答" * (REPLY_MAX_CHARS + 100))
    answer = ask(provider, new_history(), "你好")

    assert answer.startswith("答" * REPLY_MAX_CHARS)
    assert answer.endswith("（回答过长，已截断）")


def test_provider_failure_is_turned_into_readable_chinese():
    """模型/网络异常转成用户可读文案上抛，调用方拿到就能直接写回页面。"""
    provider = FakeProvider(error=RuntimeError("boom"))

    with pytest.raises(AssistantAskError) as exc_info:
        ask(provider, new_history(), "这个岗位匹配吗")

    assert "历历没能回答" in str(exc_info.value)
    assert "boom" in str(exc_info.value)


def test_history_keeps_only_the_recent_five_turns():
    """历史超过 5 轮只保留最近 5 轮（deque 限长 + build 再切一刀双保险）。"""
    provider = FakeProvider(reply="收到")
    history = new_history()

    for round_index in range(HISTORY_TURNS + 3):
        question = f"问题{round_index}"
        answer = ask(provider, history, question)
        append_exchange(history, question, answer)

    messages = build_ask_messages(history, "最新一问")
    user_messages = [item for item in messages if item["role"] == "user"]
    # system 1 条 + 最近 HISTORY_TURNS 轮（2 条/轮）+ 本轮 1 条。
    assert len(messages) == 1 + HISTORY_TURNS * 2 + 1
    assert user_messages[-1]["content"] == "最新一问"
    # 最早的三轮（问题0~2）已被挤出窗口。
    assert all("问题2" not in item["content"] for item in messages)
    assert any("问题3" in item["content"] for item in messages)


def test_failed_round_is_not_appended_into_history():
    """失败的那一轮不能进历史：留着只会污染下一轮的上下文。"""
    history = new_history()
    append_exchange(history, "问1", "答1")

    before = list(history)
    with pytest.raises(AssistantAskError):
        ask(FakeProvider(error=RuntimeError("x")), history, "问2")

    assert list(history) == before


def test_system_prompt_carries_the_product_boundaries():
    """系统提示词必须带不可信输入护栏与「禁止百分比」的产品边界。"""
    provider = FakeProvider()
    ask(provider, new_history(), "匹配度多少")

    system = provider.calls[0][0]
    assert system["role"] == "system"
    assert "不可信数据" in system["content"]
    assert "禁止输出任何百分比或分数" in system["content"]


def test_unconfigured_provider_reports_config_hint():
    """provider 为 None（没配模型）时如实提示，而不是一句含糊的"失败了"。"""
    with pytest.raises(AssistantAskError) as exc_info:
        ask(None, new_history(), "你好")
    assert "未配置模型服务" in str(exc_info.value)

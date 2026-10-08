"""实时链路的 AI 兜底 × 自定义字段（CUSTOM_*）。

2026-10 修复：用户把「项目链接」记在「网申资料·自定义」里，AI 建议卡片却永远说
"你的资料里还没填这一项"——因为 AI 的候选是封闭的目录集合，模型根本无法返回
``CUSTOM_*``；``_ai_dead_end`` 又只按目录 key 取值。本文件钉住四条：

1. **有值的自定义字段会进提示词**（只发字段名不发值，与目录字段同一条隐私边界）；
2. **模型的答案落回 ``CUSTOM_*`` 时能一路走通到面板建议**；
3. **死胡同文案不再冤枉人**——目录字段没值但同名自定义字段有值时，给出建议；
4. **封闭集合不放宽**：没给出去过的 ``CUSTOM_*`` key 照样被拒（批量链路行为不变）。

FakeLiveClient/raw_control 在 test_webform_live.py；ScriptedProvider/UNKNOWN_LABEL 在
test_webform_live_ai.py（"记住这条"与 AI 兜底共用"认不出"这一前提）。
"""
import asyncio
import json

import pytest
from app.services.webform import ai as ai_module
from app.services.webform.live import LiveSession
from test_webform_live import FakeLiveClient, raw_control
from test_webform_live_ai import UNKNOWN_LABEL, ScriptedProvider

CUSTOM_CATALOG = [{"group": "自定义", "key": "CUSTOM_项目链接", "label": "项目链接"}]
CUSTOM_DATA = {"CUSTOM_项目链接": "123456"}


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串（与 test_webform_live_ai.py 同款）。"""
    ai_module.clear_cache()
    yield
    ai_module.clear_cache()


class RecordingProvider:
    """按脚本回答的假模型，并记录收到的消息供断言提示词内容。"""

    def __init__(self, reply=None):
        self.reply = {"matches": []} if reply is None else reply
        self.messages: list[list[dict]] = []
        self.calls = 0

    async def chat(self, messages):
        self.calls += 1
        self.messages.append(messages)
        return json.dumps(self.reply, ensure_ascii=False)

    def heard(self) -> str:
        """模型实际看到的全部文字（system + user 拼一起）。"""
        return "\n".join(
            str(message.get("content", ""))
            for exchange in self.messages
            for message in exchange
        )


def _unknown_control():
    control = LiveSession._build_control(raw_control(label=UNKNOWN_LABEL))
    assert control is not None
    return control


def _custom_session(client, provider, data=None, catalog=None) -> LiveSession:
    return LiveSession(
        client,
        data if data is not None else dict(CUSTOM_DATA),
        catalog=catalog if catalog is not None else list(CUSTOM_CATALOG),
        provider=provider,
        ai_enabled=True,
    )


# ===== 提示词与候选集 =====


def test_prompt_offers_valued_custom_fields_by_name_only():
    """有值的自定义字段进字段表——**只发名字**，值一个字都不能出现。"""
    provider = RecordingProvider()
    session = _custom_session(FakeLiveClient(), provider)

    extra = session._ai_custom_candidates(ai_module.MAX_CUSTOM_FIELDS)
    assert extra == [("CUSTOM_项目链接", "项目链接")]

    prompt = ai_module.build_prompt([_unknown_control()], extra)
    assert "CUSTOM_项目链接：项目链接" in prompt
    assert "123456" not in prompt, "自定义字段的值泄漏进了提示词"


def test_empty_custom_fields_are_not_offered():
    """没填的自定义字段列进候选只会逼模型硬猜——不列。"""
    provider = RecordingProvider()
    session = _custom_session(
        FakeLiveClient(),
        provider,
        data={"CUSTOM_空字段": ""},
        catalog=[{"group": "自定义", "key": "CUSTOM_空字段", "label": "空字段"}],
    )

    assert session._ai_custom_candidates() == []


def test_custom_candidates_are_capped():
    """量多时限流——目录字段永远全量在前，自定义只补这么多。"""
    catalog = [
        {"group": "自定义", "key": f"CUSTOM_字段{i}", "label": f"字段{i}"} for i in range(20)
    ]
    data = {f"CUSTOM_字段{i}": f"值{i}" for i in range(20)}
    provider = RecordingProvider()
    session = _custom_session(FakeLiveClient(), provider, data=data, catalog=catalog)

    extra = session._ai_custom_candidates(ai_module.MAX_CUSTOM_FIELDS)
    assert len(extra) == ai_module.MAX_CUSTOM_FIELDS
    assert all(key.startswith("CUSTOM_字段") for key, _label in extra)


def test_parse_matches_accepts_only_offered_custom_keys():
    """封闭集合**连自定义候选一起封**：给出去过的 key 才算数。"""
    raw = [{"index": 0, "field": "CUSTOM_项目链接"}, {"index": 0, "field": "CUSTOM_没给过的"}]
    offered = frozenset(ai_module.FIELD_LABELS) | {"CUSTOM_项目链接"}

    parsed = ai_module._parse_matches(raw, {0}, offered)
    assert parsed == {0: ("CUSTOM_项目链接",)}, "没给过的 key 不能被采纳"

    # 不给自定义候选时（批量链路），CUSTOM_* 一律拒绝——旧封闭集合原样。
    assert ai_module._parse_matches(raw, {0}) == {}


def test_cache_does_not_leak_answers_across_custom_candidate_sets():
    """同一控件在不同候选集下的答案可能不同——缓存键必须把候选集盖上。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "CUSTOM_项目链接"}]})
    session = _custom_session(FakeLiveClient(), provider)
    session.start()
    try:
        control = _unknown_control()
        offered = [("CUSTOM_项目链接", "项目链接")]

        asyncio.run(ai_module.identify_fields(provider, [control], extra_fields=offered))
        # 同一批候选：命中缓存，不再花钱。
        asyncio.run(ai_module.identify_fields(provider, [control], extra_fields=offered))
        assert provider.calls == 1
        # 换一批候选：不能复用旧答案。
        asyncio.run(
            ai_module.identify_fields(
                provider, [control], extra_fields=[("CUSTOM_研究方向", "研究方向")]
            )
        )
        assert provider.calls == 2, "候选集变了还命中旧缓存"
    finally:
        session.stop()


# ===== 实时链路端到端 =====


def test_ai_suggestion_hits_a_valued_custom_field():
    """模型认出 ``CUSTOM_项目链接`` → 面板给出建议，值来自那份自定义字段。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "CUSTOM_项目链接"}]})
    client = FakeLiveClient()
    session = _custom_session(client, provider)
    session.start()
    try:
        control = _unknown_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["source"] == "ai"
        assert panel["field_label"] == "项目链接", "自定义字段要显示保存时的名字，不带前缀"
        assert panel["value"] == "123456"
    finally:
        session.stop()


def test_a_dead_end_is_avoided_when_a_same_named_custom_field_has_the_value():
    """模型认成目录字段、值却存在同名自定义字段里——给出建议，不再说"还没填"。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    client = FakeLiveClient()
    session = _custom_session(
        client,
        provider,
        data={"CUSTOM_研究方向": "分布式系统的实践"},
        catalog=[{"group": "自定义", "key": "CUSTOM_研究方向", "label": "研究方向"}],
    )
    session.start()
    try:
        control = _unknown_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["field_label"] == "研究方向"
        assert panel["value"] == "分布式系统的实践"
        assert "还没填" not in panel["note"]
    finally:
        session.stop()


def test_the_dead_end_for_a_recognized_field_with_no_data_still_says_so():
    """目录与自定义里都真没值时，死胡同文案**原样保留**——不许因为这次修复变哑。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "advisor"}]})
    client = FakeLiveClient()
    session = _custom_session(client, provider, data={}, catalog=list(CUSTOM_CATALOG))
    session.start()
    try:
        control = _unknown_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert "资料里还没填" in panel["note"]
        assert panel["field_label"] == "导师"
    finally:
        session.stop()

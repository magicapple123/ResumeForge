"""「放宽模式第二轮定向放宽」守卫测试（2026-10-06 字节校招页真机侦察后）。

四项放宽，每项一条准确率红线不许破：

1. 「没有实习经历」这类「没有…」前缀声明勾选纳入确认制（needs_confirm 默认不勾、
   实时「帮我勾选」）；
2. 放宽模式下点选类控件（规则没认出字段）接入 AI 兜底识别——批量与实时两条链路：
   命中且有值 → relaxed 代选；命中无值 → missing_data；不识别/挂掉/额度用完 → 保持
   blocked 文案；
3. 目录同义词补齐：语言弹层控件的自述「语言」「精通程度」；
4. 弹层多值代选（意向城市最多 3 个）：逐个严格解析、**全部命中才动手**、回读验证。
"""
import json

import pytest
from app.services.llm.base import LLMError
from app.services.webform import FormEngine, ai
from app.services.webform.custom_select import (
    select_combobox_options,
    split_multi_values,
)
from app.services.webform.engine import relaxed_kind
from app.services.webform.live import MAX_AI_CALLS, LiveSession
from app.services.webform.service import (
    SOURCE_AI,
    STATUS_NEEDS_CONFIRM,
    STATUS_RELAXED_READY,
    FillSelection,
    apply_fill,
    build_preview,
    default_selections,
    enrich_preview_with_ai,
)
from app.services.webform.session import Snapshot
from test_webform_ai import FakeProvider
from test_webform_live import FakeLiveClient, raw_control
from test_webform_live_ai import ScriptedProvider

__all__ = ["FakeProvider"]


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串（import 不传播 autouse 语义）。"""
    ai.clear_cache()
    yield
    ai.clear_cache()


def _snapshot(raw: list[dict]) -> Snapshot:
    return Snapshot(id="snap", controls=FormEngine().snapshot_controls(raw))


def _popup(index: int = 0, label: str = "意向城市", nearby_text: str = "意向城市*", **overrides) -> dict:
    base = {
        "index": index,
        "type": "text",
        "label": label,
        "nearby_text": nearby_text,
        "readonly": True,
        "has_popup": True,
        "selector": f'[data-rf-index="{index}"]',
        "options": [],
        "value": "",
        "display": "",
        "checked": False,
    }
    base.update(overrides)
    return base


def _unknown_popup(index: int = 0) -> dict:
    """规则认不出字段的弹层控件（AI 兜底候选的典型）。"""
    return _popup(index, label="神秘代号", nearby_text="神秘代号*")


# ===== 目标 1：「没有…」前缀声明勾选纳入确认制 =====


def _declaration_raw(index: int = 0) -> dict:
    return {
        "index": index,
        "type": "checkbox",
        "label": "没有实习经历",
        "nearby_text": "没有实习经历",
        "selector": f'[data-rf-index="{index}"]',
    }


def test_meiyou_prefix_declaration_is_confirm_not_choice():
    """「没有实习经历」与「无实习经历」同一类声明：确认制，不是事实类代点。"""
    control = FormEngine().snapshot_controls([_declaration_raw()])[0]
    assert FormEngine.skip_reason(control) is not None
    assert relaxed_kind(control) == "confirm"

    report = build_preview(_snapshot([_declaration_raw()]), {}, relaxed=True)

    assert report.blocked == []
    assert [item.status for item in report.items] == [STATUS_NEEDS_CONFIRM]
    assert default_selections(report) == [], "声明类默认不勾"


def test_meiyou_prefix_declaration_stays_blocked_when_mode_off():
    """开关关闭：仍不代填（措辞与「无实习经历」同款声明文案，比泛化的"点选"更准）。"""
    report = build_preview(_snapshot([_declaration_raw()]), {})

    assert report.items == []
    assert len(report.blocked) == 1
    assert "声明类勾选" in report.blocked[0].field_label


def test_live_panel_offers_click_for_meiyou_declaration_when_relaxed():
    client = FakeLiveClient()
    session = LiveSession(client, {}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(
            raw_control(type="checkbox", label="没有实习经历", nearby_text="没有实习经历")
        )
        session._tick()

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["accept_label"] == "帮我勾选：没有实习经历"
        assert "本人确认" in panel["note"]
    finally:
        session.stop()


# ===== 目标 2（批量）：放宽候选的 AI 兜底 =====


def test_a_popup_with_a_field_but_no_value_lands_in_missing_data():
    """放宽三路分流之一：认得出字段但资料没值 → missing_data（如实引导去补哪一项）。"""
    snapshot = _snapshot([_popup()])
    report = build_preview(snapshot, {}, relaxed=True)

    assert report.items == [] and report.blocked == []
    (missing,) = report.missing_data
    assert missing.field == "target_city"
    assert missing.field_label == "期望工作地点"
    assert report.relaxed_ai_candidates == []


async def test_relaxed_popup_ai_hit_becomes_a_relaxed_row():
    """AI 命中且有资料值 → relaxed 代选行；来源标 AI，两层交代都在备注里。"""
    snapshot = _snapshot([_unknown_popup()])
    data = {"language_name": "英语"}
    report = build_preview(snapshot, data, relaxed=True)
    assert report.relaxed_ai_candidates == [0]

    provider = FakeProvider({"matches": [{"index": 0, "field": "language_name"}]})
    asked = await enrich_preview_with_ai(snapshot, data, report, provider, relaxed=True)

    assert asked == 1
    assert report.blocked == []
    (item,) = report.items
    assert item.status == STATUS_RELAXED_READY
    assert item.field == "language_name"
    assert item.value == "英语"
    assert item.source == SOURCE_AI
    assert "放宽" in item.note and "核对" in item.note
    assert default_selections(report) == [], "AI 建议默认不勾"


async def test_relaxed_popup_ai_without_value_lands_in_missing_data():
    snapshot = _snapshot([_unknown_popup()])
    report = build_preview(snapshot, {}, relaxed=True)

    provider = FakeProvider({"matches": [{"index": 0, "field": "advisor"}]})
    await enrich_preview_with_ai(snapshot, {}, report, provider, relaxed=True)

    assert report.items == []
    assert report.blocked == []
    (pending,) = report.missing_data
    assert pending.field == "advisor"
    assert pending.field_label == "导师"


async def test_relaxed_popup_ai_none_answer_stays_blocked():
    """AI 不识别 → 保持 blocked 原文案，不进别的桶。"""
    snapshot = _snapshot([_unknown_popup()])
    report = build_preview(snapshot, {}, relaxed=True)
    blocked_label = report.blocked[0].field_label

    provider = FakeProvider({"matches": [{"index": 0, "field": ai.NONE_FIELD}]})
    asked = await enrich_preview_with_ai(snapshot, {}, report, provider, relaxed=True)

    assert asked == 1
    assert report.items == [] and report.missing_data == []
    assert [item.field_label for item in report.blocked] == [blocked_label]


async def test_relaxed_popup_model_failure_keeps_blocked():
    snapshot = _snapshot([_unknown_popup()])
    report = build_preview(snapshot, {}, relaxed=True)

    provider = FakeProvider(error=LLMError("模型响应超时，请稍后重试"))
    assert await enrich_preview_with_ai(snapshot, {}, report, provider, relaxed=True) == 0

    assert report.items == [] and report.missing_data == []
    assert len(report.blocked) == 1


async def test_relaxed_candidates_are_not_asked_when_mode_off():
    """开关关闭：blocked 仍是 AI 终局——一次调用都不发生。"""
    snapshot = _snapshot([_unknown_popup()])
    report = build_preview(snapshot, {"language_name": "英语"})

    assert report.relaxed_ai_candidates == []
    provider = FakeProvider({"matches": [{"index": 0, "field": "language_name"}]})
    asked = await enrich_preview_with_ai(snapshot, {"language_name": "英语"}, report, provider)

    assert asked == 0
    assert provider.messages == []
    assert len(report.blocked) == 1


# ===== 目标 2（实时）：放宽候选的 AI 兜底 =====


def _relaxed_ai_session(client, provider, data=None) -> LiveSession:
    return LiveSession(
        client,
        data or {"language_name": "英语"},
        provider=provider,
        ai_enabled=True,
        relaxed_mode_loader=lambda: True,
    )


def test_live_relaxed_popup_ai_hit_offers_the_value():
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "language_name"}]})
    client = FakeLiveClient()
    session = _relaxed_ai_session(client, provider)
    session.start()
    try:
        control = LiveSession._build_control(
            raw_control(label="神秘代号", readonly=True, has_popup=True)
        )
        client.focus_on(raw_control(label="神秘代号", readonly=True, has_popup=True))
        session._tick()
        assert client.panels[-1]["status"] == "ai_thinking"

        session._run_ai(session._seq, control, relaxed=True)

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["source"] == "ai"
        assert panel["field_label"] == "语言类型" or panel["field_label"] == "语种" or "语言" in panel["field_label"]
        assert panel["value"] == "英语"
        assert "放宽" in panel["note"]
    finally:
        session.stop()


def test_live_relaxed_popup_ai_no_match_keeps_blocked_wording():
    """AI 不识别 → 面板回到 blocked 原文案，而不是"没认出来"。"""
    provider = ScriptedProvider({"matches": []})
    client = FakeLiveClient()
    session = _relaxed_ai_session(client, provider)
    session.start()
    try:
        control = LiveSession._build_control(
            raw_control(label="神秘代号", readonly=True, has_popup=True)
        )
        client.focus_on(raw_control(label="神秘代号", readonly=True, has_popup=True))
        session._tick()
        session._run_ai(session._seq, control, relaxed=True)

        panel = client.panels[-1]
        assert panel["status"] == "blocked"
        assert "点开弹层" in panel["note"]
    finally:
        session.stop()


def test_live_relaxed_popup_ai_without_value_says_what_to_fill():
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "advisor"}]})
    client = FakeLiveClient()
    session = _relaxed_ai_session(client, provider, data={})
    session.start()
    try:
        control = LiveSession._build_control(
            raw_control(label="神秘代号", readonly=True, has_popup=True)
        )
        client.focus_on(raw_control(label="神秘代号", readonly=True, has_popup=True))
        session._tick()
        session._run_ai(session._seq, control, relaxed=True)

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert panel["field_label"] == "导师"
        assert "资料里还没填" in panel["note"]
    finally:
        session.stop()


def test_live_relaxed_popup_quota_exhausted_keeps_blocked_wording():
    """额度用完 → 文案不变（blocked），一次调用都不发生。"""
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _relaxed_ai_session(client, provider)
    session._ai_calls = MAX_AI_CALLS
    session.start()
    try:
        client.focus_on(raw_control(label="神秘代号", readonly=True, has_popup=True))
        session._tick()

        panel = client.panels[-1]
        assert panel["status"] == "blocked"
        assert provider.calls == 0
    finally:
        session.stop()


def test_live_relaxed_popup_without_ai_keeps_blocked_wording():
    """没开 AI（没配模型）：文案不变，面板照常可用。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"language_name": "英语"}, relaxed_mode_loader=lambda: True)
    session.start()
    try:
        client.focus_on(raw_control(label="神秘代号", readonly=True, has_popup=True))
        session._tick()

        assert client.panels[-1]["status"] == "blocked"
    finally:
        session.stop()


# ===== 目标 3：目录同义词补齐（语言弹层的页面措辞） =====


def test_language_popups_match_their_catalog_fields():
    """字节页语言弹层的自述是「语言*」「精通程度*」——扩词后两个弹层各归各的字段。"""
    snapshot = _snapshot(
        [
            _popup(0, label="语言", nearby_text="语言* 语言*精通程度*"),
            _popup(1, label="精通程度", nearby_text="精通程度* 语言*精通程度*"),
        ]
    )
    data = {"language_name": "英语", "language_level": "精通"}

    report = build_preview(snapshot, data, relaxed=True)

    assert report.blocked == []
    rows = {item.field: item for item in report.items}
    assert set(rows) == {"language_name", "language_level"}
    assert rows["language_name"].value == "英语"
    assert rows["language_level"].value == "精通"


def test_competition_and_social_popups_match_existing_catalog_fields():
    """竞赛名称 → award_competition、社交平台 → social_platform：目录已有，开放宽即代选。"""
    snapshot = _snapshot(
        [
            _popup(0, label="竞赛名称", nearby_text="竞赛名称* 竞赛名称*描述"),
            _popup(1, label="社交平台", nearby_text="社交平台* 社交平台*URL / ID*"),
        ]
    )
    data = {"award_competition": "挑战杯", "social_platform": "GitHub"}

    report = build_preview(snapshot, data, relaxed=True)

    assert report.blocked == []
    rows = {item.field: item for item in report.items}
    assert set(rows) == {"award_competition", "social_platform"}


# ===== 目标 4：弹层多值代选 =====


def test_split_multi_values():
    assert split_multi_values("上海、北京") == ["上海", "北京"]
    assert split_multi_values("上海，北京；广州") == ["上海", "北京", "广州"]
    assert split_multi_values("上海") == ["上海"]
    assert split_multi_values("") == []
    # "/" 不拆：URL 与"和/或"类值拆错了比不拆更糟。
    assert split_multi_values("https://example.com/a") == ["https://example.com/a"]


class FakeMultiPopupClient:
    """多值弹层替身：记录点击、回答选项清单与回读值。"""

    def __init__(self, options, *, display: str = ""):
        self.options = options
        self.display = display
        self.clicked_selectors: list[str] = []

    def evaluate(self, expression, *, timeout=None):
        if "rf:click-rect" in expression:
            self.clicked_selectors.append(expression)
            return json.dumps({"ok": True, "x": 10, "y": 10})
        if "rf:combobox-options" in expression:
            return json.dumps({"ok": True, "options": self.options})
        if "rf:combobox-confirm" in expression:
            return "1"
        if "rf:combobox-cleanup" in expression:
            return "1"
        if "rf:read-back" in expression:
            return json.dumps({"ok": True, "value": self.display})
        return None

    def send(self, method, params=None, *, timeout=None):
        return {}

    def option_tokens(self) -> list[str]:
        """点击过的选项 token（不含开弹层那一下）。"""
        return [
            token
            for expression in self.clicked_selectors
            for token in ["a-0" if "a-0" in expression else "a-1" if "a-1" in expression else "a-2" if "a-2" in expression else ""]
            if token
        ]


_CITY_OPTIONS = [
    {"value": "sh", "text": "上海", "selector": '[data-rf-option-token="a-0"]'},
    {"value": "bj", "text": "北京", "selector": '[data-rf-option-token="a-1"]'},
    {"value": "gz", "text": "广州", "selector": '[data-rf-option-token="a-2"]'},
]


def test_multi_value_popup_clicks_every_matched_option():
    client = FakeMultiPopupClient(_CITY_OPTIONS, display="上海、北京")

    result = select_combobox_options(client, "#city", ["上海", "北京"])

    assert result.status == "matched"
    assert result.option is not None and result.option.text == "上海、北京"
    assert client.option_tokens() == ["a-0", "a-1"], "两个城市都要点到"


def test_multi_value_popup_aborts_when_any_value_is_missing():
    """缺项如实报缺哪一个。首读全可见时本应全或无；首读不齐走慢路径（虚拟列表）
    后已点上的值保留、缺的那项如实报——半选状态由回读验证如实上报。"""
    client = FakeMultiPopupClient(_CITY_OPTIONS)

    result = select_combobox_options(client, "#city", ["上海", "深圳"])

    assert result.status == "no_option"
    assert "深圳" in result.reason
    # 慢路径：上海先被点上（选中态持久），深圳找不到才放弃。
    assert client.option_tokens() == ["a-0"]


def test_engine_fills_a_multi_value_popup_and_verifies_by_readback():
    """engine 写入路径：多值走代选，回读一致才算 filled；回读缺城市要如实报未验证。"""
    snapshot = _snapshot([_popup()])

    ok = FakeMultiPopupClient(_CITY_OPTIONS, display="上海、北京")
    (outcome,) = apply_fill(
        ok,
        snapshot,
        [FillSelection(index=0, field="target_city", value="上海、北京")],
    )
    assert outcome.status == "filled"

    partial = FakeMultiPopupClient(_CITY_OPTIONS, display="上海")
    (outcome,) = apply_fill(
        partial,
        snapshot,
        [FillSelection(index=0, field="target_city", value="上海、北京")],
    )
    assert outcome.status == "unverified", "回读少了北京，不能当填上了"

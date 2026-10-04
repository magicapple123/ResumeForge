"""网申填表 AI 兜底 · 批量链路、守门、降级与配额。

AI 命中接进预览的完整链路（来源标记、默认不勾选、冲突规则），"只动该动的那一桶"的
守门，模型挂掉时的降级，以及一次调用的控件数上限。共享替身见 ``test_webform_ai.py``。

⚠️ 本文件的 autouse ``_clear_ai_cache`` **必须在文件内重新声明**——import 而来的
autouse fixture 不会生效（autouse 只来自 conftest / 本模块 / 插件）。
"""
import pytest

from app.services.llm.base import LLMError
from app.services.webform import ai
from app.services.webform.service import (
    SOURCE_AI,
    SOURCE_RULE,
    build_preview,
    default_selections,
    enrich_preview_with_ai,
)

from test_webform_ai import FakeProvider, UNKNOWN, _controls, _raw, _snapshot


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串。（与主文件同款，import 不传播 autouse。）"""
    ai.clear_cache()
    yield
    ai.clear_cache()


# ===== 批量链路：接进预览 =====

async def test_ai_match_becomes_a_normal_preview_row():
    """命中的控件从「没认出来」移进「将填入」，并标成 AI 来源。"""
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    data = {"research_direction": "分布式系统"}
    report = build_preview(snapshot, data)
    assert [item.label for item in report.unrecognized] == [UNKNOWN["label"]]

    provider = FakeProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    asked = await enrich_preview_with_ai(snapshot, data, report, provider)

    assert asked == 1
    assert report.unrecognized == []
    (item,) = report.items
    assert item.field == "research_direction"
    assert item.value == "分布式系统"
    assert item.source == SOURCE_AI
    assert "核对" in item.note


async def test_ai_rows_are_not_selected_by_default():
    """**AI 建议默认不勾选**——默认不勾的代价是"我忘了勾"，默认勾的代价是"悄悄写了个错值"。"""
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    data = {"research_direction": "分布式系统"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    assert report.items[0].source == SOURCE_AI
    assert default_selections(report) == []


async def test_rule_rows_are_still_selected_by_default():
    """对照组：规则命中的行不受影响。"""
    snapshot = _snapshot(
        _raw(0, label="姓名"), _raw(1, **UNKNOWN)
    )
    data = {"name": "张三", "research_direction": "分布式系统"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 1, "field": "research_direction"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    sources = {item.index: item.source for item in report.items}
    assert sources == {0: SOURCE_RULE, 1: SOURCE_AI}
    assert [item.index for item in default_selections(report)] == [0]


async def test_recognized_but_empty_lands_in_missing_data():
    """AI 认出来了、但资料里没这一项 → 进「资料里还没有」，措辞与规则命中完全一致。"""
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    report = build_preview(snapshot, {})
    provider = FakeProvider({"matches": [{"index": 0, "field": "advisor"}]})
    await enrich_preview_with_ai(snapshot, {}, report, provider)

    assert report.items == []
    assert report.unrecognized == []
    (pending,) = report.missing_data
    assert pending.field == "advisor"
    assert pending.field_label == "导师"


async def test_match_that_cannot_be_applied_says_why():
    """认出来了、资料里也有，但页面上没有对应选项 → 留在「没认出来」并写明原因。

    不写原因的话，用户看到"没认出来"会以为是模型没帮上忙，其实它答对了。
    """
    snapshot = _snapshot(
        _raw(
            0,
            type="select",
            label=UNKNOWN["label"],
            options=[{"v": "1", "t": "一号实验室"}, {"v": "2", "t": "二号实验室"}],
        )
    )
    data = {"degree": "本科"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 0, "field": "degree"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    assert report.items == []
    (pending,) = report.unrecognized
    assert "学历" in pending.field_label
    assert "选项" in pending.field_label


async def test_ai_rows_obey_the_conflict_rule():
    """页面上已经有别的值时不覆盖——AI 命中与规则命中一视同仁。"""
    snapshot = _snapshot(_raw(0, value="现有实验室", **UNKNOWN))
    data = {"research_direction": "分布式系统"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    (item,) = report.items
    assert item.status == "conflict"
    assert "现有实验室" in item.note
    assert default_selections(report) == []


# ===== 只动该动的那一桶 =====

async def test_blocked_controls_are_never_asked():
    """密码与验证码是**终局判定**——模型没有投票权，一次都不该问。"""
    snapshot = _snapshot(
        _raw(0, type="text", label="短信验证码", autocomplete="one-time-code"),
        _raw(1, type="text", label="实验室名称"),
    )
    report = build_preview(snapshot, {})
    assert [item.index for item in report.blocked] == [0]

    provider = FakeProvider({"matches": []})
    await enrich_preview_with_ai(snapshot, {}, report, provider)

    heard = provider.heard()
    assert "验证码" not in heard and "one-time-code" not in heard
    assert [item.index for item in report.blocked] == [0], "blocked 这一桶不该被动"


async def test_ai_fills_a_factual_radio_and_never_sees_a_consent_checkbox():
    """「只挡表态类」在这条链路上是两半，**缺一不可**。

    只测"能填"会漏掉更重要的那一半：**同意项根本不该出现在模型眼前**。所以这条两边都钉：
    事实类的单选认出来就正常进「将填入」；表态类的连 `unrecognized` 都进不去——`skip_reason`
    在匹配之前就把它拦下了，模型从头到尾看不到它。
    """
    from app.services.webform.service import PreviewReport, _adopt_ai_match

    # 事实类：AI 认出来 → 正常进「将填入」。
    control = _controls(
        _raw(0, type="radio", name="g", value="女", label="女", nearby_text="性别* 男 女")
    )[0]
    report = PreviewReport()

    _adopt_ai_match(report, control, "gender", {"gender": "女"})

    assert [(item.index, item.field) for item in report.items] == [(0, "gender")]
    assert report.blocked == []

    # 表态类：进不了 `unrecognized`（= 不会进提示词），只在 `blocked` 里如实说明。
    consent = _snapshot(_raw(0, type="checkbox", label="我已阅读并同意隐私政策"))
    consent_report = build_preview(consent, {})

    assert consent_report.unrecognized == []
    assert [item.index for item in consent_report.blocked] == [0]


async def test_relative_controls_are_never_asked():
    """问别人的栏目也不问模型——资料里全是本人信息，问了只会诱导它填错。"""
    snapshot = _snapshot(_raw(0, label="紧急联系人姓名"))
    report = build_preview(snapshot, {})
    assert [item.index for item in report.blocked] == [0]

    provider = FakeProvider({"matches": []})
    await enrich_preview_with_ai(snapshot, {}, report, provider)

    assert provider.messages == []


async def test_nothing_to_ask_means_no_call():
    """全是规则认得出的表单，一次调用都不该产生。"""
    snapshot = _snapshot(_raw(0, label="姓名"), _raw(1, label="手机号"))
    report = build_preview(snapshot, {"name": "张三"})

    provider = FakeProvider({"matches": []})
    assert await enrich_preview_with_ai(snapshot, {"name": "张三"}, report, provider) == 0
    assert provider.messages == []


async def test_only_unrecognized_controls_are_sent():
    snapshot = _snapshot(_raw(0, label="姓名"), _raw(1, **UNKNOWN))
    data = {"name": "张三"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 1, "field": "phone"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    # 只看控件清单那一段——提示词模板自己的 JSON 示例里也有 `"index": 0`。
    block = provider.heard().split("## 认不出来的控件", 1)[1].split("## 规则", 1)[0]
    assert UNKNOWN["label"] in block
    assert block.count('"index"') == 1, "规则已经认出的控件不该再问"


# ===== 降级 =====

async def test_model_failure_degrades_to_todays_behaviour():
    """AI 挂了不该让预览打不开：桶原样不动，不抛。"""
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    report = build_preview(snapshot, {})
    provider = FakeProvider(error=LLMError("模型响应超时，请稍后重试"))

    assert await enrich_preview_with_ai(snapshot, {}, report, provider) == 0
    assert [item.label for item in report.unrecognized] == [UNKNOWN["label"]]
    assert report.items == []


async def test_unexpected_error_also_degrades():
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    report = build_preview(snapshot, {})

    class Exploding(FakeProvider):
        async def chat(self, messages):
            raise RuntimeError("不该冒到用户面前")

    assert await enrich_preview_with_ai(snapshot, {}, report, Exploding()) == 0
    assert [item.label for item in report.unrecognized] == [UNKNOWN["label"]]


async def test_none_answer_leaves_the_bucket_alone():
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    report = build_preview(snapshot, {})
    provider = FakeProvider({"matches": [{"index": 0, "field": ai.NONE_FIELD}]})

    assert await enrich_preview_with_ai(snapshot, {}, report, provider) == 1
    assert [item.label for item in report.unrecognized] == [UNKNOWN["label"]]


# ===== 配额 =====

async def test_at_most_max_controls_are_sent_in_one_call():
    raws = [_raw(index, label=f"所在部门意见 {index}") for index in range(ai.MAX_AI_CONTROLS + 5)]
    snapshot = _snapshot(*raws)
    report = build_preview(snapshot, {})
    provider = FakeProvider({"matches": []})

    asked = await enrich_preview_with_ai(snapshot, {}, report, provider)

    assert asked == ai.MAX_AI_CONTROLS
    assert len(provider.messages) == 1, "批量链路必须是**一次**调用，不是每个控件一次"
    # 没问到的原样留在「没认出来」里，不静默丢弃。
    assert len(report.unrecognized) == ai.MAX_AI_CONTROLS + 5


# ===== provider 是否可用 =====

def test_build_provider_is_none_without_a_configured_model(db_session):
    """没配模型就返回 None——调用方据此完全不构造 provider，零调用。"""
    assert ai.build_provider(db_session) is None

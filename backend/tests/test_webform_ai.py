"""网申填表的 AI 兜底：提示词边界、输出白名单、降级、缓存。

这里守的三条性质，每一条都比"识别准不准"重要：

1. **模型看不到任何资料值**。发出去的只有页面上本来就有的字与字段名。
2. **模型的输出被关在字段目录里**（封闭集合），因此它**造不出一个值**。
3. **模型挂了不影响可用性**——回落成今天的行为，预览照常打得开。
"""
import json

import pytest

from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMError
from app.services.webform import ai
from app.services.webform.engine import Control, FormEngine
from app.services.webform.fields import FIELD_KEYS
from app.services.webform.service import (
    SOURCE_AI,
    SOURCE_RULE,
    build_preview,
    default_selections,
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


# ===== 输出的白名单 =====

async def test_field_outside_the_catalog_is_dropped():
    """模型编一个不存在的字段名出来时，**丢弃而不是照单全收**——封闭集合的落点。"""
    provider = FakeProvider({"matches": [{"index": 0, "field": "super_admin"}]})

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {}


async def test_none_field_means_not_recognized():
    provider = FakeProvider({"matches": [{"index": 0, "field": ai.NONE_FIELD}]})

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {}


async def test_index_we_never_asked_about_is_dropped():
    """模型偶尔会自己编号。不在这次清单里的 index 一律不要——它没法把答案塞给一个
    我们根本没给它看的控件。"""
    provider = FakeProvider(
        {"matches": [{"index": 99, "field": "name"}, {"index": 0, "field": "phone"}]}
    )

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {0: ("phone",)}


async def test_repeated_index_becomes_ranked_candidates():
    """同一个 index 给多条 = "拿不准，这几个都有可能"，顺序即把握大小。"""
    provider = FakeProvider(
        {
            "matches": [
                {"index": 0, "field": "phone"},
                {"index": 0, "field": "name"},
            ]
        }
    )

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {
        0: ("phone", "name")
    }


async def test_candidates_are_deduped_and_capped():
    provider = FakeProvider(
        {
            "matches": [
                {"index": 0, "field": "phone"},
                {"index": 0, "field": "phone"},
                *[{"index": 0, "field": key} for key in FIELD_KEYS],
            ]
        }
    )

    (candidates,) = (await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN)))).values()
    assert candidates[0] == "phone"
    assert len(candidates) == ai.MAX_CANDIDATES
    assert len(set(candidates)) == len(candidates)


async def test_a_contradictory_answer_converges_on_the_real_field():
    """同一个 index 既说像又说 `__none__` 时，真的那个字段赢——不额外加分支，
    靠"`__none__` 不在 FIELD_LABELS 里"这条天然成立。"""
    provider = FakeProvider(
        {
            "matches": [
                {"index": 0, "field": ai.NONE_FIELD},
                {"index": 0, "field": "phone"},
            ]
        }
    )

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {0: ("phone",)}


@pytest.mark.parametrize(
    "garbage",
    [
        {"matches": "不是列表"},
        {"matches": [None, "字符串", 42]},
        {"matches": [{"index": "不是数字", "field": "name"}]},
        {"matches": [{"field": "name"}]},
        {"matches": [{"index": 0}]},
        {},
    ],
)
async def test_malformed_matches_are_tolerated(garbage):
    """模型输出不守规矩时**一条都不采纳**，但不能抛。"""
    provider = FakeProvider(garbage)

    assert await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN))) == {}


async def test_invalid_json_raises_rather_than_silently_returning_nothing():
    """解析失败要抛：调用方得能分清"模型说都不像"和"模型调用挂了"。"""

    class BrokenProvider(FakeProvider):
        async def chat(self, messages):
            return "抱歉，我无法完成这个请求。"

    with pytest.raises(LLMError):
        await ai.identify_fields(BrokenProvider(), _controls(_raw(0, **UNKNOWN)))


async def test_provider_error_propagates():
    provider = FakeProvider(error=LLMError("模型服务暂不可用，请稍后重试"))

    with pytest.raises(LLMError):
        await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN)))


# ===== 缓存 =====

async def test_same_control_is_asked_only_once():
    provider = FakeProvider({"matches": [{"index": 0, "field": "phone"}]})
    control = _controls(_raw(0, **UNKNOWN))

    assert await ai.identify_fields(provider, control) == {0: ("phone",)}
    assert await ai.identify_fields(provider, control) == {0: ("phone",)}
    assert len(provider.messages) == 1, "第二次应当命中缓存"


async def test_a_none_answer_is_cached_too():
    """"这个框不属于任何字段"本身就是一个可复用的判断，不该反复付调用。"""
    provider = FakeProvider({"matches": [{"index": 0, "field": ai.NONE_FIELD}]})
    control = _controls(_raw(0, **UNKNOWN))

    await ai.identify_fields(provider, control)
    await ai.identify_fields(provider, control)
    assert len(provider.messages) == 1


async def test_cache_hit_does_not_depend_on_the_index():
    """同一个控件换个位置（不同页面上的同一个框）应当命中缓存。"""
    provider = FakeProvider({"matches": [{"index": 0, "field": "phone"}]})
    await ai.identify_fields(provider, _controls(_raw(0, **UNKNOWN)))
    await ai.identify_fields(provider, _controls(_raw(7, **UNKNOWN)))
    assert len(provider.messages) == 1


async def test_different_nearby_text_is_a_different_control():
    """邻近文字不同就不能算同一个框——那是区分同名控件的关键信息。"""
    provider = FakeProvider({"matches": [{"index": 0, "field": "phone"}]})
    await ai.identify_fields(provider, _controls(_raw(0, nearby_text="实习经历", **UNKNOWN)))
    await ai.identify_fields(provider, _controls(_raw(0, nearby_text="项目经历", **UNKNOWN)))
    assert len(provider.messages) == 2


async def test_failure_is_not_cached():
    """失败不能缓存，否则一次网络抖动会让这个框永远得不到帮助。"""
    provider = FakeProvider(error=LLMError("模型响应超时，请稍后重试"))
    control = _controls(_raw(0, **UNKNOWN))
    for _ in range(2):
        with pytest.raises(LLMError):
            await ai.identify_fields(provider, control)

    ok = FakeProvider({"matches": [{"index": 0, "field": "phone"}]})
    assert await ai.identify_fields(ok, control) == {0: ("phone",)}


async def test_cache_is_bounded():
    provider = FakeProvider({"matches": []})
    for index in range(ai._CACHE_MAX + 20):
        await ai.identify_fields(provider, _controls(_raw(0, label=f"所在部门意见 {index}")))

    assert len(ai._cache) <= ai._CACHE_MAX


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

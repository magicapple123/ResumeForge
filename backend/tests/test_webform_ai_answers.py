"""网申填表 AI 兜底 · 输出白名单与语义缓存。

模型输出被关在字段目录里：目录外字段丢弃、``__none__`` 与自相矛盾的答案怎么收敛、
坏输出一条不采纳；语义缓存命中/失效/有界。共享替身见 ``test_webform_ai.py``。

⚠️ 本文件的 autouse ``_clear_ai_cache`` **必须在文件内重新声明**——import 而来的
autouse fixture 不会生效（autouse 只来自 conftest / 本模块 / 插件）。
"""
import pytest
from app.services.llm.base import LLMError
from app.services.webform import ai
from app.services.webform.fields import FIELD_KEYS
from test_webform_ai import UNKNOWN, FakeProvider, _controls, _raw


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串。（与主文件同款，import 不传播 autouse。）"""
    ai.clear_cache()
    yield
    ai.clear_cache()


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

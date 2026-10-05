"""AI 采纳前的守门：负向词与跨族否决对模型答案同样生效。

规则引擎一直有这两道闸，模型答案此前可以绕过去——模型把「紧急联系人姓名」框认成
``name`` 时，规则层拦得住、``preview`` / ``live`` 的采纳层拦不住。批量预览与实时
面板两条路径都钉在这里。
"""
import pytest

from app.services.webform import ai
from app.services.webform.live import LiveSession
from app.services.webform.service import build_preview, enrich_preview_with_ai

from test_webform_ai import FakeProvider, _raw, _snapshot
from test_webform_live import FakeLiveClient, raw_control


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串。"""
    ai.clear_cache()
    yield
    ai.clear_cache()


async def test_preview_rejects_an_ai_answer_that_the_hints_veto():
    """「所在部门意见」框 + 模型答 experience_department：负向词否定，不采纳。

    规则层早就把它当"反馈栏、不是经历里的任职部门"（FIELD_EXCLUDE_HINTS）挡下——
    采纳层必须用同一道闸，否则模型答案等于绕过规则。这也是 AI 真会被问到的场景：
    规则把它留在"没认出来"，模型恰好会挑名字最像的那个字段。
    """
    snapshot = _snapshot(_raw(0, label="所在部门意见"))
    data = {"experience_department": "研发部"}
    report = build_preview(snapshot, data)
    assert [item.index for item in report.unrecognized] == [0]

    provider = FakeProvider({"matches": [{"index": 0, "field": "experience_department"}]})
    await enrich_preview_with_ai(snapshot, data, report, provider)

    assert report.items == []
    assert [item.index for item in report.unrecognized] == [0]


async def test_clean_ai_answers_still_go_through():
    """对照组：不踩任何闸门的候选照常采纳（守卫不是把 AI 一刀切关掉）。"""
    snapshot = _snapshot(_raw(0, label="所在部门意见"))
    data = {"research_direction": "分布式系统"}
    report = build_preview(snapshot, data)
    provider = FakeProvider({"matches": [{"index": 0, "field": "research_direction"}]})

    await enrich_preview_with_ai(snapshot, data, report, provider)

    assert [item.field for item in report.items] == ["research_direction"]


@pytest.mark.parametrize(
    ("label", "overrides", "candidate"),
    [
        # 亲属框 + 本人姓名：负向词否定（RELATIVE_HINTS）。
        ("紧急联系人姓名", {}, "name"),
        # 电话族框 + 日期字段：跨族否决（families.foreign_marker）。
        ("区号", {"name": "areaCode"}, "education_end"),
    ],
)
def test_live_panel_distinguishes_a_blocked_guess_from_missing_data(label, overrides, candidate):
    """实时面板：候选被守卫拦下时说"对不上"，不要说成"资料里还没填"。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三", "education_end": "2025-06"}, ai_enabled=True)
    raw = raw_control(label=label)
    raw.update(overrides)
    control = LiveSession._build_control(raw)
    assert control is not None

    session._publish_ai(control, (candidate,))

    panel = client.panels[-1]
    assert panel["status"] != "matched"
    assert "对不上" in panel["note"]

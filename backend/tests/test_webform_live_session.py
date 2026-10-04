"""自动填充请求游标与单控件建议判定（规则层）。

从 test_webform_live.py 拆出：autofill 的 ack / 页面跳转重装 / 终态错误三条，
加上 ``suggest_for`` 的单控件判定守门。FakeLiveClient 留在 test_webform_live.py。
"""
import json

import pytest

from app.services.webform import live as live_module
from app.services.webform.engine import Control
from app.services.webform.live import LiveSession
from app.services.webform.service import suggest_for

from test_webform_live import FakeLiveClient


def test_first_autofill_request_is_acknowledged_and_dispatched_once():
    client = FakeLiveClient()
    requests: list[int] = []

    def evaluate(expression, *, timeout=None):
        if "rf:live-state" in expression:
            return json.dumps(
                {
                    "seq": 0,
                    "control": None,
                    "accept": None,
                    "remember": None,
                    "live_control": {"enabled": True, "seq": 0},
                    "installed": True,
                    "autofill": {"seq": 1},
                }
            )
        return FakeLiveClient.evaluate(client, expression, timeout=timeout)

    client.evaluate = evaluate
    session = LiveSession(client, {"name": "张三"})

    class Worker:
        def request(self, sequence: int) -> bool:
            requests.append(sequence)
            return True

        def close(self) -> None:
            pass

    session._autofill_worker = Worker()
    session._tick()
    session._tick()

    assert requests == [1]
    assert any("rf:autofill-ack" in expression for expression in client.expressions)


def test_autofill_request_is_rearmed_after_page_navigation():
    client = FakeLiveClient()
    requests: list[int] = []
    original_evaluate = client.evaluate

    def evaluate(expression, *, timeout=None):
        if "rf:live-state" in expression:
            payload = json.loads(original_evaluate(expression, timeout=timeout))
            payload["autofill"] = {"seq": 1}
            return json.dumps(payload)
        return original_evaluate(expression, timeout=timeout)

    client.evaluate = evaluate
    session = LiveSession(client, {"name": "张三"})
    session._last_autofill_sequence = 1

    class Worker:
        def request(self, sequence: int) -> bool:
            requests.append(sequence)
            return True

        def close(self) -> None:
            pass

    session._autofill_worker = Worker()
    session._tick()  # 页面刚刷新，先重新注入并清掉上一页的请求游标。
    session._tick()  # 新页面第一次点击使用同样的 seq=1，也必须被派发。

    assert requests == [1]


def test_autofill_failure_is_published_as_terminal_error(monkeypatch):
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})

    def fail(*_args, **_kwargs):
        raise RuntimeError("读取失败")

    monkeypatch.setattr(live_module, "fill_current_page", fail)
    session._run_autofill(1)

    assert any(
        "rf:autofill-status" in expression and '"state": "error"' in expression
        for expression in client.expressions
    )


# ===== 单控件建议 =====


def test_a_plain_field_gets_a_value():
    suggestion = suggest_for(Control(index=0, type="text", label="姓名"), {"name": "张三"})
    assert suggestion.status == "matched"
    assert suggestion.field_label == "姓名"
    assert suggestion.value == "张三"


def test_denylisted_controls_are_blocked_with_the_reason_not_silently_skipped():
    suggestion = suggest_for(Control(index=0, type="text", label="验证码"), {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "验证码" in suggestion.note


@pytest.mark.parametrize("label", ["我已阅读并同意隐私政策", "无实习经历", "接受其他职位调剂"])
def test_consent_and_declaration_controls_are_blocked(label):
    """同意项代勾是替用户做法律意义上的同意；声明项是替他陈述事实。两类都不给「填入」。"""
    control = Control(index=0, type="checkbox", label=label, nearby_text=label)
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"


def test_a_factual_radio_is_not_blocked_for_being_a_radio():
    """**事实类的单选不再因为"它是单选"被挡**——分界在"是不是替你表态"，不在控件类型。

    实时模式实际不会把选择框报进焦点（注入脚本的 `allowed` 白名单里没有它们），所以这条
    守的是**判据本身**：将来若把选择框放进来，性别这种该填的不会被误挡。

    **只断言状态，不断言值**：单选的"选哪个"要靠**同组兄弟**才定得下来（页面上是「男」
    「女」两个 radio），而 `suggest_for` 是单控件接口、拿不到兄弟——值恒为空。带兄弟的
    那条链在批量预览里，值由 `test_a_matched_factual_radio_is_still_filled` 覆盖。
    真要把选择框接进实时模式，`suggest_for` 需要能拿到同组控件，那是另一件事。
    """
    control = Control(index=0, type="radio", label="男", nearby_text="性别 男 女")
    suggestion = suggest_for(control, {"gender": "男"})
    assert suggestion.status == "matched"
    assert suggestion.field == "gender"


def test_an_unmatched_choice_control_is_your_call_not_unrecognized():
    """没匹配上的选择框**不是"没认出来"**：目录里没有"勾选值"这种字段，
    「接受其他职位调剂」这类本来就该由用户表态。措辞与批量模式保持一致。"""
    control = Control(
        index=0, type="checkbox", label="接受其他职位调剂", nearby_text="接受其他职位调剂"
    )
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "自己点" in suggestion.note


def test_relative_fields_are_blocked_as_someone_elses_information():
    control = Control(index=0, type="text", nearby_text="请输入您父亲的姓名")
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "别人" in suggestion.note


def test_a_dial_code_box_is_recognized_by_its_own_current_value():
    """区号框只看文本认不出——它的旁文里反而含「手机号码*」，会被建议填完整手机号
    （字节页面上实测到的）。而"框里现在就是个国际区号"是它自己说的，比旁文硬。"""
    control = Control(index=0, type="text", value="+86", nearby_text="+86 +86 手机号码*")
    data = {"phone": "13800000000", "phone_country_code": "+86"}

    suggestion = suggest_for(control, data)

    assert suggestion.field == "phone_country_code"
    assert suggestion.value == "+86"


def test_a_dial_code_box_is_not_guessed_when_the_profile_has_none():
    control = Control(index=0, type="text", value="+86", nearby_text="+86 +86 手机号码*")
    suggestion = suggest_for(control, {"phone": "13800000000"})
    assert suggestion.field != "phone_country_code"


def test_an_unknown_control_is_reported_as_unrecognized():
    suggestion = suggest_for(Control(index=0, type="text", label="某某编号"), {"name": "张三"})
    assert suggestion.status == "unmatched"


def test_a_select_suggestion_carries_the_option_value_not_the_label():
    from app.services.webform.engine import SelectOption

    control = Control(
        index=0,
        type="select",
        label="学历",
        options=(SelectOption("3", "本科"), SelectOption("4", "硕士")),
    )
    suggestion = suggest_for(control, {"degree": "本科"})
    assert suggestion.status == "matched"
    assert suggestion.value == "3"

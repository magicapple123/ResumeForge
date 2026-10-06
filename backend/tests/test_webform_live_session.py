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


def test_autofill_uses_the_batch_data_loader(monkeypatch):
    client = FakeLiveClient()
    captured: dict[str, object] = {}
    session = LiveSession(
        client,
        {"name": "逐框资料"},
        autofill_data_loader=lambda: {"name": "批量资料"},
    )

    def capture(_client, data, **_kwargs):
        captured["data"] = data

    monkeypatch.setattr(live_module, "fill_current_page", capture)
    session._run_autofill(1)

    assert captured["data"] == {"name": "批量资料"}


# ===== 单控件建议 =====


def test_a_plain_field_gets_a_value():
    suggestion = suggest_for(Control(index=0, type="text", label="姓名"), {"name": "张三"})
    assert suggestion.status == "matched"
    assert suggestion.field_label == "姓名"
    assert suggestion.value == "张三"


def test_ambiguous_name_phone_context_is_not_presented_as_phone():
    control = Control(index=0, type="text", nearby_text="姓名* 手机号* 邮箱*")
    suggestion = suggest_for(
        control,
        {"name": "张三", "phone": "13800000000", "email": "z@example.com"},
    )

    assert suggestion.status == "unmatched"
    assert suggestion.field != "phone"


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


def test_a_factual_radio_is_blocked_because_its_value_comes_from_a_click():
    """**事实类的单选也不给「填入」**——「只填不点」（2026-10-05）。

    性别是事实、不是表态，但它的值是**点出来的**；工具只往文本类控件里写值。这条守的是
    判据本身（实时模式的注入脚本压根不会把选择框报进焦点，白名单里没有它们）。

    旧边界是反的：事实类单选照填、只挡表态类。现在按控件类型一刀切，理由见
    ``FormEngine.skip_reason``。
    """
    control = Control(index=0, type="radio", label="男", nearby_text="性别 男 女")
    suggestion = suggest_for(control, {"gender": "男"})
    assert suggestion.status == "blocked"
    assert "点选" in suggestion.note


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


def test_a_select_gets_a_blocked_suggestion_not_a_value():
    """下拉框在实时模式下给的是"你自己点"，不是某个选项的 value。

    这条曾经断言"建议里带的是 option 的 value 而不是它的文字"——那是自动填下拉时的
    要求；「只填不点」之后实时模式也不给下拉「填入」按钮了，请求本身就没了。
    """
    from app.services.webform.engine import SelectOption

    control = Control(
        index=0,
        type="select",
        label="学历",
        options=(SelectOption("3", "本科"), SelectOption("4", "硕士")),
    )
    suggestion = suggest_for(control, {"degree": "本科"})
    assert suggestion.status == "blocked"
    assert suggestion.value == ""
    assert "点选" in suggestion.note

"""填充失败的原因码与重试阶梯：有限、保守、不越界。

执行语料（``fixtures/webform/execution/*.json``）覆盖 happy path 与几类恢复；这里
补阶梯的**边界纪律**——上限、不覆盖、单选防反选、no_control 不重试、选项永不模糊选。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.engine.recovery import MAX_RETRIES
from app.services.webform.service.fill import _rebuild_mapping
from webform_engine_support import ScriptedCdpClient

_TEXT_CONTROL = {
    "index": 0,
    "type": "text",
    "label": "姓名",
    "placeholder": "请输入姓名",
    "selector": '[data-rf-index="0"]',
}
_RADIO_CONTROLS = [
    {
        "index": 0,
        "type": "radio",
        "name": "g",
        "value": "男",
        "label": "男",
        "nearby_text": "性别* 男 女",
        "group": "g",
        "checked": False,
        "selector": '[data-rf-index="0"]',
    },
    {
        "index": 1,
        "type": "radio",
        "name": "g",
        "value": "女",
        "label": "女",
        "nearby_text": "性别* 男 女",
        "group": "g",
        "checked": False,
        "selector": '[data-rf-index="1"]',
    },
]
_SET_OK = '{"ok": true, "value": "张三"}'


def _apply(controls_raw, selections, script):
    """跑一段**显式填充**（``/fill``）：``(控件序号, 字段, 值)`` → 映射 → 写入。

    不经过自动匹配：下拉 / 单选 / 复选 / 日期在匹配层就被"只填不点"挡下了
    （``FormEngine.skip_reason``），拿不到映射。这里守的是这些控件**在显式指令下**
    的执行与重试纪律——整理映射用的是 ``/fill`` 同一条 ``_rebuild_mapping``。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(controls_raw)
    by_index = {control.index: control for control in controls}
    mappings = [
        mapping
        for index, field_name, value in selections
        if (mapping := _rebuild_mapping(by_index[index], field_name, value)) is not None
    ]
    client = ScriptedCdpClient(script)
    outcomes = engine.apply(client, mappings, timeout=0, recheck_delay=0.0)
    client.assert_finished()
    return outcomes, client


def test_retries_stop_at_max_and_report_honestly():
    """一直填不进去：最多 1 + MAX_RETRIES 次尝试，然后如实上报，不无限重试。"""
    empty = '{"ok": true, "value": "", "checked": false}'
    script = []
    for attempt in range(1, MAX_RETRIES + 2):
        if attempt > 1:
            script.append({"needle": "rf:read-back", "reply": empty})  # 重试前的探查
        script.append({"needle": "rf:set-value", "reply": _SET_OK})
        script.append({"needle": "rf:read-back", "reply": empty})  # 首次回读
        script.append({"needle": "rf:read-back", "reply": empty})  # 不一致后的复读

    (outcome,), client = _apply([_TEXT_CONTROL], [(0, "name", "张三")], script)

    assert outcome.status == "unverified"
    assert outcome.reason == "value_mismatch"
    assert outcome.attempts == 1 + MAX_RETRIES
    assert client.calls("rf:set-value") == 1 + MAX_RETRIES


def test_no_control_is_not_retried():
    """定位符找不到控件：页面已重渲染，重写只会再失败一次——不重试。"""
    script = [
        {"needle": "rf:set-value", "reply": _SET_OK},
        {"needle": "rf:read-back", "reply": '{"ok": false, "reason": "no_control"}'},
    ]

    (outcome,), client = _apply([_TEXT_CONTROL], [(0, "name", "张三")], script)

    assert outcome.status == "unverified"
    assert outcome.reason == "no_control"
    assert outcome.attempts == 1
    assert client.calls("rf:set-value") == 1


def test_radio_is_re_probed_before_any_second_click():
    """单选重试前先回读勾选态：已经勾上就直接判成功，绝不再点（再点会反选）。"""
    script = [
        {"needle": "rf:click-rect", "reply": '{"ok": true, "x": 10, "y": 20}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": false}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": true}'},
    ]

    (outcome,), client = _apply(_RADIO_CONTROLS, [(1, "gender", "女")], script)

    assert outcome.status == "filled"
    assert outcome.attempts == 1
    assert client.calls("rf:click-rect") == 1


def test_not_checked_radio_gets_one_more_click():
    """对照组：探查确认没勾上，才允许再点一次。"""
    script = [
        {"needle": "rf:click-rect", "reply": '{"ok": true, "x": 10, "y": 20}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": false}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": false}'},
        {"needle": "rf:click-rect", "reply": '{"ok": true, "x": 10, "y": 20}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": true}'},
    ]

    (outcome,), client = _apply(_RADIO_CONTROLS, [(1, "gender", "女")], script)

    assert outcome.status == "filled"
    assert outcome.attempts == 2
    assert client.calls("rf:click-rect") == 2


def test_a_stale_checked_snapshot_cannot_block_the_retry_click():
    """快照说"已勾选"、页面其实没勾：首次不点是对的（防反选），但探查确认没勾上后，
    重试必须真的点下去——否则这个框永远填不上。"""
    stale = [dict(_RADIO_CONTROLS[0]), dict(_RADIO_CONTROLS[1], checked=True)]
    script = [
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": false}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": false}'},
        {"needle": "rf:click-rect", "reply": '{"ok": true, "x": 10, "y": 20}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "女", "checked": true}'},
    ]

    (outcome,), client = _apply(stale, [(1, "gender", "女")], script)

    assert outcome.status == "filled"
    assert outcome.attempts == 2
    assert client.calls("rf:click-rect") == 1


def test_a_phone_rejected_with_separators_is_retried_as_digits():
    """电话类字段第一次被页面清空 → 第二次换纯数字写法。

    2026-10-05 字节页实测：资料里的手机号带分隔符（``138-0000-0000``），写进去被页面
    清空（那个框只收 11 位数字）；同一个值在腾讯页却被页面自己规范化成 ``13800000000``。
    重试换纯数字，两种页面都能落。
    """
    empty = '{"ok": true, "value": "", "checked": false}'
    script = [
        {"needle": "rf:set-value", "reply": '{"ok": true, "value": "138-0000-0000"}'},
        {"needle": "rf:read-back", "reply": empty},
        {"needle": "rf:read-back", "reply": empty},
        {"needle": "rf:read-back", "reply": empty},
        {"needle": "rf:set-value", "reply": '{"ok": true, "value": "13800000000"}'},
        {"needle": "rf:read-back", "reply": '{"ok": true, "value": "13800000000", "checked": false}'},
    ]
    controls = [
        {
            "index": 0,
            "type": "tel",
            "label": "手机号",
            "placeholder": "请输入手机号",
            "selector": '[data-rf-index="0"]',
        }
    ]

    (outcome,), client = _apply(controls, [(0, "phone", "138-0000-0000")], script)

    assert outcome.status == "filled"
    assert outcome.attempts == 2
    writes = [item for item in client.expressions if "/* rf:set-value */" in item]
    assert "138-0000-0000" in writes[0]
    assert "13800000000" in writes[1] and "138-0000-0000" not in writes[1]


def test_a_broken_readback_gets_one_probe_and_then_gives_up():
    """回读通道真坏了：给一次探查机会，之后如实上报 readback_error，不无限试。"""
    hiccup = {"raise": "RuntimeError", "message": "client hiccup"}
    script = [
        {"needle": "rf:set-value", "reply": _SET_OK},
        {"needle": "rf:read-back", "reply": hiccup},
        {"needle": "rf:read-back", "reply": hiccup},
        {"needle": "rf:set-value", "reply": _SET_OK},
        {"needle": "rf:read-back", "reply": hiccup},
    ]

    (outcome,), client = _apply([_TEXT_CONTROL], [(0, "name", "张三")], script)

    assert outcome.status == "unverified"
    assert outcome.reason == "readback_error"
    assert outcome.attempts == 2
    assert client.calls("rf:set-value") == 2


def test_no_option_never_falls_back_to_fuzzy_matching():
    """下拉没有匹配项：只重读选项再严格匹配，**永远不写一个"最接近"的值**。"""
    controls = [
        {
            "index": 0,
            "type": "select",
            "label": "期望工作地点",
            # 联动下拉：快照里只有占位项，真实选项要等父级选择后才异步出现——
            # 这条测试正是要它"永远等不到匹配项"。
            "linked_select": True,
            "options": [{"v": "", "t": "请选择", "d": False}],
            "selector": '[data-rf-index="0"]',
        }
    ]
    only_placeholder = {
        "needle": "rf:select-options",
        "reply": '{"ok": true, "options": [{"v": "", "t": "请选择", "d": false}]}',
    }
    not_selected = '{"ok": true, "value": "", "display": "请选择", "checked": false}'
    script = [
        only_placeholder,
        {"needle": "rf:read-back", "reply": not_selected},
        only_placeholder,
        {"needle": "rf:read-back", "reply": not_selected},
        only_placeholder,
    ]

    (outcome,), client = _apply(controls, [(0, "target_city", "北京")], script)

    assert outcome.status == "failed"
    assert outcome.reason == "no_option"
    assert outcome.attempts == 1 + MAX_RETRIES
    # 关键断言：从头到尾没有发生过一次"选项写入"。
    assert client.calls("rf:select-option") == 0

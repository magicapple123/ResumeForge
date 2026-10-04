"""网申填表引擎 · 写入分派与逐项结果。

写入后回读校验、复选框信任鼠标事件、单个控件失败不拖垮整轮——"对着真 bug"的写入
回归守卫都在这里。主文件与共享替身见 ``test_webform_engine.py``。
"""
from app.services.webform.engine import (
    Control,
    FormEngine,
    FieldMapping,
    SelectOption,
    SelectResolution,
)

from test_webform_engine import RAW_CONTROLS, FakeCdpClient


def test_text_and_textarea_use_their_own_prototypes():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    fake = FakeCdpClient()

    engine.apply(
        fake,
        [
            FieldMapping(control=controls[0], field="name", value="张三"),
            FieldMapping(control=controls[5], field="summary", value="介绍"),
        ],
    )

    joined = "\n".join(fake.expressions)
    assert "HTMLInputElement.prototype" in joined
    assert "HTMLTextAreaElement.prototype" in joined


def test_apply_returns_a_per_item_outcome_with_read_back_verification():
    """写入后要回读校验：受控组件可能"看起来填了、其实没进去"。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "value": "李四"}'})

    outcomes = engine.apply(fake, [FieldMapping(control=controls[0], field="name", value="张三")])

    assert len(outcomes) == 1
    assert outcomes[0].status == "unverified"
    assert outcomes[0].field == "name"


def test_apply_marks_a_verified_write_as_filled():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "value": "张三"}'})

    outcomes = engine.apply(fake, [FieldMapping(control=controls[0], field="name", value="张三")])

    assert outcomes[0].status == "filled"


def test_an_already_checked_box_is_not_clicked_again():
    """对已勾选的复选框再点一下会把它**取消**——比不填更糟。"""
    engine = FormEngine()
    control = Control(
        index=0, type="checkbox", name="agree", value="yes",
        selector='[data-rf-index="0"]', checked=True,
    )
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "checked": true}'})

    outcomes = engine.apply(
        fake,
        [
            FieldMapping(
                control=control,
                field="summary",
                value="yes",
                select=SelectResolution("matched", option=SelectOption("yes")),
            )
        ],
    )

    assert outcomes[0].status == "filled"
    assert not any("dispatchMouseEvent" in method for method, _ in fake.sent)


def test_an_unchecked_box_is_clicked_with_a_trusted_mouse_event():
    engine = FormEngine()
    control = Control(
        index=0, type="checkbox", name="agree", value="yes",
        selector='[data-rf-index="0"]', checked=False,
    )
    fake = FakeCdpClient(
        replies={
            "rf:click-rect": '{"ok": true, "x": 10, "y": 20}',
            "rf:read-back": '{"ok": true, "checked": true}',
        }
    )

    outcomes = engine.apply(
        fake,
        [
            FieldMapping(
                control=control,
                field="summary",
                value="yes",
                select=SelectResolution("matched", option=SelectOption("yes")),
            )
        ],
    )

    assert outcomes[0].status == "filled"
    methods = [method for method, _ in fake.sent]
    assert methods.count("Input.dispatchMouseEvent") == 3, "移动 / 按下 / 抬起"
    # 合成点击不该出现在这里——站点会静默忽略它。
    assert "rf:click-control" not in "\n".join(fake.expressions)


def test_one_failing_control_does_not_abort_the_whole_round():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)

    class Exploding(FakeCdpClient):
        """只让**第一个**控件炸：按 selector 区分，而不是按脚本类型——
        textarea 与 text 走的是同一个 ``rf:set-value`` 脚本。"""

        def evaluate(self, expression, *, timeout=None):
            if "rf:set-value" in expression and 'data-rf-index=\\"0\\"' in expression:
                raise RuntimeError("boom")
            return super().evaluate(expression, timeout=timeout)

    fake = Exploding(replies={"rf:read-back": '{"ok": true, "value": "介绍"}'})

    outcomes = engine.apply(
        fake,
        [
            FieldMapping(control=controls[0], field="name", value="张三"),
            FieldMapping(control=controls[5], field="summary", value="介绍"),
        ],
    )

    assert [outcome.status for outcome in outcomes] == ["failed", "filled"]


# ===== 快照脚本本身的机械保证 =====


def test_controls_script_skips_password_and_submit_like_controls():
    """密码框连值都不该读进来；提交类控件永远不该被打上定位符——这是
    "绝不自动提交"的第一道机械保证。"""
    from app.services.webform.engine import CONTROLS_SCRIPT

    assert "t === 'password'" in CONTROLS_SCRIPT
    assert "'submit'" in CONTROLS_SCRIPT and "'button'" in CONTROLS_SCRIPT
    assert "'reset'" in CONTROLS_SCRIPT
    # 采集当前值（判断"用户已经填过"要靠它），但密码那条分支已经 continue 掉了。
    assert "value: String(el.value" in CONTROLS_SCRIPT

"""「网申填表放宽模式」控件判类（relaxed_kind）守卫。

从 test_webform_relaxed.py 按主题迁出的第一块：判类是放宽模式的**准入闸门**
（哪些控件形态允许被代点 / 代勾），独立成文。用例与断言逐字保留，用例总数不减。

``_popup`` / ``_consent`` 两个小助手原文件仍在用、体量又小（各十余行），不值得
进 conftest——按拆分约定在本文件自足复制；改动时两处一起看。
"""
import pytest
from app.services.webform import FormEngine
from app.services.webform.engine import relaxed_kind


def _popup(**overrides) -> dict:
    """自定义下拉的输入框形态：只读 + 声明了弹层。"""
    base = {
        "index": 0,
        "type": "text",
        "label": "意向城市",
        "nearby_text": "意向城市*",
        "readonly": True,
        "has_popup": True,
        "selector": '[data-rf-index="0"]',
        "options": [],
        "value": "",
        "display": "",
        "checked": False,
    }
    base.update(overrides)
    return base


def _consent(index: int = 0) -> dict:
    return {
        "index": index,
        "type": "checkbox",
        "label": "我已阅读并同意隐私政策",
        "nearby_text": "我已阅读并同意隐私政策",
        "selector": f'[data-rf-index="{index}"]',
    }


# ===== 判类（relaxed_kind） =====


def test_relaxed_kind_never_widens_beyond_skip_reason():
    """放宽只会在 blocked 集合**内部**放行：relaxed_kind 认可的控件必然被 skip_reason 挡过。"""
    controls = [
        _popup(),
        {"index": 1, "type": "select", "label": "学历", "selector": '[data-rf-index="1"]'},
        _consent(2),
        {
            "index": 3,
            "type": "radio",
            "label": "女",
            "nearby_text": "性别* 男 女",
            "selector": '[data-rf-index="3"]',
        },
    ]
    for control in FormEngine().snapshot_controls(controls):
        if relaxed_kind(control) is not None:
            assert FormEngine.skip_reason(control) is not None, control.type


@pytest.mark.parametrize(
    "raw",
    [
        {"index": 0, "type": "file", "label": "简历附件", "selector": '[data-rf-index="0"]'},
        {"index": 0, "type": "date", "label": "出生日期", "selector": '[data-rf-index="0"]'},
        {"index": 0, "type": "month", "label": "入职月份", "selector": '[data-rf-index="0"]'},
        {
            "index": 0,
            "type": "text",
            "label": "",
            "autocomplete": "new-password",
            "selector": '[data-rf-index="0"]',
        },
        {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
    ],
)
def test_file_date_password_and_plain_text_are_never_relaxed(raw):
    """日期（含日历弹层）、文件上传、密码与普通文本框：放宽模式不碰。"""
    assert relaxed_kind(FormEngine().snapshot_controls([raw])[0]) is None


@pytest.mark.parametrize("label", ["入学时间", "毕业日期", "起止时间", "选择日期"])
def test_text_popup_date_picker_is_never_relaxed(label):
    control = FormEngine().snapshot_controls(
        [
            _popup(
                label=label,
                nearby_text=f"{label}*",
                placeholder="请选择",
            )
        ]
    )[0]

    assert relaxed_kind(control) is None


def test_popup_select_consent_and_fact_choices_are_classified():
    controls = FormEngine().snapshot_controls(
        [
            _popup(),
            {"index": 1, "type": "select", "label": "学历", "selector": '[data-rf-index="1"]'},
            _consent(2),
            {
                "index": 3,
                "type": "checkbox",
                "label": "无实习经历",
                "nearby_text": "无实习经历",
                "selector": '[data-rf-index="3"]',
            },
            {
                "index": 4,
                "type": "radio",
                "label": "女",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="4"]',
            },
        ]
    )
    assert relaxed_kind(controls[0]) == "popup"
    assert relaxed_kind(controls[1]) == "select"
    assert relaxed_kind(controls[2]) == "confirm"
    assert relaxed_kind(controls[3]) == "confirm"
    assert relaxed_kind(controls[4]) == "choice"

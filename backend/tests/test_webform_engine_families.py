"""日期族的跨族否决与它的边界。

2026-10-05 鹰角 apply 页实测：区号框旁的报错文案含「毕业时间不能晚于当前日期」，
``education_end`` 经旁文档把日期写进了区号框。当时的处置是给四个日期字段逐条加
**签名级**负向词——它挡住了区号框，但也把被整表标签污染的普通日期框一并漏掉
（mokahr 的标签串里就含"手机号码"，见 ``test_polluted_nearby_text_...``）。
现在改为只看控件自述的跨族否决（``engine/families.py``），保护覆盖整个日期族。
"""
import pytest

from app.services.webform.engine import FormEngine
from app.services.webform.engine.families import FIELD_FAMILY, foreign_marker

POLLUTED = "姓名手机号码+86邮箱性别毕业时间*"


def _controls(*raws):
    return FormEngine().snapshot_controls(list(raws))


def _area_code_page():
    return _controls(
        {
            "index": 0,
            "type": "text",
            "name": "areaCode",
            "placeholder": "区号",
            "nearby_text": "手机号码（含区号）* 毕业时间不能晚于当前日期",
            "selector": '[data-rf-index="0"]',
        },
        {
            "index": 1,
            "type": "text",
            "placeholder": "选择日期",
            "nearby_text": "起止时间*",
            "selector": '[data-rf-index="1"]',
        },
    )


@pytest.mark.parametrize("field", sorted(FIELD_FAMILY))
def test_date_family_refuses_a_phone_self_described_control(field):
    """整个日期族都拒绝自述是电话/区号的控件，不只教育/工作的四个字段。"""
    result = FormEngine().match_fields(_area_code_page(), {field: "2025-06"})

    claimed = {mapping.control.index for mapping in result.mappings}
    assert 0 not in claimed, f"{field} 写进了区号框：{result.mappings}"


def test_polluted_nearby_text_does_not_veto_a_plain_date_control():
    """回归：污染旁文下的普通日期框必须照常填。

    签名级负向词（含旁文匹配）会把这一条整体漏掉——mokahr 页每个控件的旁文都累积着
    整表标签串，其中就含"手机号码"。跨族否决只看控件自述，污染不进自述。
    """
    controls = _controls(
        {
            "index": 10,
            "type": "text",
            "placeholder": "毕业时间",
            "nearby_text": POLLUTED,
            "selector": '[data-rf-index="10"]',
        },
    )

    result = FormEngine().match_fields(controls, {"education_end": "2023-06"})

    assert [(m.field, m.control.index, m.write_value()) for m in result.mappings] == [
        ("education_end", 10, "2023-06")
    ]


def test_foreign_marker_reads_only_the_controls_own_text():
    """判据是"控件自己说的"：旁文里的电话词不算，未登记族的字段不受影响。"""
    (polluted,) = _controls(
        {
            "index": 0,
            "type": "text",
            "placeholder": "选择日期",
            "nearby_text": "手机号码（含区号）* 毕业时间不能晚于当前日期",
            "selector": '[data-rf-index="0"]',
        }
    )
    (area_code,) = _controls(
        {"index": 0, "type": "text", "name": "areaCode", "placeholder": "区号", "selector": '[data-rf-index="0"]'}
    )

    assert foreign_marker(polluted, "education_end") is None
    assert foreign_marker(area_code, "education_end") == "区号"
    assert foreign_marker(area_code, "unregistered_field") is None


def test_relative_control_is_refused_for_the_owners_name_but_keeps_its_own():
    """「父亲姓名」框：本人姓名不许进（负向词），父亲姓名照常进。"""
    engine = FormEngine()
    controls = _controls(
        {
            "index": 0,
            "type": "text",
            "placeholder": "请输入父亲姓名",
            "selector": '[data-rf-index="0"]',
        }
    )

    assert engine.match_fields(controls, {"name": "张三"}).mappings == []
    mapped = engine.match_fields(controls, {"father_name": "张父"}).mappings
    assert [(m.field, m.control.index) for m in mapped] == [("father_name", 0)]

"""网申表单边界：分离年月输入框与跨标签歧义保护。"""

from app.services.webform.engine import FormEngine


def test_split_year_and_month_text_controls_receive_separate_date_components():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "label": "年*",
                "nearby_text": "教育经历 毕业时间",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "label": "月*",
                "nearby_text": "教育经历 毕业时间",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(controls, {"education_end": "2023-06"})

    assert len(result.mappings) == 2
    assert [mapping.write_value() for mapping in result.mappings] == ["2023", "06"]
    assert all(mapping.date is None for mapping in result.mappings)


def test_nearby_name_and_phone_labels_are_treated_as_ambiguous():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "nearby_text": "姓名* 手机号码* 邮箱*",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(
        controls,
        {"name": "张三", "phone": "13800000000", "email": "z@example.com"},
    )

    assert result.mappings == []


def test_a_specific_name_label_beats_phone_in_nearby_text():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "label": "姓名",
                "nearby_text": "姓名* 手机号* 邮箱*",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"name": "张三", "phone": "13800000000"})

    assert [(mapping.field, mapping.control.index) for mapping in result.mappings] == [
        ("name", 0)
    ]

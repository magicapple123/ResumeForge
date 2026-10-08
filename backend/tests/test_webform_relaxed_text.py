"""放宽模式文本匹配与网申资料自定义字段的回归测试。"""
from app.services.webform import FormEngine
from app.services.webform.service import build_preview, default_selections
from app.services.webform.session import Snapshot


def _snapshot(*controls: dict) -> Snapshot:
    return Snapshot(id="relaxed-text", controls=FormEngine().snapshot_controls(list(controls)))


def _text_control(index: int, *, label: str = "", placeholder: str = "", nearby: str = "") -> dict:
    return {
        "index": index,
        "type": "text",
        "label": label,
        "placeholder": placeholder,
        "nearby_text": nearby,
        "selector": f'[data-rf-index="{index}"]',
    }


def test_relaxed_mode_matches_a_custom_field_that_normal_mode_cannot_match():
    snapshot = _snapshot(
        _text_control(0, placeholder="请输入导师姓名", nearby="导师姓名*")
    )
    data = {"CUSTOM_导师姓名": "王教授"}
    labels = {"CUSTOM_导师姓名": "导师姓名"}

    conservative = build_preview(snapshot, data, relaxed=False, custom_labels=labels)
    assert conservative.items == []
    assert conservative.unrecognized

    relaxed = build_preview(snapshot, data, relaxed=True, custom_labels=labels)
    assert [(item.field, item.value) for item in relaxed.items] == [("CUSTOM_导师姓名", "王教授")]
    assert "放宽" in relaxed.items[0].note
    assert [item.index for item in default_selections(relaxed)] == [0]


def test_weak_custom_context_match_requires_explicit_confirmation():
    snapshot = _snapshot(_text_control(0, nearby="导师姓名"))
    data = {"CUSTOM_导师姓名": "王教授"}
    labels = {"CUSTOM_导师姓名": "导师姓名"}

    report = build_preview(snapshot, data, relaxed=True, custom_labels=labels)

    assert len(report.items) == 1
    assert report.items[0].status == "low_confidence"
    assert default_selections(report) == []


def test_relaxed_mode_does_not_guess_between_equal_repeated_text_candidates():
    snapshot = _snapshot(
        _text_control(0, nearby="描述"),
    )
    data = {
        "experience_1_description": "实习描述",
        "project_1_description": "项目描述",
    }

    report = build_preview(snapshot, data, relaxed=True)

    assert report.items == []
    assert report.unrecognized or report.missing_data


def test_nearby_only_generic_description_does_not_match_a_single_unscoped_section():
    snapshot = _snapshot(_text_control(0, nearby="描述"))
    report = build_preview(
        snapshot,
        {"experience_1_description": "实习内容"},
        relaxed=True,
    )

    assert report.items == []


def test_relaxed_matching_ignores_machine_name_fragments_and_unrelated_page_context():
    snapshot = _snapshot(
        {
            **_text_control(
                0,
                label="大赛经历",
                placeholder="请输入",
                nearby="大赛经历 公司或组织名称 时间 职位或职责 工作描述",
            ),
            "type": "textarea",
            "name": "competitionsExp",
        }
    )

    report = build_preview(snapshot, {"gender": "女"}, relaxed=True)

    assert report.items == []


def test_short_generic_alias_is_not_matched_inside_a_long_prompt():
    snapshot = _snapshot(
        _text_control(
            0,
            placeholder="请列出你常用的 AI 工具&模型名称与版本号",
            nearby="请列出你常用的 AI 工具&模型",
        )
    )

    report = build_preview(
        snapshot,
        {"project_tech_stack": "活动策划,渠道对接,预算管理"},
        relaxed=True,
    )

    assert report.items == []


def test_unique_certificate_name_context_prefers_repeated_certificate_field():
    snapshot = _snapshot(_text_control(0, nearby="证书名称*"))
    data = {
        "professional_cert": "职业资格证书",
        "certificate_1_name": "新媒体运营结业证书",
    }

    report = build_preview(snapshot, data, relaxed=True)

    assert [(item.field, item.value) for item in report.items] == [
        ("certificate_1_name", "新媒体运营结业证书")
    ]


def test_explicit_unrelated_prompt_blocks_nearby_summary_match():
    snapshot = _snapshot(
        _text_control(
            0,
            placeholder="请填写技术方案、创新点、应用场景",
            nearby="核心简介:",
        )
    )

    report = build_preview(snapshot, {"summary": "个人经历摘要"}, relaxed=True)

    assert report.items == []


def test_explicit_award_prompt_blocks_experience_description_match():
    snapshot = _snapshot(
        _text_control(0, placeholder="请输入荣誉描述", nearby="荣誉名称* 荣誉描述")
    )

    report = build_preview(
        snapshot,
        {"experience_2_description": "实习工作内容"},
        relaxed=True,
    )

    assert report.items == []


def test_project_labeled_control_is_not_claimed_by_experience_field():
    snapshot = _snapshot(
        _text_control(0, placeholder="请输入项目名称", nearby="项目名称*")
    )
    report = build_preview(
        snapshot,
        {"experience_1_company": "示例科技有限公司", "project_1_name": "校园招聘会策划"},
        relaxed=True,
    )

    assert [(item.field, item.value) for item in report.items] == [
        ("project_1_name", "校园招聘会策划")
    ]


def test_relaxed_mode_assigns_equal_repeated_fields_in_page_order():
    snapshot = _snapshot(
        _text_control(0, nearby="描述"),
        _text_control(1, nearby="描述"),
    )
    data = {
        "experience_1_description": "第一段经历",
        "experience_2_description": "第二段经历",
    }

    report = build_preview(snapshot, data, relaxed=True)

    assert [(item.index, item.field, item.value) for item in report.items] == [
        (0, "experience_1_description", "第一段经历"),
        (1, "experience_2_description", "第二段经历"),
    ]
    assert [item.index for item in default_selections(report)] == [0, 1]


def test_repeated_first_slot_is_not_filled_twice_from_static_and_dynamic_keys():
    snapshot = _snapshot(
        _text_control(0, label="描述", nearby="描述"),
        _text_control(1, label="描述", nearby="描述"),
    )
    data = {
        "experience_description": "第一段经历",
        "experience_1_description": "第一段经历",
    }

    report = build_preview(snapshot, data, relaxed=True)

    assert [item.field for item in report.items].count("experience_description") + [
        item.field for item in report.items
    ].count("experience_1_description") == 1


def test_cross_field_competition_is_visible_as_low_confidence():
    snapshot = _snapshot(_text_control(0, nearby="学校名称 专业名称"))
    report = build_preview(
        snapshot,
        {"school": "示例大学", "major": "市场营销"},
        relaxed=True,
    )

    assert len(report.items) == 1
    assert report.items[0].status == "low_confidence"


def test_relaxed_mode_does_not_add_a_second_mapping_for_an_existing_logical_field():
    snapshot = _snapshot(
        _text_control(0, label="学校", nearby="学校"),
        _text_control(1, label="学校", nearby="学校"),
    )
    data = {"school": "示例大学"}

    report = build_preview(snapshot, data, relaxed=True)

    assert [item.field for item in report.items].count("school") == 1

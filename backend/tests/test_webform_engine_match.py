"""网申填表引擎 · 基础映射与重复区块。

label / placeholder / aria 的基本命中、重复经历区块按记录序号对号入座、联动
select 保留解析结果，以及区块限定与 start/end 的 DOM 顺序。日期映射见
``test_webform_engine_dates.py``，证据消歧见 ``test_webform_engine_ambiguity.py``；
主文件与共享替身见 ``test_webform_engine.py``。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.service.fill import _rebuild_mapping
from test_webform_engine import RAW_CONTROLS


def test_match_fields_maps_by_label_placeholder_and_aria():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    data = {
        "name": "张三",
        "phone": "13800000000",
        "email": "zhangsan@example.com",
        "target_city": "北京",
        "summary": "熟悉 Python",
    }

    result = engine.match_fields(controls, data)
    mapping = {m.field: m.control.index for m in result.mappings}

    assert mapping == {
        "name": 0,
        "phone": 1,
        "email": 2,  # 无 label，靠 placeholder / aria-label 命中
        "summary": 5,
    }
    # 3 号「期望工作地点」是原生下拉：只填不点，只可能出现在 skipped 里。
    # 4 号是附件、6 号是验证码，各有各的理由（见 controls 文件）。
    assert {note.control.index for note in result.skipped} == {3, 4, 6}
    city_reason = next(note.reason for note in result.skipped if note.control.index == 3)
    assert "点选" in city_reason


def test_repeated_experience_blocks_use_the_matching_record_number():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入实习公司",
                "nearby_text": "公司*",
                "block_label": "实习经历-1",
                "block_family": "experience",
                "block_index": 1,
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "请输入实习公司",
                "nearby_text": "公司*",
                "block_label": "实习经历-2",
                "block_family": "experience",
                "block_index": 2,
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls,
        {
            "experience_1_company": "甲公司",
            "experience_2_company": "乙公司",
        },
    )

    by_index = {mapping.control.index: mapping for mapping in result.mappings}
    assert by_index[0].value == "甲公司"
    assert by_index[1].value == "乙公司"
    assert by_index[1].field == "experience_2_company"


def test_yes_no_radios_are_click_only_and_never_matched():
    """「只填不点」（2026-10-05）：是否境外教育这类单选一律不自动填，如实列出来自己点。

    这条曾经是反的——事实类单选（是否境外教育、性别）默认勾选，只挡盖章式的表态项。
    维护者把边界收成"凡是值由点选产生的控件都不自动填"，重复区块里的是/否也不例外。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "radio",
                "label": "是",
                "nearby_text": "是否境外教育 是 否",
                "group": "education-overseas",
                "value": "1",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "radio",
                "label": "否",
                "nearby_text": "是否境外教育 是 否",
                "group": "education-overseas",
                "value": "0",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(controls, {"education_1_is_overseas": "是"})

    assert result.mappings == []
    assert [note.control.index for note in result.skipped] == [0, 1]
    assert "点选" in result.skipped[0].reason


def test_linked_native_select_is_kept_for_resolution_after_parent_options_load():
    """联动下拉在快照时只有占位项：**显式填充**不能把它当成"没有可选项"丢掉。

    自动匹配压根不会给下拉分配字段（"只填不点"），所以这条守的是 ``/fill`` 那条路：
    值照常整理出来，填充阶段重读当前 DOM 的 options 再严格匹配。
    """
    engine = FormEngine()
    control = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "select",
                "label": "当前所处地",
                "options": [{"v": "", "t": "请选择"}],
                "linked_select": True,
                "selector": '[data-rf-index="0"]',
            }
        ]
    )[0]

    mapping = _rebuild_mapping(control, "target_city", "天津")

    assert mapping is not None
    assert mapping.select is not None
    assert mapping.select.status == "no_option"


def test_a_context_only_match_still_counts_when_nothing_says_it_better():
    """只有周围文字提到也要认得出来——靠整表排版、标签在邻格的老站点全指望它。

    （性别这种"旁文才说得出是什么"的控件在「只填不点」之后不再自动填；这条守的是
    **证据分档本身**：旁文证据仍然是一档有效证据。）
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入",
                "nearby_text": "性别*",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    mapping = engine.match_fields(controls, {"gender": "女"}).mappings[0]

    assert mapping.control.index == 0
    assert mapping.value == "女"


def test_block_hints_keep_a_short_synonym_inside_its_own_block():
    """多段经历里的短词（"起止时间"、"职位"、"描述"）必须靠区块限定才不会串台。

    没有这条时，"起止时间"会在教育、实习、项目三个区块上同时命中，谁抢到全看控件序号
    ——填错格而且用户看不出来。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": "起止时间*",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": "起止时间* 实习经历-1 删除经历 公司* 职位*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    mapping = engine.match_fields(controls, {"experience_start": "2025.07"}).mappings[0]

    assert mapping.control.index == 1, "只能落在带「实习经历」的那个区块里"


def test_the_start_field_takes_the_first_date_of_the_block():
    """区块里两个日期控件签名一模一样，靠 DOM 顺序区分：start 拿前面的。"""
    engine = FormEngine()
    block = "起止时间* 实习经历-1 删除经历 公司* 职位*"
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": block,
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": block,
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls, {"experience_start": "2025.07", "experience_end": "2025.09"}
    )
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"experience_start": 0, "experience_end": 1}
    # 两个日期长得一样，无法从文本判断谁是谁——必须标成需确认让用户看一眼。
    assert all(mapping.low_confidence for mapping in result.mappings)

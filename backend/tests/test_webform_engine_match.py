"""网申填表引擎 · 重复区块与日期映射、文本启发式。

重复经历区块按记录序号对号入座、文本日期规整、起止日期分组，以及"控件自述胜过周围
文字"等启发式的回归守卫。主文件与共享替身见 ``test_webform_engine.py``。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.service import recognize_field

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

    mapping = {m.field: m.control.index for m in engine.match_fields(controls, data).mappings}

    assert mapping == {
        "name": 0,
        "phone": 1,
        "email": 2,  # 无 label，靠 placeholder / aria-label 命中
        "target_city": 3,
        "summary": 5,
    }


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


def test_repeated_education_yes_no_choices_match_without_a_block_title():
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

    assert len(result.mappings) == 1
    assert result.mappings[0].field == "education_1_is_overseas"
    assert result.mappings[0].control.index == 0


def test_tencent_style_referral_education_dates_and_supplement_are_mapped():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "如有内推串码可在此填写",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": "- 起止时间* -",
                "date_order": 1,
                "selector": '[data-rf-index="1"]',
            },
            {
                "index": 2,
                "type": "text",
                "placeholder": "选择日期",
                "nearby_text": "- 起止时间* -",
                "date_order": 2,
                "selector": '[data-rf-index="2"]',
            },
            {
                "index": 3,
                "type": "textarea",
                "placeholder": "请输入其他相关信息，如自我评价，爱好特长，补充信息等。",
                "nearby_text": "补充信息*",
                "selector": '[data-rf-index="3"]',
            },
        ]
    )

    mappings = {
        mapping.field: mapping for mapping in engine.match_fields(
            controls,
            {
                "referral_code": "345354543",
                "education_start": "2022.09",
                "education_end": "2026.06",
                "summary": "个人补充说明",
            },
        ).mappings
    }

    assert mappings["referral_code"].control.index == 0
    assert mappings["education_start"].control.index == 1
    assert mappings["education_end"].control.index == 2
    assert mappings["summary"].control.index == 3


def test_text_date_controls_are_formatted_like_the_target_page():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "label": "入学日期",
                "placeholder": "YYYY-MM-DD",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"education_start": "2022.3.9"})

    assert len(result.mappings) == 1
    assert result.mappings[0].date is not None
    assert result.mappings[0].write_value() == "2022-03-09"


def test_date_option_mapping_uses_the_page_option_value_after_normalizing_the_date():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "select",
                "label": "毕业日期",
                "options": [
                    {"v": "", "t": "请选择"},
                    {"v": "2022-03-09", "t": "2022-03-09"},
                ],
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"education_end": "2022.3.9"})

    assert len(result.mappings) == 1
    assert result.mappings[0].write_value() == "2022-03-09"


def test_split_year_and_month_selects_receive_one_profile_date():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "select",
                "label": "年",
                "nearby_text": "教育经历 毕业时间",
                "options": [{"v": "2026", "t": "2026"}, {"v": "2025", "t": "2025"}],
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "select",
                "label": "月",
                "nearby_text": "教育经历 毕业时间",
                "options": [{"v": "06", "t": "06"}, {"v": "05", "t": "05"}],
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(controls, {"education_end": "2026-06"})

    assert len(result.mappings) == 2
    assert [mapping.write_value() for mapping in result.mappings] == ["2026", "06"]
    assert {mapping.field for mapping in result.mappings} == {"education_end"}


def test_ambiguous_start_end_date_label_is_not_linked_as_one_date_group():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "select",
                "label": "年",
                "nearby_text": "教育经历 起止时间",
                "date_order": 1,
                "options": [{"v": "2026", "t": "2026"}],
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "select",
                "label": "月",
                "nearby_text": "教育经历 起止时间",
                "date_order": 1,
                "options": [{"v": "06", "t": "06"}],
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    assert all(not control.date_group for control in controls)


def test_linked_native_select_is_kept_for_resolution_after_parent_options_load():
    engine = FormEngine()
    controls = engine.snapshot_controls(
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
    )

    result = engine.match_fields(controls, {"city": "天津"})

    assert len(result.mappings) == 1
    assert result.mappings[0].select is not None
    assert result.mappings[0].select.status == "no_option"


def test_own_text_beats_surrounding_text():
    """**控件自己说的比周围文字更可信。**

    回归守卫：腾讯校招简历页上「导师 / 实验室 / 研究方向」三个框紧挨着，累积出来的
    上下文把三个标签都装进了彼此的签名——结果是"研究方向"被填进了「实验室」。
    自述命中必须排在前面的规则就是为这个加的。
    """
    engine = FormEngine()
    shared_context = "导师* 实验室* 研究方向*"
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入实验室",
                "nearby_text": shared_context,
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "请输入研究方向",
                "nearby_text": shared_context,
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    mapping = engine.match_fields(controls, {"research_direction": "推荐系统"}).mappings[0]

    assert mapping.control.index == 1
    assert mapping.control.placeholder == "请输入研究方向"


def test_a_neighbours_label_in_the_nearby_text_cannot_steal_a_control():
    """真机回归（2026-09-27，腾讯校招 ``join.qq.com/resumeedit.html``，69 个控件）。

    那一页「导师 / 实验室 / 研究方向 / 论文」四个框紧挨着，且 **label 全是空的**
    （antd 式，label 元素与 input 没有 for/id 关联），于是每个框的 ``nearby_text``
    都是这四个标签搅在一起的字符串：

        idx=33 请输入实验室     nearby='实验室 导师 * 实验室 研究方向 论文 0/1000'
        idx=35 请输入已发表论文 nearby='... 导师 * 实验室 研究方向 论文 0/1000'

    "研究方向"出现在**每一个**框的签名里，所以「实验室」「论文」双双被它抢走。

    **两个阶段的正确行为不同，而这条测试现在盯的是最终那一个：**

    - 当时「实验室」「论文」**不在**目录里，诚实答案是"没命中就返回 ``None``（认不出）"，
      绝不从邻居的标签里借一个，也绝不因此把 AI 兜底挡在门外。
    - 2026-09-27 给这两个补了目录字段与同义词（**刻意不收「研究」「发表」**——它们太泛，
      会把别的框也吸过来）。于是正确行为变成：**每个框认到它自己那一个**，
      四个框是四个不同的字段，谁也不抢谁。

    两种情况下**同一个不变量都成立**：占位符已经指明了字段时，答案要么是它、
    要么是"认不出"，**永远不会是邻居的字段**。这正是这条用例守的东西。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 32,
                "type": "text",
                "placeholder": "请输入导师",
                "nearby_text": "导师 * 导师 * 实验室 研究方向 论文 0/1000",
                "selector": '[data-rf-index="32"]',
            },
            {
                "index": 33,
                "type": "text",
                "placeholder": "请输入实验室",
                "nearby_text": "实验室 导师 * 实验室 研究方向 论文 0/1000",
                "selector": '[data-rf-index="33"]',
            },
            {
                "index": 34,
                "type": "text",
                "placeholder": "请输入研究方向",
                "nearby_text": "研究方向 导师 * 实验室 研究方向 论文 0/1000",
                "selector": '[data-rf-index="34"]',
            },
            {
                "index": 35,
                "type": "textarea",
                "placeholder": "请输入已发表论文，如未发表则无需填写",
                "nearby_text": "0/1000 论文 0/1000 导师 * 实验室 研究方向 论文 0/1000",
                "selector": '[data-rf-index="35"]',
            },
        ]
    )

    recognized = [recognize_field(control) for control in controls]

    # 每个框认到**它自己**那一个——四个互不相同，没有一个是"研究方向"偷来的。
    assert recognized == ["advisor", "laboratory", "research_direction", "paper"]
    assert len(set(recognized)) == 4, f"有框被邻居抢走了：{recognized}"


def test_a_context_only_match_still_counts_when_nothing_says_it_better():
    """但"只有周围文字提到"仍然要认得出来——性别就是靠它才认出的（label 只有"男"）。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "radio",
                "name": "g",
                "value": "男",
                "label": "男",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "radio",
                "name": "g",
                "value": "女",
                "label": "女",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    mapping = engine.match_fields(controls, {"gender": "女"}).mappings[0]

    assert mapping.control.index == 1


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

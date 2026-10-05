"""网申填表引擎 · 证据消歧与防抢框（占位符权威性与旁文污染见 ``test_webform_engine_placeholders.py``）。

控件自述胜过周围文字、邻居标签不得抢框、占位符并列的消歧与例外（区块 /
date_order 裁决）、负向词保护，以及裸占位符在整表标签污染下的存活性。
主文件与共享替身见 ``test_webform_engine.py``；基础映射见
``test_webform_engine_match.py``，日期映射见 ``test_webform_engine_dates.py``。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.service import recognize_field


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


def test_a_block_short_word_never_claims_a_control_without_its_block():
    """区块限定的短词（"描述"）没有区块名就不许认领控件。

    2026-10-05 鹰角「游戏经历」大文本框实测：旁文只说"描述您的游戏经历"，它一度被
    认成"实习描述（第一条）"。批量匹配里被区块准入挡着，实时面板曾漏了同一条判据
    （两处已统一到 ``block_hint_satisfied``）。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 21,
                "type": "textarea",
                "nearby_text": "请尽可能多而全面地描述您的游戏经历，包括但不限于游戏名称、时长、成就",
                "selector": '[data-rf-index="21"]',
            }
        ]
    )

    result = engine.match_fields(
        controls, {"experience_1_description": "示例实习描述", "summary": "示例自我评价"}
    )

    assert result.mappings == []


def test_a_cross_field_tie_is_marked_for_confirmation():
    """同一控件被两个不同字段同档同分争抢时报"需确认"，不许按字段表顺序静默硬分。

    2026-10-05 实测缺口：旁文「学校名称 专业名称」的框，school 与 major 同档同分
    并列，而现有低置信判据比的是**同一字段自己的冠亚军控件**，看不见跨字段争抢，
    于是 school 被静默选中——填错格且用户毫无提示。召回不放弃（照常填），
    但必须把"这里有两个可能"暴露出来。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "nearby_text": "学校名称 专业名称",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"school": "示例大学", "major": "计算机科学"})

    (mapping,) = result.mappings
    assert mapping.field == "school"
    assert mapping.low_confidence is True


def test_date_fields_refuse_controls_with_phone_words():
    """日期字段不写进带电话语义的控件——区号框旁的报错文案不能劫走毕业日期。

    2026-10-05 鹰角页实测：区号控件的邻近文案含报错句「毕业时间不能晚于当前日期」，
    education_end 经旁文档命中把日期写进了区号框。负向词（手机/号码/区号/电话）
    命中即跳过；对照的正常日期框不受影响（负向保护零误伤）。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
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
                "nearby_text": "毕业时间*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(controls, {"education_end": "2025-06"})
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"education_end": 1}


def test_school_and_major_values_never_enter_year_month_components():
    """date_part 组件槽位只收日期形状的值，学校/专业名不许被塞进年月框。

    2026-10-05 鹰角 apply 页实测：槽位机制先前不检查字段是否日期语义——
    学校/专业的值在年/月组件上各得一个槽位，「示例大学」整串进了年框和月框。
    值不是日期/年份形状（"2023-06"/"2019.9"/"2001"）的字段只能走普通槽位，
    由证据强度决定归属。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 14,
                "type": "text",
                "placeholder": "年",
                "nearby_text": "就读时间-学校名称专业名称学历",
                "selector": '[data-rf-index="14"]',
            },
            {
                "index": 15,
                "type": "text",
                "placeholder": "月",
                "nearby_text": "就读时间-学校名称专业名称学历",
                "selector": '[data-rf-index="15"]',
            },
            {
                "index": 18,
                "type": "text",
                "placeholder": "请输入就读学校",
                "nearby_text": "学校名称*",
                "selector": '[data-rf-index="18"]',
            },
            {
                "index": 19,
                "type": "text",
                "placeholder": "请输入专业名称",
                "nearby_text": "专业名称*",
                "selector": '[data-rf-index="19"]',
            },
        ]
    )

    by_field = {
        mapping.field: mapping.control.index
        for mapping in engine.match_fields(
            controls, {"school": "示例大学", "major": "市场营销"}
        ).mappings
    }

    assert by_field == {"school": 18, "major": 19}


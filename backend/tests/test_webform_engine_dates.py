"""网申填表引擎 · 日期映射与拆分组件。

文本日期规整、select 日期值、年/月拆分组件（select 与文本）、起止日期分组与
DOM 顺序裁决。主文件与共享替身见 ``test_webform_engine.py``；基础映射见
``test_webform_engine_match.py``，证据消歧见 ``test_webform_engine_ambiguity.py``。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.service.fill import _rebuild_mapping


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


# 「年 / 月 / 日」做成**下拉**的组件（毕业日期的日期下拉、年月两个 select）在这里
# 没有用例了：「只填不点」（2026-10-05）之后下拉一律不自动填，匹配层根本不会给它们
# 分配字段。下面是**文本框形态**的拆分组件——那是文本类，照常自动填。


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


def test_education_date_pair_takes_dom_order_when_evidence_ties():
    """教育经历的两个日期框证据同分时，start 必须拿 DOM 靠前的那个。

    2026-10-05 字节跳动校招页实测的 bug：``FIELD_SYNONYMS`` 里 ``education_end``
    定义在 ``education_start`` 之前，同分候选按 field_order 分配时 end 先挑，
    抢走 DOM 靠前的控件——入学/毕业整体写反（入学 2019-09、毕业 2023-06）。
    教育区块没有 FIELD_BLOCK_HINTS（任何教育区块都可能出现），只能靠定义顺序。
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
                "nearby_text": "起止时间*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls, {"education_start": "2021-09", "education_end": "2025-06"}
    )
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"education_start": 0, "education_end": 1}


def test_polluted_year_month_text_components_split_one_profile_date():
    """「年 / 月」**文本**组件在污染旁文 + 高风险并列下仍要接到拆分后的日期。

    这三个守卫来自 2026-10-05 鹰角 apply 页的一次实测（占位符裸写「年」「月」、旁文带着
    整表标签）——同日复核后，那一页的年/月确认是组件库下拉（已归入「只填不点」），但
    **文本形态**的年/月框在别处仍然存在，这三条判据照旧成立：

    - 电话负向词（"手机号码"之于 education_end 的排除词）不得误杀组件；
    - 高风险字段并列（"姓名"+"邮箱"同在旁文）不得把组件拦进消歧；
    - AI 兜底/匹配给出的完整日期必须拆开：年框收 "2023"，月框收 "06"，
      而不是两框各收一整串 "2023-06"。
    """
    engine = FormEngine()
    polluted = "姓名手机号码+86邮箱性别毕业时间*"
    controls = engine.snapshot_controls(
        [
            {
                "index": 10,
                "type": "text",
                "placeholder": "年",
                "nearby_text": polluted,
                "selector": '[data-rf-index="10"]',
            },
            {
                "index": 11,
                "type": "text",
                "placeholder": "月",
                "nearby_text": polluted,
                "selector": '[data-rf-index="11"]',
            },
            {
                "index": 5,
                "type": "text",
                "placeholder": "请输入手机号",
                "nearby_text": "手机号码（含区号）*",
                "selector": '[data-rf-index="5"]',
            },
        ]
    )

    by_field: dict[str, list[str]] = {}
    for mapping in engine.match_fields(
        controls,
        {"education_end": "2023-06", "phone": "13551567974"},
    ).mappings:
        by_field.setdefault(mapping.field, []).append(mapping.write_value())

    assert by_field["education_end"] == ["2023", "06"]
    assert by_field["phone"] == ["13551567974"]


def _paired_date_controls(gap: bool = False):
    """教育背景的「就读时间」四个连排控件（年/月/年/月），两组上下文一模一样。

    ``gap=True`` 时在两组之间插一个"请输入就读学校"（模拟可重复区块的第二条教育经历：
    它的日期组前面隔着别的控件），编号照真实页面连续。
    """
    block = "就读时间-学校名称专业名称学历删除本条 教育背景添加就读时间-学校名称专业名称学历删除本条"
    entries = [("年", block), ("月", block), ("年", block), ("月", block)]
    if gap:
        entries.insert(2, ("请输入就读学校", "学校名称*"))
    return FormEngine().snapshot_controls(
        [
            {
                "index": 14 + offset,
                "type": "text",
                "placeholder": placeholder,
                "nearby_text": nearby,
                "selector": f'[data-rf-index="{14 + offset}"]',
            }
            for offset, (placeholder, nearby) in enumerate(entries)
        ]
    )


def test_adjacent_date_group_pair_completes_the_end_field():
    """紧挨着的第二组年/月是"止"：两组上下文一模一样、都只说"就读时间"，
    候选循环只会把两组都算成 education_start，第二组永远填不上——按结构补成 ``*_end``。

    **只对文本形态生效**：鹰角那一页的四个控件 2026-10-05 复核后确认是组件库下拉，
    已经归入「只填不点」（见语料 pages/hypergryph-*-education-dates-are-library-selects），
    这条规则现在守的是别处的文本框形态。

    条件收紧：紧挨着 + 同父字段 + 资料里有对应的 ``*_end``，缺一不可。
    """
    engine = FormEngine()

    result = engine.match_fields(
        _paired_date_controls(), {"education_start": "2019-09", "education_end": "2023-06"}
    )

    assert {(mapping.field, mapping.control.index): mapping.write_value() for mapping in result.mappings} == {
        ("education_start", 14): "2019",
        ("education_start", 15): "09",
        ("education_end", 16): "2023",
        ("education_end", 17): "06",
    }


def test_date_groups_separated_by_other_controls_are_not_paired():
    """对照组：两组之间隔着别的控件（可重复区块的第二条教育经历）就不配对——
    防把第二条的起止误配成第一条的"止"。"""
    engine = FormEngine()

    result = engine.match_fields(
        _paired_date_controls(gap=True),
        {"education_start": "2019-09", "education_end": "2023-06"},
    )

    assert {mapping.field for mapping in result.mappings} == {"education_start"}


def test_rebuild_mapping_splits_full_dates_for_year_month_text_components():
    """预览改值与 AI 兜底走的 ``_rebuild_mapping`` 同样要把完整日期拆给年月组件。

    用户在预览里对着「年」框改成 "2023-06"（或 AI 兜底喂了整串）时，写入值必须是
    组件所属的那部分；不属于组件的形状（"2023" 喂给月框）如实原样保留，交给
    写入阶段报错，不静默篡改。普通文本框（无 date_part）不受影响。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "年",
                "nearby_text": "毕业时间*",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "月",
                "nearby_text": "毕业时间*",
                "selector": '[data-rf-index="1"]',
            },
            {
                "index": 2,
                "type": "text",
                "placeholder": "请输入就读学校",
                "selector": '[data-rf-index="2"]',
            },
        ]
    )
    year_control, month_control, plain_control = controls

    assert _rebuild_mapping(year_control, "education_end", "2023-06").value == "2023"
    assert _rebuild_mapping(month_control, "education_end", "2023-06").value == "06"
    # "2023" 里没有月份成分：不硬拆，原样保留。
    assert _rebuild_mapping(month_control, "education_end", "2023").value == "2023"
    # 普通文本框：整串原样。
    assert _rebuild_mapping(plain_control, "school", "示例大学").value == "示例大学"

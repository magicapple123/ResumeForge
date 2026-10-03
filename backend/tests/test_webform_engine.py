"""网申填表引擎离线测试：喂静态控件快照，断言类型识别、字段映射与写入分派。

不起浏览器：控件清单是纯数据结构（就是页面脚本会返回的那份 ``controls`` 列表）。

**这里刻意包含几条"对着真 bug"的回归守卫**（见 ``test_select_*`` / ``test_password_*``）。
旧引擎在 ``services/apply/form_engine.py`` 时也有测试，但那些测试用的假客户端不执行 JS，
只断言脚本字符串里出现了 ``rf:set-value`` 之类标记——于是"用 ``HTMLInputElement`` 的
setter 去写 ``<select>``"这种在 Chrome 里必炸的写法一路活到了生产。教训是：
**能断言语义就不要只断言字符串**；实在只能断言字符串时，要挑那个真正区分对错的特征。
"""
import pytest

from app.services.browser.cdp_client import CdpClient
from app.services.webform.engine import (
    Control,
    FieldMapping,
    FormEngine,
    SelectOption,
    SelectResolution,
)
from app.services.webform.fields import FIELD_KEYS, FIELD_SYNONYMS
from app.services.webform.service import recognize_field


class FakeCdpClient(CdpClient):
    """记录调用、按子串返回预设结果的假客户端。

    ``replies`` 让同一轮里的多次 ``evaluate``（写入、回读）拿到不同答案——
    回读校验要靠它才能被测到。
    """

    def __init__(self, evaluate_result=None, replies=None):
        self.evaluate_result = evaluate_result
        self.replies = dict(replies or {})
        self.expressions: list[str] = []
        self.uploaded: list[tuple[str, list[str]]] = []
        self.sent: list[tuple[str, dict]] = []
        self.tabs: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        self.tabs.append(url)
        return "TAB"

    def send(self, method, params=None, *, timeout=None):
        self.sent.append((method, dict(params or {})))
        return {}

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        for needle, value in self.replies.items():
            if needle in expression:
                return value
        return self.evaluate_result

    def set_file_input(self, selector, files, *, timeout=None):
        self.uploaded.append((selector, list(files)))

    def close(self):
        pass


RAW_CONTROLS = [
    {
        "index": 0,
        "type": "text",
        "name": "realName",
        "label": "姓名",
        "placeholder": "请输入姓名",
        "required": True,
        "selector": '[data-rf-index="0"]',
    },
    {
        "index": 1,
        "type": "text",
        "name": "mobile",
        "label": "手机号",
        "required": True,
        "selector": '[data-rf-index="1"]',
    },
    {
        "index": 2,
        "type": "text",
        "name": "",
        "placeholder": "请输入邮箱",
        "aria_label": "邮箱",
        "selector": '[data-rf-index="2"]',
    },
    {
        "index": 3,
        "type": "select",
        "name": "",
        "label": "期望工作地点",
        "options": [
            {"v": "", "t": "请选择", "d": False},
            {"v": "110000", "t": "北京", "d": False},
            {"v": "310000", "t": "上海", "d": False},
        ],
        "selector": '[data-rf-index="3"]',
    },
    {
        "index": 4,
        "type": "file",
        "name": "resume",
        "label": "上传简历",
        "selector": '[data-rf-index="4"]',
    },
    {
        "index": 5,
        "type": "textarea",
        "name": "",
        "label": "自我评价",
        "selector": '[data-rf-index="5"]',
    },
    {
        "index": 6,
        "type": "text",
        "name": "captcha",
        "label": "验证码",
        "required": True,
        "selector": '[data-rf-index="6"]',
    },
]


def test_snapshot_controls_recognizes_types_and_falls_back_to_unknown():
    controls = FormEngine().snapshot_controls(
        RAW_CONTROLS + [{"index": 99, "type": "weird", "label": "未知控件"}]
    )

    assert [c.type for c in controls] == [
        "text",
        "text",
        "text",
        "select",
        "file",
        "textarea",
        "text",
        "unknown",
    ]
    assert [option.value for option in controls[3].options] == ["", "110000", "310000"]
    assert [option.display() for option in controls[3].options] == ["请选择", "北京", "上海"]
    assert controls[0].required is True


def test_snapshot_controls_accepts_the_legacy_option_shape():
    """旧快照里 options 是纯字符串数组；兼容读取，别让老数据一次性炸掉。"""
    controls = FormEngine().snapshot_controls(
        [{"index": 0, "type": "select", "label": "城市", "options": ["北京", "上海"]}]
    )
    assert [option.value for option in controls[0].options] == ["北京", "上海"]
    assert [option.text for option in controls[0].options] == ["北京", "上海"]


def test_read_controls_parses_the_page_payload():
    payload = '{"controls": [{"index": 0, "type": "text", "label": "姓名"}]}'
    engine = FormEngine()

    controls = engine.read_controls(FakeCdpClient(payload))

    assert len(controls) == 1
    assert controls[0].label == "姓名"


def test_read_controls_tolerates_a_broken_payload():
    engine = FormEngine()
    assert engine.read_controls(FakeCdpClient("not json")) == []
    assert engine.read_controls(FakeCdpClient({"unexpected": True})) == []


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


def test_match_fields_never_reuses_one_control_for_two_fields():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )

    mappings = engine.match_fields(controls, {"name": "张三", "phone": "138"}).mappings

    assert [m.field for m in mappings] == ["name"]


def test_file_controls_are_never_mapped():
    """缺陷 5 的回归守卫：``file`` 控件原先会被映射并调 set_file_input，而导出管线不落
    临时文件、给不出本地路径——真实站点上会抛错并**中断整轮填充**。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    result = engine.match_fields(controls, {"summary": "介绍", "name": "张三"})

    assert all(mapping.control.type != "file" for mapping in result.mappings)
    assert any(note.control.type == "file" for note in result.skipped)


def test_denylisted_controls_are_skipped_with_a_reason():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    result = engine.match_fields(controls, {"name": "张三"})

    blocked = {note.control.index: note.reason for note in result.skipped}
    assert 6 in blocked, "验证码必须被拦下"
    assert "验证码" in blocked[6]


def test_exclude_hints_keep_relative_fields_out_of_personal_ones():
    """网申表单里全是"紧急联系人姓名""父亲电话"，纯包含匹配会把**用户本人**的资料
    填进亲属栏——这是这类功能最典型的低级错误。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
            {
                "index": 1,
                "type": "text",
                "label": "紧急联系人姓名",
                "required": True,
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(controls, {"name": "张三"})

    assert [m.control.index for m in result.mappings] == [0]
    assert {control.index for control in result.unmatched} == {1}


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


@pytest.mark.parametrize("label", ["无实习经历", "无项目经历", "无获奖信息", "至今"])
def test_declaration_checkboxes_are_never_auto_checked(label):
    """勾上它们等于替用户**陈述事实**（"我没有这段经历"/"这段还在进行"），不是填一个值。

    与"不替用户表达意愿"是同一条纪律。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "checkbox",
                "name": "flag",
                "label": label,
                "nearby_text": label,
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"summary": "有值的字段"})

    assert result.mappings == []
    assert any("声明类勾选" in note.reason for note in result.skipped)


# ===== autocomplete：唯一不需要猜的信号 =====


def test_autocomplete_beats_the_text_heuristics():
    """`autocomplete` 是站点按 HTML 规范主动声明的字段类型，不是我们从文本里猜的。

    这里刻意把标签写成会误导的"联系方式"，规范写法仍然应当赢。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "label": "联系方式",
                "autocomplete": "tel",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    mapping = engine.match_fields(controls, {"phone": "13800000000"}).mappings[0]

    assert mapping.field == "phone"


def test_autocomplete_wins_over_a_competing_context_match():
    """两个控件都沾边时，带 autocomplete 的那个赢——哪怕另一个的自述文本更像个字段。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入手机号码",
                "nearby_text": "手机号码*",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "选填",
                "autocomplete": "tel",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    mapping = engine.match_fields(controls, {"phone": "13800000000"}).mappings[0]

    assert mapping.control.index == 1


@pytest.mark.parametrize(
    "token, kind",
    [
        ("current-password", "密码"),
        ("new-password", "密码"),
        ("one-time-code", "验证码"),
        ("cc-number", "银行卡号"),
    ],
)
def test_site_declared_never_fill_tokens_are_skipped(token, kind):
    """站点自己声明"这是密码/验证码/银行卡"——比我们从标签猜更可信，直接拦下。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [{"index": 0, "type": "text", "autocomplete": token, "label": "随便什么"}]
    )

    result = engine.match_fields(controls, {"name": "张三"})

    assert result.mappings == []
    assert any(kind in note.reason for note in result.skipped)


def test_shared_page_context_does_not_trigger_password_block():
    """作品链接说明里的“如有密码”不能把整页普通字段误判成密码框。"""
    engine = FormEngine()
    shared_context = "如作品无法上传，请提供作品网盘链接（如有密码，用分号分隔）"
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "label": "姓名",
                "nearby_text": shared_context,
                "aria_describedby": shared_context,
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "请输入邮箱",
                "nearby_text": shared_context,
                "aria_describedby": shared_context,
                "selector": '[data-rf-index="1"]',
            },
            {
                "index": 2,
                "type": "select",
                "label": "性别",
                "nearby_text": shared_context,
                "aria_describedby": shared_context,
                "options": [
                    {"v": "", "t": "请选择", "d": False},
                    {"v": "male", "t": "男", "d": False},
                    {"v": "female", "t": "女", "d": False},
                ],
                "selector": '[data-rf-index="2"]',
            },
            {
                "index": 3,
                "type": "tel",
                "label": "手机号",
                "nearby_text": shared_context,
                "aria_describedby": shared_context,
                "selector": '[data-rf-index="3"]',
            },
        ]
    )

    result = engine.match_fields(
        controls,
        {
            "name": "张三",
            "email": "zhangsan@example.com",
            "gender": "男",
            "phone": "13800000000",
        },
    )

    assert result.skipped == []
    assert {mapping.field for mapping in result.mappings} == {"name", "email", "gender", "phone"}


@pytest.mark.parametrize(
    "control, expected_word",
    [
        (Control(index=0, type="text", label="密码"), "密码"),
        (Control(index=1, type="text", placeholder="请输入密码"), "密码"),
        (Control(index=2, type="text", name="password"), "password"),
    ],
)
def test_explicit_password_text_is_still_blocked(control, expected_word):
    engine = FormEngine()

    reason = engine.skip_reason(control)

    assert reason == f"涉及“{expected_word}”，永不自动填写"


def test_autocomplete_off_is_not_treated_as_a_block():
    """`off` 绝大多数时候是对**浏览器自带填充**的表态，不是针对用户用自己工具填自己的资料。
    Chrome 也把它当提示而非禁令，所以我们既不匹配也不拦——当"没有信息"。"""
    engine = FormEngine()

    assert engine.skip_reason(Control(index=0, type="text", autocomplete="off")) is None
    controls = engine.snapshot_controls(
        [{"index": 0, "type": "text", "label": "姓名", "autocomplete": "off"}]
    )
    assert engine.match_fields(controls, {"name": "张三"}).mappings[0].field == "name"


def test_an_unknown_autocomplete_token_changes_nothing():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [{"index": 0, "type": "text", "label": "姓名", "autocomplete": "webauthn"}]
    )
    assert engine.match_fields(controls, {"name": "张三"}).mappings[0].field == "name"


def test_the_autocomplete_table_only_points_at_real_fields():
    """映射表写错字段名会静默失效——这条把它钉住。"""
    from app.services.webform.fields import AUTOCOMPLETE_FIELDS, FIELD_KEYS

    unknown = {field for field in AUTOCOMPLETE_FIELDS.values() if field not in FIELD_KEYS}
    assert not unknown, f"autocomplete 表指向了不存在的字段：{sorted(unknown)}"


def test_unmapped_required_reports_controls_without_a_field():
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    result = engine.match_fields(controls, {"name": "张三"})

    unmapped = engine.unmapped_required(controls, result.mappings)

    # 两个都要报：手机号是"认得出但资料为空"，验证码是"永不自动填"——
    # 但对用户来说**两者都还得自己动手**，所以都算"必填但没填上"。
    # 具体原因由 ``MatchResult.skipped`` 给出，调用方据此分类展示。
    assert {control.index for control in unmapped} == {1, 6}


def test_select_mapping_uses_the_option_value_not_its_text():
    """``<option value="110000">北京</option>``：写进去的必须是 value。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(RAW_CONTROLS)
    result = engine.match_fields(controls, {"target_city": "北京"})

    mapping = next(m for m in result.mappings if m.field == "target_city")
    assert mapping.write_value() == "110000"


def test_select_placeholder_is_never_chosen():
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "select",
                "label": "性别",
                "options": [{"v": "", "t": "请选择", "d": False}],
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    assert engine.match_fields(controls, {"gender": "男"}).mappings == []


# ===== 单选组：必须整组参与匹配，才知道"性别=男"该点哪一个 =====


def _gender_radios() -> list[dict]:
    return [
        {
            "index": 0,
            "type": "radio",
            "name": "gender",
            "value": "male",
            "label": "男",
            "selector": '[data-rf-index="0"]',
        },
        {
            "index": 1,
            "type": "radio",
            "name": "gender",
            "value": "female",
            "label": "女",
            "selector": '[data-rf-index="1"]',
        },
    ]


def test_radio_group_selects_the_matching_option():
    engine = FormEngine()
    controls = engine.snapshot_controls(_gender_radios())

    mapping = engine.match_fields(controls, {"gender": "女"}).mappings[0]

    assert mapping.control.index == 1
    assert mapping.write_value() == "female"


def test_radio_group_matches_by_value_when_there_is_no_label():
    """不少站点的单选项**没有 label 元素**，只有 ``value="男"``，选项文字靠在旁边的
    兄弟节点上（这里落在 ``nearby_text`` 里）。此时只能靠 value 认。"""
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "radio",
                "name": "g",
                "value": "男",
                "nearby_text": "性别 男 女",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "radio",
                "name": "g",
                "value": "女",
                "nearby_text": "性别 男 女",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    mapping = engine.match_fields(controls, {"gender": "男"}).mappings[0]

    assert mapping.control.index == 0
    assert mapping.write_value() == "男"


def test_the_whole_radio_group_is_claimed_so_it_is_not_reused():
    engine = FormEngine()
    controls = engine.snapshot_controls(_gender_radios())

    result = engine.match_fields(controls, {"gender": "男"})

    assert [m.control.index for m in result.mappings] == [0]
    # 同组兄弟被一并占掉，所以不该出现在"认不出的控件"里——它属于答案的一部分。
    assert result.unmatched == []


# ===== 写入分派：这几条是"对着真 bug"的回归守卫 =====


def test_select_uses_the_select_prototype_not_the_input_one():
    """**旧缺陷 1 的回归守卫。**

    原实现让 ``select`` 落进 ``else`` 分支、用 ``HTMLInputElement.prototype`` 的 value
    setter 作用在 ``<select>`` 上，Chrome 会抛 ``Illegal invocation``。当时的测试只断言
    脚本里出现了 ``rf:set-value``，对此一无所知。
    """
    engine = FormEngine()
    control = Control(
        index=0, type="select", selector='[data-rf-index="0"]',
        options=(SelectOption("3", "本科"),),
    )
    mapping = FieldMapping(
        control=control,
        field="degree",
        value="本科",
        select=SelectResolution("matched", option=SelectOption("3", "本科")),
    )
    fake = FakeCdpClient()

    engine.apply(fake, [mapping])

    script = "\n".join(fake.expressions)
    assert "HTMLSelectElement.prototype" in script
    assert "HTMLInputElement.prototype" not in script
    assert "'change'" in script and "'input'" in script
    assert '"3"' in script, "写进去的必须是 option 的 value"


def test_linked_native_select_re_reads_current_options_before_writing():
    engine = FormEngine()
    control = Control(
        index=1,
        type="select",
        selector='[data-rf-index="1"]',
        options=(SelectOption("", "请选择"),),
        linked_select=True,
    )
    mapping = FieldMapping(
        control=control,
        field="city",
        value="天津",
        select=SelectResolution("no_option", reason="联动选项尚未加载"),
    )
    fake = FakeCdpClient(
        replies={
            "rf:select-options": '{"ok": true, "options": [{"v": "tj", "t": "天津市"}]}',
            "rf:read-back": '{"ok": true, "value": "tj"}',
        }
    )

    outcomes = engine.apply(fake, [mapping])

    assert outcomes[0].status == "filled"
    expressions = "\n".join(fake.expressions)
    assert "rf:select-options" in expressions
    assert '"tj"' in expressions


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


def test_catalog_and_synonyms_stay_in_step():
    """目录与同义词表必须一一对应——``name`` 曾经漏在目录外，这条会立刻抓到。"""
    assert set(FIELD_KEYS) == set(FIELD_SYNONYMS)


def test_control_signature_is_lowercased_and_handles_empty_strings():
    control = Control(index=0, label="姓名", name="realName")
    assert control.signature() == "姓名 realname"
    assert Control(index=1).signature() == ""


def test_is_filled_recognizes_placeholder_selections_as_empty():
    empty = Control(
        index=0, type="select", value="", display="请选择",
        options=(SelectOption("", "请选择"), SelectOption("1", "北京")),
    )
    filled = Control(
        index=1, type="select", value="1", display="北京",
        options=(SelectOption("", "请选择"), SelectOption("1", "北京")),
    )

    assert empty.is_filled() is False
    assert filled.is_filled() is True

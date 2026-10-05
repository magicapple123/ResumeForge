"""网申填表引擎离线测试：喂静态控件快照，断言类型识别、字段映射与写入分派。

不起浏览器：控件清单是纯数据结构（就是页面脚本会返回的那份 ``controls`` 列表）。

**这里刻意包含几条"对着真 bug"的回归守卫**（见 ``test_select_*`` / ``test_password_*``）。
旧引擎在 ``services/apply/form_engine.py`` 时也有测试，但那些测试用的假客户端不执行 JS，
只断言脚本字符串里出现了 ``rf:set-value`` 之类标记——于是"用 ``HTMLInputElement`` 的
setter 去写 ``<select>``"这种在 Chrome 里必炸的写法一路活到了生产。教训是：
**能断言语义就不要只断言字符串**；实在只能断言字符串时，要挑那个真正区分对错的特征。

本文件是主文件（快照/读取、映射守门与杂项守卫）；基础映射与重复块在
``test_webform_engine_match.py``，日期映射在 ``test_webform_engine_dates.py``，
证据消歧在 ``test_webform_engine_ambiguity.py``，autocomplete/密码/select/radio 在
``test_webform_engine_controls.py``，写入分派在 ``test_webform_engine_apply.py``。
"""
import pytest

from app.services.browser.cdp_client import CdpClient
from app.services.webform.engine import (
    Control,
    FormEngine,
    SelectOption,
)
from app.services.webform.fields import FIELD_KEYS, FIELD_SYNONYMS


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

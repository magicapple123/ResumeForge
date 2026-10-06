"""网申填表引擎 · autocomplete/密码拦截与控件写入分派。

``autocomplete`` 是站点主动声明的字段类型；密码/验证码/银行卡必须拦下。写入分派那
一节是"对着真 bug"的回归守卫，用**显式构造的映射**驱动（自动匹配只产出文本类映射，
下拉 / 单选 / 复选 / 日期见 ``skip_reason`` 的"只填不点"；显式填充那条路在
``/fill`` 里，用 ``_rebuild_mapping`` 整理）。主文件与共享替身见 ``test_webform_engine.py``。
"""
import pytest
from app.services.webform.engine import (
    Control,
    FieldMapping,
    FormEngine,
    SelectOption,
    SelectResolution,
)
from app.services.webform.service.fill import _rebuild_mapping
from test_webform_engine import RAW_CONTROLS, FakeCdpClient

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

    assert {mapping.field for mapping in result.mappings} == {"name", "email", "phone"}
    # 性别是下拉：只填不点。**唯一的 skipped 就是它**——共享的旁文没有把姓名/邮箱/手机
    # 的任一控件误判成密码框（那才是这条用例要守的事）。
    assert [note.control.index for note in result.skipped] == [2]
    assert "点选" in result.skipped[0].reason


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


def test_a_parenthetical_password_hint_does_not_block_the_control_itself():
    """括号里的内容不算控件名：『（如有密码，用分号分隔）』不能把作品链接框拦成永不填写。

    2026-10-05 鹰角 apply 页实测：整个"作品网盘链接"框因为占位符里的这句提示被
    FIELD_DENYLIST 的"密码"命中。真密码框的名字写在括号外（"密码"/"请输入密码"），
    照常拦下。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "如作品无法上传，请提供作品网盘链接（如有密码，用分号分隔)",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"portfolio_1_link": "https://example.com/p"})

    assert [(mapping.field, mapping.control.index) for mapping in result.mappings] == [
        ("portfolio_1_link", 0)
    ]
    # 对照：括号外的"密码"照常拦下。
    assert engine.skip_reason(Control(index=1, type="text", label="登录密码（区分大小写）"))


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


def test_a_fill_request_for_a_select_carries_the_option_value_not_its_text():
    """``<option value="110000">北京</option>``：写进去的必须是 value。

    自动匹配不给下拉分配字段（"只填不点"），所以这条走 ``/fill`` 的方式整理映射
    ——``_rebuild_mapping`` 就是填充请求用的那一个。
    """
    control = FormEngine().snapshot_controls(RAW_CONTROLS)[3]

    mapping = _rebuild_mapping(control, "target_city", "北京")

    assert mapping is not None
    assert mapping.write_value() == "110000"


def test_select_placeholder_is_never_chosen():
    """下拉连"请选择"这种占位项都不会被写进去——整个下拉都不参与自动匹配。"""
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

    result = engine.match_fields(controls, {"gender": "男"})

    assert result.mappings == []
    assert "点选" in result.skipped[0].reason


# ===== 「只填不点」：值由点选产生的控件永不参与自动匹配（2026-10-05 的产品边界）=====


@pytest.mark.parametrize(
    "control, expected_word",
    [
        (Control(index=0, type="select", label="性别"), "下拉"),
        (Control(index=1, type="radio", label="男", nearby_text="性别 男 女"), "单选"),
        (Control(index=2, type="checkbox", label="接受其他职位调剂"), "复选"),
        (Control(index=3, type="date", label="出生日期"), "日期"),
        (Control(index=4, type="month", label="毕业时间"), "日期"),
        (Control(index=5, type="text", label="意向城市", has_popup=True), "弹层"),
    ],
)
def test_click_only_controls_are_never_matched(control, expected_word):
    """按**类型**一刀切：这些框的值该由你在页面上点选，工具只写文本类控件。

    两条理由写在 `skip_reason` 的注释里（值是用户的选择、只读展示框写进去看着像填上了）。
    这条把它逐类钉死：放宽任何一类都会在这里红。**判据在引擎里只有这一处**——
    预览、实时面板、AI 采纳点都从 `skip_reason` 取值，不各写一份。
    """
    engine = FormEngine()

    reason = engine.skip_reason(control)

    assert reason is not None and expected_word in reason
    assert "点选" in reason
    data = {"gender": "男", "birth_date": "2000-05-01", "education_end": "2026-06"}
    assert engine.match_fields([control], data).mappings == []


# ===== 单选组 =====
#
# 「性别=男」该点哪一个，曾经靠"整组兄弟一起参与匹配"来定（同组一起占掉、按 value
# 兜底认选项文字）。「只填不点」（2026-10-05）之后单选不再自动填，那套**组内解析
# 逻辑连同这些用例一起删了**：单选/复选统一由 ``skip_reason`` 标成"需要你自己点选"，
# 显式填充则由调用方指名要哪个控件（``/fill`` 的执行纪律见执行语料里的两条 radio）。


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

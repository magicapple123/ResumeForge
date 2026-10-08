"""canary 家族 · AI 徽标与「记住这条」。

AI 正在识别/建议徽标、备选列表、「记住这条」意图分离，以及记忆编辑器（落点只有
「网申资料」）。运行方式与 skip 契约见主文件 ``test_webform_js_canary.py`` 的
docstring；共享的合成 DOM、资料目录与 helper 在 ``webform_canary_support.py``。
"""
from webform_canary_support import (
    _focus,
    _install,
    _install_editor,
    _open_panel,
    _shadow,
    page_client,
)

# page_client 是 pytest fixture（定义在支撑模块），经本模块命名空间解析；显式 re-export。
__all__ = ["page_client"]


def test_ai_thinking_says_ai_is_looking(page_client):
    """模型要 1~3 秒。面板必须先说"AI 在看"，否则用户对着一个静止的框等三秒。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate("window.__rfShowPanel({status: 'ai_thinking'})")

    text = page_client.evaluate(_shadow("textContent"))
    assert "AI 正在识别" in text
    assert page_client.evaluate(_shadow("querySelector('.fill').disabled")) is True


def test_the_ai_badge_marks_guesses(page_client):
    """AI 给的答案**必须看得出来是猜的**——规则命中至少有字对上了。"""
    _install(page_client)
    _focus(page_client, "#deep-name")

    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    assert page_client.evaluate(_shadow("querySelector('.src').style.display")) == "none"

    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '研究方向',"
        " value: '分布式系统', source: 'ai'})"
    )
    assert page_client.evaluate(_shadow("querySelector('.src').textContent")) == "AI 建议"
    assert page_client.evaluate(_shadow("querySelector('.src').style.display")) == "inline-block"


def test_alternatives_are_listed_with_a_fill_button_each(page_client):
    """模型拿不准时给的备选要**罗列出来**，每一条自带「填入」——就在输入框旁边。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate("window.__rfAccept = null")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '研究方向',"
        " value: '分布式系统', source: 'ai',"
        " alternatives: [{label: '导师', value: '王教授'}, {label: '专业', value: '软件工程'}]})"
    )

    rows = page_client.evaluate(_shadow("querySelectorAll('.alt').length"))
    assert rows == 2
    assert page_client.evaluate(_shadow("querySelectorAll('.alt button').length")) == 2
    text = page_client.evaluate(_shadow("textContent"))
    assert "王教授" in text and "软件工程" in text

    # 点第二条的「填入」——走的是与主按钮**同一个** accept。
    page_client.evaluate(_shadow("querySelectorAll('.alt button')[1].click()"))

    accept = page_client.evaluate("window.__rfAccept")
    assert accept, "点备选的「填入」没有记下来"
    assert accept["label"] == "专业"
    assert accept["value"] == "软件工程"
    assert accept["selector"] == '[data-rf-target="1"]'


def test_alternatives_are_hidden_when_there_are_none(page_client):
    """只有一条候选时不占地方——那是绝大多数情况。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate("window.__rfAccept = null")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三',"
        " alternatives: [{label: '导师', value: '王教授'}]})"
    )
    assert page_client.evaluate(_shadow("querySelector('.alts').classList.contains('on')")) is True

    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    assert page_client.evaluate(_shadow("querySelector('.alts').classList.contains('on')")) is False
    assert page_client.evaluate(_shadow("querySelectorAll('.alt').length")) == 0


def test_the_picker_button_is_always_present(page_client):
    """无论面板显示什么，「换个资料…」那条路都在——认不出的框永远不是死路。"""
    _install(page_client)
    _focus(page_client, "#deep-name")

    for payload in (
        "{status: 'thinking'}",
        "{status: 'ai_thinking'}",
        "{status: 'unmatched', note: '没认出来'}",
        "{status: 'blocked', note: '涉及“验证码”，永不自动填写'}",
    ):
        page_client.evaluate(f"window.__rfShowPanel({payload})")
        label = page_client.evaluate(_shadow("querySelector('.more').textContent"))
        assert label == "换个资料…", f"{payload} 时找不到入口：{label!r}"


# ===== 「记住这条」 =====
#
# ⚠️ **这几条只证明"脚本里有这个动作"，不证明行为**。离线测试不执行 JS，真机验证也只在
# 本机有受控浏览器时跑（CI 上是 skip）。所以真正的验证在手工验收那一步：开「点哪个填哪个」，
# 点一个资料里没有的框，按「记住这条」，再去「我的资料 → 网申资料」看它在不在。
# 写在这里的价值是：**按钮被删掉、标记被改名、或它与「填入」串了**，会被立刻发现。


def test_the_remember_button_records_a_separate_intent(page_client):
    """「记住这条」必须写进 ``__rfRemember``，**不能**动 ``__rfAccept``。

    两个全局分家是刻意的：``__rfAccept`` 的意思是"把这个值写进页面"，``__rfRemember``
    是"记进本地资料以后用"。共用一个全局的话，Python 只能靠猜来区分用户按了哪个按钮——
    而猜错的后果是**要么把不该写的值写进页面，要么把用户的资料改掉**。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    remember = page_client.evaluate("window.__rfRemember")
    assert isinstance(remember, dict), "「记住这条」没把意图记下来"
    assert remember["value"] == "张三"
    assert remember["label"] == "姓名"
    # 控件描述随意图一起带上：点面板会让页面输入框失焦，Python 那边拿不到现场。
    assert remember["control"]["selector"] == '[data-rf-focus="1"]'
    # **另一路没被碰到**。
    assert page_client.evaluate("window.__rfAccept") is None


def test_the_remember_button_never_writes_and_never_moves_the_target(page_client):
    """与「填入」同一条纪律：只记录意图，页面上什么都不动。

    尤其**不打 ``data-rf-target``**——那个标记是"接下来要往这里写"的信号，而"记住"根本
    不写。打上去的话，用户先点「记住」再点「填入」时，写入标记的归属就乱了。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""
    assert page_client.evaluate("!!document.querySelector('#deep-name[data-rf-target]')") is False


def test_select_radio_and_checkbox_controls_do_not_open_the_live_panel(page_client):
    """已有固定选项的控件不弹「点哪个填哪个」，避免与页面自己的选择交互打架。"""
    _install(page_client)

    for selector in ("#degree", "#gender-male", "#agree"):
        _focus(page_client, selector)
        assert page_client.evaluate(
            "!!document.querySelector('" + selector + "[data-rf-focus]')"
        ) is False
        assert page_client.evaluate(_shadow("querySelector('.p').style.display")) == "none"


def test_clicking_a_user_choice_control_hides_the_panel_left_over_from_the_last_field(
    page_client,
):
    """**点单选/复选必须把面板收掉**，不能留着上一个框的提示。

    原先只做到"不给这类控件弹面板"——`onFocus` 里遇到不认识的类型直接 `return`，
    而 `return` **不会**收掉已经在显示的面板。于是实际用起来是这样：先点「姓名」
    面板弹出"姓名：张三"，再点「性别」的某个单选框，**那条"将填入：姓名=张三"还挂在
    屏幕上**，看起来就像程序要把姓名填进性别里。

    "不给它提示"和"把它上面的提示清掉"是两件事，这条守的是后者。
    """
    _open_panel(page_client)
    assert page_client.evaluate(_shadow("querySelector('.p').style.display")) == "flex"

    for selector in ("#gender-male", "#agree", "#degree"):
        _focus(page_client, selector)
        assert page_client.evaluate(_shadow("querySelector('.p').style.display")) == "none", (
            f"点到 {selector} 之后，上一个框的面板还留着"
        )
        # 重新显示，好让下一个 selector 也从一个"面板开着"的状态开始。
        page_client.evaluate(
            "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
        )


def test_closing_the_panel_hides_it_until_the_next_field(page_client):
    _open_panel(page_client)

    page_client.evaluate(_shadow("querySelector('.close').click()"))

    assert page_client.evaluate(_shadow("querySelector('.p').style.display")) == "none"
    assert page_client.evaluate("window.__rfFocus") is None


def test_the_close_button_keeps_its_quiet_look(page_client):
    """`.close` 是低调的灰字——全局按钮规则 `button:not(.rf-live-switch)`（深蓝底白字，
    特异性 (0,1,1)）曾把它压成蓝色实心方块（用户反馈）。必须量**计算样式**：光看
    "脚本里有 .close 规则"看不出谁压过谁。"""
    import json as _json

    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    style = _json.loads(
        page_client.evaluate(
            "(() => { const root = document.getElementById('__rf_live_host__').shadowRoot;"
            " const s = getComputedStyle(root.querySelector('.close'));"
            " return JSON.stringify({background: s.backgroundColor, color: s.color}); })()"
        )
    )
    assert style["background"] == "rgba(0, 0, 0, 0)", f"关闭按钮被刷成蓝色实心方块：{style}"
    assert style["color"] != "rgb(255, 255, 255)", f"关闭按钮文字被刷成白色：{style}"


def test_remember_uses_the_value_the_user_actually_typed(page_client):
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "(() => { const el = document.querySelector('#deep-name'); el.value = '用户自己填的';"
        " el.dispatchEvent(new Event('input', {bubbles: true})); })()"
    )
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    remember = page_client.evaluate("window.__rfRemember")
    assert remember["value"] == "用户自己填的"


def test_switching_fields_clears_a_stale_remember(page_client):
    """换到别的框时，上一条「记住」必须清掉。

    不清的话，Python 那边下一轮读到它，会把**上一个框的值**记到**当前框的名字**下面——
    存进去的是一条名不副实的资料，而且没有任何报错。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.remember').click()"))
    assert page_client.evaluate("window.__rfRemember") is not None

    _focus(page_client, "#ac-tel")

    assert page_client.evaluate("window.__rfRemember") is None


def test_uninstall_clears_the_remember_intent(page_client):
    """停用要把它一起抹掉——与 ``__rfAccept`` 同样属于"用户资料"的一部分。"""
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    page_client.evaluate("window.__rfUninstall()")

    assert page_client.evaluate("window.__rfRemember") is None


# ===== 「记住这条」的编辑器：落点只有「网申资料」 =====
#
# ⚠️ 上面那几条点 ``.remember`` 的用例**没有装编辑器**（只装了焦点监听），所以点下去走的是
# 监听脚本里那个"直接设 ``__rfRemember``"的处理器。生产环境里编辑器是装着的，点击是
# **打开编辑器**——列表里渲染了什么，只有下面这两条验证得到。


# 落点**只有「网申资料」**：以前这类列表里还有 ``profile:name``、``educations:1:school``，
# 也就是按一下就能改简历资料——而简历是要投出去的。2026-09-28 收掉了
# （理由见 ``services/webform/profile_targets.py`` 的模块说明）。
EDITOR_TARGETS = [
    {
        "target_id": "extra:height",
        "source": "extra",
        "group": "身体情况",
        "label": "身高(cm)",
        "value": "178",
        "kind": "text",
        "field_key": "height",
    },
]


def test_the_remember_editor_lists_exactly_the_targets_it_was_given(page_client):
    """编辑器装得上、渲染得出来，且画出来的就是**后端给的那份列表**。

    真机验证在这里尤其值：这一屏是注入脚本渲染的，离线测试只能断言"脚本里有某个标记"。

    **真正的边界不在这一层**——脚本只是把后端给的列表画出来，"落点只有网申资料"由
    ``services/webform/profile_targets.py`` 结构性保证（后端测试从服务层和接口层各钉了一条，
    接口那边还有 ``Literal["extra"]`` 兜着）。这里守的是另外两件事：编辑器本身没坏，
    以及它**不会自己造出一个候选**——那正是"界面上藏起来"与"结构上做不到"的差别。
    """
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    text = page_client.evaluate(_shadow("querySelector('.rf-memory').textContent"))
    assert "网申资料" in text, f"编辑器没渲染出来：{text!r}"
    assert "身体情况" in text, f"目标分组没列出来：{text!r}"
    # 默认只展开「自定义」；已有网申字段先折叠，避免一打开就把屏幕撑满。
    assert page_client.evaluate(_shadow("querySelectorAll('.rf-memory-row').length")) == 1, (
        f"编辑器默认展开了过多候选：{text!r}"
    )
    assert page_client.evaluate(
        _shadow("querySelector(\".rf-memory-group[aria-expanded='false']\") !== null")
    ) is True
    # 简历资料的落点不该出现。
    assert "我的资料" not in text, f"编辑器里出现了简历资料：{text!r}"
    # 打开编辑器只是"准备保存"，页面上那个框仍然没被写。
    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""


def test_the_remember_editor_records_the_chosen_target_without_writing_the_page(page_client):
    """点「保存这条」才设置 ``__rfRemember``，并带上用户选中的 target_id。"""
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    page_client.evaluate(_shadow("querySelector('.remember').click()"))
    page_client.evaluate(
        _shadow("querySelectorAll('.rf-memory-group')[1].click()")
    )
    rows = _shadow("querySelectorAll('.rf-memory-row')")
    page_client.evaluate(f"[...{rows}].find((r) => r.textContent.includes('身高')).click()")
    page_client.evaluate(_shadow("querySelector('.rf-memory-save').click()"))

    remember = page_client.evaluate("window.__rfRemember")
    assert isinstance(remember, dict), "「保存这条」没把意图记下来"
    assert remember["target_id"] == "extra:height"
    assert remember["value"] == "张三"
    # 依旧只是"记下意图"：页面上那个框没被写，「填入」那一路也没被碰。
    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""
    assert page_client.evaluate("window.__rfAccept") is None


def test_remember_editor_uses_the_real_form_label_before_the_placeholder(page_client):
    """通用提示语不能直接变成字段名；没有真实 label 时要清理出字段语义。"""
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfFocus = Object.assign({}, window.__rfFocus, {"
        "label: '', aria_label: '', aria_labelledby: '', legend: '', title: '', name: '',"
        "placeholder: '如有内推串码可在此填写',"
        "nearby_text: '内推串码* 如有内推串码可在此填写'});"
    )
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: 'AI 错认字段', value: '345354543'})"
    )
    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    label = page_client.evaluate(_shadow("querySelector('.rf-memory-label-input').value"))
    assert label == "内推串码", label


def test_remember_editor_switches_views_instead_of_stacking_on_the_picker(page_client):
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    assert page_client.evaluate(_shadow("querySelector('.pick').classList.contains('on')")) is True

    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    state = page_client.evaluate(
        "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
        " return {editor: getComputedStyle(r.querySelector('.rf-memory')).display,"
        " pick: getComputedStyle(r.querySelector('.pick')).display,"
        " more: getComputedStyle(r.querySelector('.more')).display,"
        " groupPosition: getComputedStyle(r.querySelector('.rf-memory-group')).position}; })()"
    )
    assert state == {
        "editor": "block",
        "pick": "none",
        "more": "none",
        "groupPosition": "relative",
    }, state

    page_client.evaluate(_shadow("querySelector('.rf-memory-cancel').click()"))
    assert page_client.evaluate(_shadow("querySelector('.pick').classList.contains('on')")) is True


def test_the_remember_editor_initializes_the_value_input_from_the_panel(page_client):
    """「字段内容」打开时默认带上取值链的结果（表单敲的字 > 面板建议 > 控件现值）。

    修的是"字段内容不可编辑"：既然可编辑，就得先有内容可改，且默认与用户在表单里
    填的一致。
    """
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    value = page_client.evaluate(_shadow("querySelector('.rf-memory-value-input').value"))
    assert value == "张三", f"字段内容没有按面板建议初始化：{value!r}"


def test_the_remember_editor_saves_the_value_the_user_edited(page_client):
    """用户改过「字段内容」后，保存的是**编辑器里的值**，不是保存时回头读的表单现值。"""
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    page_client.evaluate(_shadow("querySelector('.remember').click()"))
    page_client.evaluate(
        "(() => { const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " root.querySelector('.rf-memory-value-input').value = '编辑后的内容'; })()"
    )

    page_client.evaluate(_shadow("querySelector('.rf-memory-save').click()"))

    remember = page_client.evaluate("window.__rfRemember")
    assert isinstance(remember, dict), "「保存这条」没把意图记下来"
    assert remember["value"] == "编辑后的内容", remember
    # 依旧只是"记下意图"：页面上的框没被写。
    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""


def test_the_remember_editor_lets_the_user_type_the_value_into_the_editor(page_client):
    """表单框是空的、面板建议也为空时，用户可以**就地补内容**再保存。

    旧行为是保存时报"请先在目标表单里填写内容"——有了字段内容输入框，这就不再是死路。
    """
    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate("window.__rfShowPanel({status: 'unmatched', field_label: '', value: ''})")
    page_client.evaluate(_shadow("querySelector('.remember').click()"))
    page_client.evaluate(
        "(() => { const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " root.querySelector('.rf-memory-value-input').value = '就地补上的内容'; })()"
    )

    page_client.evaluate(_shadow("querySelector('.rf-memory-save').click()"))

    remember = page_client.evaluate("window.__rfRemember")
    assert isinstance(remember, dict), "就地补的内容没能保存"
    assert remember["value"] == "就地补上的内容"


def test_memory_group_headers_are_not_painted_as_selected_buttons(page_client):
    """分组头（网申资料·自定义 等）是浅色的——全局按钮规则不得把它们染成深蓝。

    根因是特异性：`button:not(.rf-live-switch)`(0,1,1) 压过裸 `.rf-memory-group`(0,1,0)。
    修法与 navchip 同一套（`button.rf-memory-group`），这条用**计算样式**钉住结果。
    """
    import json as _json

    _install_editor(page_client, EDITOR_TARGETS)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    page_client.evaluate(_shadow("querySelector('.remember').click()"))

    style = _json.loads(
        page_client.evaluate(
            "(() => { const root = document.getElementById('__rf_live_host__').shadowRoot;"
            " const s = getComputedStyle(root.querySelector('.rf-memory-group'));"
            " return JSON.stringify({background: s.backgroundColor, color: s.color}); })()"
        )
    )
    assert style["background"] != "rgb(61, 130, 189)", f"分组头被全局按钮规则染成深蓝：{style}"
    assert style["color"] != "rgb(255, 255, 255)", f"分组头文字被刷成白色：{style}"

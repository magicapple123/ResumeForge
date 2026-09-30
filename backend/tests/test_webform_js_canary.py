"""注入脚本的**真机验证**：把合成 DOM 放进真浏览器跑一遍。

## 为什么需要它

``CONTROLS_SCRIPT`` 与其它注入脚本是**字符串形式的 JS**，而离线测试用的假客户端不执行
JS——只能断言"脚本里出现了某个片段"。这条链路上已经栽过两次：

- ``select`` 用错原型（``HTMLInputElement`` 的 setter 作用在 ``<select>`` 上）会抛
  ``Illegal invocation``，而当时的测试只断言脚本里有 ``rf:set-value``；
- ``labelText`` 的向上深度写死成 5 层，腾讯/美团够用，但字节那套组件库把 input 埋在
  6 层里 —— 整个页面的标签全取不到，表现为"什么都认不出来"。

**这类错误只有真跑才会暴露**。所以这个文件把合成 DOM 送进真浏览器，断言脚本的实际输出。

## 什么时候跑

需要一个在 ``127.0.0.1:9333`` 上答话的受控浏览器（``start.cmd`` 起来、投递台或网申页
点过「启动浏览器」）。**没有就跳过**——CI 的 runner 上没有浏览器，这条在那边永远是 skip，
所以它补的是本地验证，不是 CI 门禁。

它会新开一个标签页跑完就关，不动你正在用的页面。
"""
import json
import os
import time

import pytest

from app.services.browser.cdp_client import WebsocketCdpClient

PORT = 9333

# 合成 DOM：两种真实站点的结构各一份。
# - deep：字节那套 `ud__` 组件库的形状（input 埋在 6 层里，标签在第 6 层的 form item）
# - list：美团那种"标签清单"（再上一层就变成整块表单的标签列表，必须在那儿停住）
FIXTURE = """
<!doctype html><html><body>
  <div class="form">
    <div class="ud-formily-item">
      姓名*<div><div><div><div><div>
        <input id="deep-name" type="text">
      </div></div></div></div></div>
    </div>
    <div class="label-list">
      姓名*手机号码*+86邮箱*个人证件*期望工作地点*学历*学校名称*专业*
      <div><input id="after-list" type="text"></div>
    </div>
    <input id="ac-tel" type="text" autocomplete="tel">
    <input id="ac-otp" type="text" autocomplete="one-time-code">
    <input id="ac-mixed" type="text" autocomplete="  Section-Blue  ">
    <select id="degree"><option value="">请选择</option><option value="3">本科</option></select>
    <label><input id="gender-male" type="radio" name="gender" value="male">男</label>
    <label><input id="agree" type="checkbox" name="agree">我已阅读并同意</label>
    <input id="secret" type="password" value="hunter2">
    <input id="readonly-picker" type="text" readonly value="中国大陆 / 天津 / 天津市">
    <input id="popup-input" type="text" role="combobox" aria-haspopup="listbox">
    <button id="submit-btn">提交</button>
  </div>
</body></html>
"""


def _browser_or_skip() -> WebsocketCdpClient:
    # **并行时不跑。** 这些用例共用 127.0.0.1:9333 上那**一个**浏览器，而每个用例开场都会
    # `Target.activateTarget` 把自己的标签页激活——并行的另一个 worker 一激活，这个标签就退到
    # 后台，而**后台标签的定时器会被 Chrome 节流到大约每分钟一次**。面板的重排跟踪正是靠
    # `setInterval`，于是"面板跟着页面重排"那条会偶发地等不到（实测在 `-n auto` 下红过，
    # 单独跑稳定通过）。
    #
    # 试过用 `xdist_group` + `--dist loadgroup` 把它们钉在同一个 worker 上串行，结果那一轮
    # 把 60 个浏览器用例全压到一个进程，**内存耗尽**（pytest 格式化失败报告时 `MemoryError`，
    # 连汇总行都没打出来）。换调度模式去迁就一个本地检查，代价大于收益。
    #
    # 所以就照它本来的定位办：**本地单独跑这个文件**（CI 上本来也永远是 skip）。
    os.environ.get("PYTEST_XDIST_WORKER") and pytest.skip(
        "真机 canary 共用同一个浏览器，并行会互相抢标签页——请单独跑 tests/test_webform_js_canary.py"
    )
    client = WebsocketCdpClient(port=PORT)
    try:
        client.list_targets()
    except Exception:  # noqa: BLE001 - 连不上就跳过
        client.close()
        pytest.skip("本机没有受控浏览器（127.0.0.1:9333），跳过 JS 真机验证")
    return client


@pytest.fixture
def page_client():
    """新开一个标签页跑合成 DOM，用完关掉——不动用户正在看的页面。"""
    client = _browser_or_skip()
    target_id = client.new_tab("about:blank")
    try:
        # **必须先激活这个标签页**：后台标签里 `el.focus()` 不会派发真实的 focus 事件，
        # 而"点哪个填哪个"整套逻辑就挂在 focusin 上——不激活的话测出来的全是假阴性。
        client.send("Target.activateTarget", {"targetId": target_id})
        client.navigate(f"data:text/html;charset=utf-8,{_urlencode(FIXTURE)}")
        yield client
    finally:
        try:
            client.send("Target.closeTarget", {"targetId": target_id})
        except Exception:  # noqa: BLE001 - 关不掉不该让测试失败
            pass
        client.close()


def _urlencode(text: str) -> str:
    from urllib.parse import quote

    return quote(text, safe="")


def _snapshot(client) -> list[dict]:
    from app.services.webform.engine import CONTROLS_SCRIPT

    payload = client.evaluate(CONTROLS_SCRIPT)
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload["controls"]


def _by_selector(controls: list[dict], selector: str) -> dict | None:
    return next((c for c in controls if c.get("selector") == selector), None)


def _index_of(controls: list[dict], selector: str) -> int | None:
    control = _by_selector(controls, selector)
    return control["index"] if control else None


def test_the_snapshot_script_can_run_twice_on_the_same_page(page_client):
    """**回归守卫**：脚本必须能在一个页面上重复执行。

    ``Runtime.evaluate`` 在**全局作用域**求值，所以 helpers 里那些 ``const`` 一旦落在
    IIFE 外面就成了全局声明——第一次执行没事，第二次抛
    ``SyntaxError: Identifier 'visible' has already been declared``。用户那边表现为
    「读取当前表单」点第二次就失败。这个坑是端到端跑真页面时抓到的。
    """
    from app.services.webform.engine import CONTROLS_SCRIPT

    first = page_client.evaluate(CONTROLS_SCRIPT)
    second = page_client.evaluate(CONTROLS_SCRIPT)  # 不应抛异常

    assert "controls" in json.loads(first)
    assert "controls" in json.loads(second)


def test_the_listener_can_be_installed_again_after_being_removed(page_client):
    """同一个道理，监听脚本也要能反复装。"""
    _install(page_client)
    page_client.evaluate("window.__rfUninstall()")
    _install(page_client)

    assert page_client.evaluate("window.__rfInstalled === true") is True
    page_client.evaluate("window.__rfUninstall()")


def test_the_label_is_found_through_six_wrapper_levels(page_client):
    """**字节那个回归的守卫**：标签在往上第 6 层，深度写死成 5 就取不到。"""
    controls = _snapshot(page_client)
    index = _index_of(controls, '[data-rf-index="0"]')
    assert index is not None, "合成页面上没读到控件"

    # 第一个 input 就是深嵌套那个。
    first = next(c for c in controls if c["index"] == 0)
    assert "姓名" in first["nearby_text"], f"没穿过深层包装拿到标签：{first['nearby_text']!r}"


def test_the_label_list_is_not_swallowed(page_client):
    """**美团那个回归的守卫**：标签清单那一层必须停住，否则每个字段都"匹配得上"任何控件。

    合成页里第二个 input 就住在标签清单内部——它往上第一层是空的包装 div，再往上就是
    「姓名*手机号码*+86邮箱*…」那一串。正确行为是**在那儿停住**，一个字段的标签都不收。
    """
    controls = _snapshot(page_client)
    second = next((c for c in controls if c["index"] == 1), None)
    assert second is not None, "合成页面上没读到第二个控件"

    nearby = second["nearby_text"]
    assert "学校名称" not in nearby, f"把整块表单的标签清单收进来了：{nearby!r}"
    assert nearby.count("*") < 3, f"标签清单没被拦住：{nearby!r}"


def test_the_snapshot_never_exposes_a_password_or_a_submit_button(page_client):
    """密码框连值都不该读进来；提交类控件永远不该被打上定位符。"""
    controls = _snapshot(page_client)
    blob = json.dumps(controls, ensure_ascii=False)

    assert "hunter2" not in blob, "密码的值被读进了快照"
    assert "提交" not in blob, "提交按钮进了控件清单"


def test_a_readonly_or_popup_control_is_captured_as_such(page_client):
    """只读框与"点开是弹层"的框要采回来——级联选择器就是这个形状。

    不采的话，那种框看起来就是个普通 input，程序会往里写一个值：**框里出现了一行字、
    看着像填上了，而组件内部状态一点没变**，表单交上去还是空的。那比"没填"更糟。

    真机验证在这里是必须的：这两个字段是 `describeControl` **现场读 DOM 属性**得来的，
    离线测试只能断言"脚本里有这个 key"，读没读到、读对没有它管不着。
    """
    controls = _snapshot(page_client)
    # 按内容找而不是按序号：序号是 DOM 顺序，前面增删一个控件就会错位。
    readonly = next((c for c in controls if "天津" in (c.get("value") or "")), None)
    popup = next((c for c in controls if c.get("has_popup")), None)
    plain = next((c for c in controls if c.get("id") == "deep-name"), None)

    assert readonly is not None, "只读输入框没进快照"
    assert readonly["readonly"] is True, readonly
    # 只读框的现有值照常读得到（用于冲突判断）。
    assert "中国大陆" in readonly["value"]

    assert popup is not None, "带弹层的输入框没进快照"
    assert popup["readonly"] is False

    # 普通输入框不该被误标——误标会让它永远填不进去。
    assert plain is not None, "合成页面上的普通输入框没进快照"
    assert plain["readonly"] is False and plain["has_popup"] is False, plain


def test_autocomplete_is_captured_and_normalized(page_client):
    """`autocomplete` 是唯一不需要猜的信号，采回来时必须**规整过**——
    大小写、前后空格、以及 `section-*`/`shipping` 这类前缀在规范里都是合法写法。"""
    controls = _snapshot(page_client)
    values = [control.get("autocomplete") for control in controls]
    assert "tel" in values, f"没采到 autocomplete：{values}"
    assert "one-time-code" in values
    # 大小写与空格都要归一
    assert "section-blue" in values, f"没有归一化：{values}"
    assert all(value == (value or "").strip().lower() for value in values)


def test_snapshot_extracts_repeated_block_context_and_date_order(page_client):
    page_client.evaluate(
        """document.body.insertAdjacentHTML('beforeend', `
          <div class="info_list">
            <div>实习经历-2</div>
            <input id="intern-company-2" placeholder="请输入实习公司">
            <div class="dates">
              <input id="intern-start-2" placeholder="选择日期">
              <input id="intern-end-2" placeholder="选择日期">
            </div>
          </div>`);"""
    )
    controls = _snapshot(page_client)
    company = next(c for c in controls if c.get("id") == "intern-company-2")
    start = next(c for c in controls if c.get("id") == "intern-start-2")
    end = next(c for c in controls if c.get("id") == "intern-end-2")

    assert company["block_family"] == "experience"
    assert company["block_index"] == 2
    assert "实习经历-2" in company["block_label"]
    assert start["date_order"] == 1
    assert end["date_order"] == 2


def test_snapshot_keeps_three_realistic_experience_ordinals_separate(page_client):
    """腾讯页面的三个同形实习区块不能共享同一个序号。"""
    page_client.evaluate(
        """document.body.insertAdjacentHTML('beforeend',
          '<div class="info_list"><div>实习经历-1</div><input id="ordinal-company-1" placeholder="请输入实习公司"></div>' +
          '<div class="info_list"><div>实习经历-2</div><input id="ordinal-company-2" placeholder="请输入实习公司"></div>' +
          '<div class="info_list"><div>实习经历-3</div><input id="ordinal-company-3" placeholder="请输入实习公司"></div>');"""
    )
    controls = _snapshot(page_client)

    ordinals = {
        c["id"]: (c["block_family"], c["block_index"], c["block_label"])
        for c in controls
        if c.get("id", "").startswith("ordinal-company-")
    }

    assert ordinals["ordinal-company-1"] == ("experience", 1, "实习经历-1")
    assert ordinals["ordinal-company-2"] == ("experience", 2, "实习经历-2")
    assert ordinals["ordinal-company-3"] == ("experience", 3, "实习经历-3")


# ===== 「点哪个填哪个」的监听与面板 =====


def _install(page_client) -> None:
    from app.services.webform.engine import FOCUS_LISTENER_SCRIPT

    page_client.evaluate(FOCUS_LISTENER_SCRIPT)


def _focus(page_client, selector: str) -> None:
    """聚焦并**显式派发 focusin**。

    为什么要手动派发：Chrome 在**窗口没有系统焦点**时不派发 focus/blur 事件（跑测试时
    焦点在你编辑器上，不在浏览器上）。此时 ``document.activeElement`` 会照常更新，但
    ``focusin`` 一次都不来——于是断言会因为环境而假阴。

    所以这里聚焦（把 activeElement 设对）之后，再补一次真实形状的事件：处理器收到的
    东西与真点时完全一样，**被测的是我们的逻辑，不是浏览器的焦点派发**。
    """
    page_client.evaluate(f"document.querySelector('{selector}').focus()")
    page_client.evaluate(
        "document.querySelector('" + selector + "')"
        ".dispatchEvent(new FocusEvent('focusin', {bubbles: true}))"
    )


def test_the_listener_installs_and_uninstalls_cleanly(page_client):
    """装在别人的页面上就必须能**完整撤掉**——不留监听、不留节点、不留全局变量。"""
    _install(page_client)
    assert page_client.evaluate("window.__rfInstalled === true") is True
    assert page_client.evaluate("!!document.getElementById('__rf_live_host__')") is True

    page_client.evaluate("window.__rfUninstall()")

    assert page_client.evaluate("window.__rfInstalled === false") is True
    assert page_client.evaluate("!!document.getElementById('__rf_live_host__')") is False
    assert page_client.evaluate("typeof window.__rfShowPanel") == "undefined"


def test_focusing_a_field_captures_its_description(page_client):
    _install(page_client)
    _focus(page_client, "#deep-name")

    focus = page_client.evaluate("window.__rfFocus")
    assert isinstance(focus, dict), f"没捕获到焦点控件：{focus!r}"
    assert "姓名" in (focus.get("nearby_text") or ""), focus
    assert focus.get("selector") == '[data-rf-focus="1"]'


def test_a_password_field_is_never_captured(page_client):
    """密码框连描述都不生成——与快照脚本同一条纪律。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    _focus(page_client, "#secret")

    # 焦点移到密码框后，上一个描述不该被更新成密码框的内容。
    focus = page_client.evaluate("window.__rfFocus")
    assert not focus or "hunter2" not in json.dumps(focus, ensure_ascii=False)
    # 密码框自己也不该被打上标记。
    assert page_client.evaluate("!!document.querySelector('#secret[data-rf-focus]')") is False


def test_the_panel_renders_inside_a_shadow_root(page_client):
    """面板必须活在 shadow DOM 里——否则站点的全局样式能把它搞变形。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    host = page_client.evaluate("!!document.getElementById('__rf_live_host__')")
    assert host is True
    text = page_client.evaluate(
        "document.getElementById('__rf_live_host__').shadowRoot.textContent"
    )
    assert "姓名" in text and "张三" in text and "填入" in text


def test_the_fill_button_only_records_the_click_never_writes(page_client):
    """按钮只把"用户点了填入"记下来；真正的写入在 Python 侧——
    这样写入、回读校验、失败上报都只有一份实现。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    shadow = "document.getElementById('__rf_live_host__').shadowRoot"
    page_client.evaluate(f"{shadow}.querySelector('button.fill').click()")

    accept = page_client.evaluate("window.__rfAccept")
    assert isinstance(accept, dict) and accept.get("value") == "张三"
    # 页面上那个框本身**没有被写**。
    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""


CATALOG = [
    {"group": "身份信息", "label": "姓名", "value": "张三"},
    {"group": "联系方式", "label": "手机号", "value": "13800000000"},
    {"group": "教育经历 1", "label": "学校", "value": "天津工业大学"},
    {"group": "教育经历 1", "label": "专业", "value": "软件工程"},
]

COLOR_CATALOG = CATALOG + [
    {"group": "实习经历 2", "label": "公司", "value": "星河科技"},
    {"group": "实习经历 2", "label": "职位", "value": "产品实习生"},
]


def _open_panel(page_client, catalog=CATALOG) -> None:
    """装监听、推清单、聚焦一个框——把面板带到"推荐已给出"的状态。"""
    page_client.evaluate(f"window.__rfCatalog = {json.dumps(catalog, ensure_ascii=False)}")
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )


def _shadow(js: str) -> str:
    body = js
    for name in ("querySelectorAll", "querySelector"):
        body = body.replace(f"{name}(", f"root.{name}(")
    if body == "textContent":
        body = "root.textContent"
    return f"(() => {{ const root = document.getElementById('__rf_live_host__').shadowRoot; return {body}; }})()"


def test_the_picker_is_collapsed_until_asked_for(page_client):
    _open_panel(page_client)

    assert page_client.evaluate(_shadow("querySelector('.pick').classList.contains('on')")) is False
    assert page_client.evaluate(_shadow("querySelector('.more').textContent")) == "换个资料…"


def test_expanding_lists_every_field_grouped_by_section(page_client):
    """**这是"让人自己挑"的核心**：清单必须逐条列出全部资料，而不是只给推荐那一条。

    尤其要看得到同一条目的的多个值（比如两段实习）——那正是"多段经历只填第一条"
    这个限制被绕开的地方。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))

    text = page_client.evaluate(_shadow("querySelector('.list').textContent"))
    assert "身份信息" in text and "教育经历 1" in text
    for label in ("姓名", "手机号", "学校", "专业"):
        assert label in text, f"清单里少了 {label}"
    assert "张三" in text and "天津工业大学" in text


def test_the_search_box_filters_by_label_value_or_group(page_client):
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    page_client.evaluate(_shadow("querySelector('.search input').value = '手机'"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))

    text = page_client.evaluate(_shadow("querySelector('.list').textContent"))
    assert "手机号" in text
    assert "学校" not in text and "专业" not in text

    # 按值也能搜
    page_client.evaluate(_shadow("querySelector('.search input').value = '天津'"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))
    assert "学校" in page_client.evaluate(_shadow("querySelector('.list').textContent"))


def test_clicking_a_row_picks_that_exact_value(page_client):
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    rows = _shadow("querySelectorAll('.row')")
    page_client.evaluate(f"[...{rows}].find((r) => r.textContent.includes('学校')).click()")

    accept = page_client.evaluate("window.__rfAccept")
    assert accept["label"] == "学校"
    assert accept["value"] == "天津工业大学"
    # **控件描述随选择一起带上**：点面板会让页面输入框失焦，Python 那边不能指望
    # `window.__rfFocus` 还活着（实测过"挑了一条却写入失败"）。
    assert accept["control"]["selector"] == '[data-rf-focus="1"]'
    # 依旧只是"记下选择"，页面上那个框没有被写。
    assert page_client.evaluate("document.querySelector('#deep-name').value") == ""


def test_clicking_a_row_keeps_the_panel_and_the_target_alive(page_client):
    """**回归守卫**：鼠标按在面板上时不该收起面板，也不该把"当前是哪个框"弄丢。

    否则用户挑了一条资料，写入却找不到目标——这正是真机验证时抓到的失败。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    # mousedown 先于 blur/focusout 发生
    page_client.evaluate(_shadow("querySelector('.row').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))"))
    page_client.evaluate("document.querySelector('#ac-tel').focus()")
    page_client.evaluate(_shadow("querySelector('.row').dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))"))

    # 面板是**竖排 flex**：资料区因此拿的是"面板上限减去上面几块"，而不是自己写死一个
    # max-height——两处各写一个的话窗口偏矮时资料区底部会被面板裁掉。
    assert page_client.evaluate(_shadow("querySelector('.p').style.display")) == "flex"


def test_the_expanded_state_survives_moving_to_another_field(page_client):
    """连着几个框都想自己挑时，不该每次再点一下「换个资料…」。"""
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    assert page_client.evaluate(_shadow("querySelector('.pick').classList.contains('on')")) is True

    # 换到另一个框（模拟用户点了别的输入框）
    _focus(page_client, "#ac-tel")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'blocked', field_label: '', value: '', note: '不会自动填'})"
    )

    assert page_client.evaluate(_shadow("querySelector('.pick').classList.contains('on')")) is True
    # 但搜索词要清掉——搜过"手机"之后切到别的框，还显示滤过的列表会让人困惑。
    assert page_client.evaluate(_shadow("querySelector('.search input').value")) == ""


def test_an_empty_catalog_says_so_instead_of_showing_nothing(page_client):
    _open_panel(page_client, catalog=[])
    page_client.evaluate(_shadow("querySelector('.more').click()"))

    assert "我的资料" in page_client.evaluate(_shadow("querySelector('.list').textContent"))


def test_uninstall_takes_the_catalog_with_it(page_client):
    """清单是用户的资料——停用时必须一起从页面上抹掉，不能留在别人的页面里。"""
    _open_panel(page_client)
    page_client.evaluate("window.__rfUninstall()")

    assert page_client.evaluate("window.__rfCatalog == null") is True


def test_focusing_the_panels_own_search_box_does_not_steal_the_target(page_client):
    """**回归守卫**：面板自己获得焦点时不能把"当前是哪个框"换掉。

    事件从 shadow DOM 里出来时 `event.target` 被重定向成宿主 div。不拦的话，用户一点
    搜索框，我们就把那个 div 当成了他聚焦的控件——页面输入框的标记被清掉、写入标记打在
    div 上，最后对着 `<div>` 调 `HTMLInputElement` 的 setter 抛 Illegal invocation。
    真机上的表现是"挑了一条资料却写入失败"。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    page_client.evaluate(_shadow("querySelector('.search input').focus()"))

    # 焦点标记仍然在页面那个输入框上，没有被搬到宿主 div。
    assert page_client.evaluate("!!document.querySelector('#deep-name[data-rf-focus]')") is True
    assert page_client.evaluate("!!document.querySelector('#__rf_live_host__[data-rf-focus]')") is False


def test_picking_a_row_marks_the_page_field_not_the_panel(page_client):
    """挑完之后，写入标记必须落在**页面那个框**上。"""
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    page_client.evaluate(_shadow("querySelector('.row').click()"))

    accept = page_client.evaluate("window.__rfAccept")
    assert accept["selector"] == '[data-rf-target="1"]'
    assert page_client.evaluate("!!document.querySelector('#deep-name[data-rf-target]')") is True
    assert page_client.evaluate("!!document.querySelector('#__rf_live_host__[data-rf-target]')") is False


def test_picking_a_row_works_even_after_the_page_field_lost_focus(page_client):
    """**回归守卫**：页面输入框已经失焦时挑一条，选择不能被吞掉。

    起因是 `accept()` 里先回焦、再设 `__rfAccept`——而回焦会触发 onFocus，那里会把
    `__rfAccept` 清成 null（"用户换了个框"的正常语义），等于把刚记下的选择抹掉。
    真机上表现为：推荐那条能填（框本来就聚焦着、不触发 focusin），从清单里挑的却石沉大海。
    """
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    # 焦点被面板的搜索框拿走——此时页面那个框已经失焦
    page_client.evaluate(_shadow("querySelector('.search input').focus()"))
    page_client.evaluate(_shadow("querySelector('.row').click()"))

    accept = page_client.evaluate("window.__rfAccept")
    assert accept, "选择被吞掉了"
    assert accept["value"] == "张三"
    assert accept["selector"] == '[data-rf-target="1"]'


def test_select_options_carry_both_value_and_text(page_client):
    """``<option value="3">本科</option>``：只拿文本回填不了，value 必须一起采回来。"""
    controls = _snapshot(page_client)
    select = next((c for c in controls if c.get("type") == "select"), None)
    assert select is not None, "合成页面上没有 select"
    assert select["options"] == [
        {"v": "", "t": "请选择", "d": False},
        {"v": "3", "t": "本科", "d": False},
    ]


# ===== AI 候选、来源标记与面板定位 =====


def _box(selector: str) -> str:
    """面板与输入框各自的矩形，外加视口尺寸——定位断言全靠它。"""
    return (
        "(() => {"
        " const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " const p = root.querySelector('.p').getBoundingClientRect();"
        f" const f = document.querySelector('{selector}').getBoundingClientRect();"
        " const box = (r) => ({left: r.left, top: r.top, right: r.right, bottom: r.bottom,"
        "                      width: r.width, height: r.height});"
        " return {panel: box(p), field: box(f),"
        "         view: {w: window.innerWidth, h: window.innerHeight}};"
        "})()"
    )


def _overlaps(panel: dict, field: dict) -> bool:
    return not (
        panel["right"] <= field["left"]
        or panel["left"] >= field["right"]
        or panel["bottom"] <= field["top"]
        or panel["top"] >= field["bottom"]
    )


def _distance(panel: dict, field: dict) -> int:
    """两个矩形之间的间距；<= 0 表示有重叠。"""
    return max(
        max(field["left"] - panel["right"], panel["left"] - field["right"]),
        max(field["top"] - panel["bottom"], panel["top"] - field["bottom"]),
    )


def test_the_panel_opens_right_next_to_the_field_it_belongs_to(page_client):
    """**按钮要离输入框最近**——这是这个模式存在的理由，不是装饰。

    「填入」在面板里，所以"离得近"就是"面板贴着那个框"。定位靠
    ``getBoundingClientRect()``，这条用例把结果钉住：既不重叠、也不跑远。
    """
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    box = page_client.evaluate(_box("#deep-name"))
    assert not _overlaps(box["panel"], box["field"]), f"面板盖住了输入框：{box}"
    assert _distance(box["panel"], box["field"]) <= 24, f"面板离输入框太远：{box}"


def test_the_panel_is_fully_inside_the_viewport(page_client):
    """贴边时不能跑到屏幕外面去——那样按钮就点不到了。"""
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )

    box = page_client.evaluate(_box("#deep-name"))
    panel, view = box["panel"], box["view"]
    assert panel["left"] >= 0 and panel["top"] >= 0
    assert panel["right"] <= view["w"] and panel["bottom"] <= view["h"]


def test_the_panel_follows_a_layout_shift_without_any_scroll(page_client):
    """**页面自己会动，而 scroll / resize 一个都不会触发。**

    级联下拉选了国家才加载省份、校验错误提示插在字段上方——输入框位置变了，页面既没滚
    也没缩。只挂 scroll/resize 的话面板会停在陈旧的坐标上，而那看起来就是"按钮跑偏了"。
    """
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    before = page_client.evaluate(_box("#deep-name"))["panel"]["top"]

    # 在字段上方插一大块内容（正是"联动加载出新内容"造成的效果）。
    page_client.evaluate(
        "(() => { const d = document.createElement('div'); d.style.height = '140px';"
        " document.querySelector('.form').prepend(d); })()"
    )
    time.sleep(0.5)  # 重排跟踪是 200ms 对一次坐标

    after = page_client.evaluate(_box("#deep-name"))["panel"]["top"]
    assert after - before >= 120, f"面板没跟上页面重排：{before} → {after}"


DRAG_DELTA = 40


def _offset_after_switching_field(page_client, delta: int) -> dict:
    """装面板 → 聚焦第一个框 → 可选拖 delta 像素 → 换第二个框 → 量面板落点。

    每次都从干净状态开始（拖完卸载），否则上一次的拖动偏移会串到下一次。
    """
    _install(page_client)
    _focus(page_client, "#deep-name")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '姓名', value: '张三'})"
    )
    if delta:
        page_client.evaluate(
            "(() => {"
            " const root = document.getElementById('__rf_live_host__').shadowRoot;"
            " const panel = root.querySelector('.p');"
            " const r = panel.getBoundingClientRect();"
            " const x = r.left + 12; const y = r.top + 6;"
            " panel.dispatchEvent(new MouseEvent('mousedown',"
            "   {bubbles: true, button: 0, clientX: x, clientY: y}));"
            " window.dispatchEvent(new MouseEvent('mousemove',"
            f"   {{bubbles: true, clientX: x, clientY: y + {delta}}}));"
            " window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));"
            "})()"
        )
    # 换一个框，像 Python 侧那样重新推一次面板。
    _focus(page_client, "#ac-tel")
    page_client.evaluate(
        "window.__rfShowPanel({status: 'matched', field_label: '手机号', value: '13500000000'})"
    )
    box = page_client.evaluate(_box("#ac-tel"))
    page_client.evaluate("window.__rfUninstall()")
    return box


def test_a_dragged_panel_still_follows_the_next_field(page_client):
    """拖动记的是**相对输入框的偏移**，不是绝对坐标。

    这样"挪开一点别挡着"和"换个框还贴着"能同时成立。记绝对坐标的话，拖过一次之后就再也
    不跟了——而那恰恰是这个功能的意义。

    断言写成**拖动前后两次的差值**，而不是"面板一定在输入框右边"：面板 620px 宽、视口只有
    762px 时右边根本放不下，`targetPosition` 会按设计退到输入框下方（那条分支本来就是为了
    "左右都放不下"写的）。所以这里只钉两件真事——不盖住那个框，以及拖动量原样保留。
    """
    plain = _offset_after_switching_field(page_client, 0)
    dragged = _offset_after_switching_field(page_client, DRAG_DELTA)

    assert not _overlaps(dragged["panel"], dragged["field"]), f"拖过之后盖住了输入框：{dragged}"
    moved = (
        dragged["panel"]["top"] - dragged["field"]["top"]
    ) - (
        plain["panel"]["top"] - plain["field"]["top"]
    )
    assert abs(moved - DRAG_DELTA) <= 6, f"相对偏移没保留下来：{moved}（期望 {DRAG_DELTA}）"


def test_the_reflow_timer_is_stopped_on_uninstall(page_client):
    """卸载要**连定时器一起停**，否则反复启停会攒下一堆永远在跑的定时器。"""
    _install(page_client)

    cleared = page_client.evaluate(
        "(() => { window.__rfCleared = [];"
        " const real = window.clearInterval.bind(window);"
        " window.clearInterval = (id) => { window.__rfCleared.push(id); return real(id); };"
        " window.__rfUninstall();"
        " return window.__rfCleared.length; })()"
    )

    assert cleared >= 1, "卸载时没有停掉重排跟踪的定时器"


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


def _install_editor(page_client, targets: list[dict]) -> None:
    """装焦点监听 + 记忆编辑器，并把目标推进页面（顺序与 ``LiveSession._attach`` 一致）。"""
    from app.services.webform.live_memory_panel import (
        REMEMBER_EDITOR_SCRIPT,
        memory_targets_script,
    )

    _install(page_client)
    page_client.evaluate(memory_targets_script(targets))
    page_client.evaluate(REMEMBER_EDITOR_SCRIPT)


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


# ===== 「换个资料…」那一屏：分组跳转 / 折叠 / 命中数 / 截断 =====
#
# 起因是用户的反馈：内容一多就只能在面板里上下滚着翻找；单条字段名过长时会把整行
# 撑乱。改法是给三样东西——顶部的分组跳转条、每组可折叠、搜索时给出命中数。
#
# 面板最宽 620px（`.p{width:min(620px,calc(100vw - 16px))}`），装不下左侧栏，
# 所以跳转条是**横着排在搜索框下面**的，不是 Codex 计划里写的左侧目录。
#
# 同样是真机验证：这一屏是注入脚本现场渲染的，离线测试只能断言"脚本里有某个标记"。

_ROOT = "document.getElementById('__rf_live_host__').shadowRoot"


def _rows_matching(text: str) -> str:
    return f"[...{_ROOT}.querySelectorAll('.row')].find((r) => r.title.includes('{text}'))"


def _chip(group: str) -> str:
    """按 `dataset.group`（**精确的组名**）定位跳转按钮。

    不按 `textContent` 找：条数现在是一个独立的胶囊元素，拼起来会变成「专业技能 1」+「2」
    =「专业技能12」——那正是这次要修掉的歧义，测试没有理由再依赖那种拼法。
    """
    return (
        f"[...{_ROOT}.querySelectorAll('.navchip')]"
        f".find((c) => c.dataset.group === '{group}')"
    )


def _unfold_nav(page_client) -> None:
    """把「分组快速定位」摊开。

    分组多（家族超过 12 个）时它默认是折起来的——那正是"跳转条不该先占掉半屏"的默认值。
    折叠头是真按钮，所以点它一次就摊开；已经摊开时什么都不做。
    """
    if page_client.evaluate(_shadow("querySelector('.nav').classList.contains('fold')")):
        page_client.evaluate(_shadow("querySelector('.navhead').click()"))


def _open_picker(page_client, catalog=None) -> None:
    """装面板 → 展开「换个资料…」→ 摊开跳转条（后面按胶囊定位的用例都从这里开始）。"""
    _open_panel(page_client, catalog or CATALOG)
    page_client.evaluate(_shadow("querySelector('.more').click()"))
    _unfold_nav(page_client)


def test_the_picker_lists_a_jump_chip_per_group_with_its_count(page_client):
    """**这是"找不到"的直接解药**：每个分组一个按钮，带条数，一键跳过去。

    **名字与条数是两个分开的元素**——拼在一起（「专业技能 1 2」）会被读成「专业技能12」，
    而分组名以数字结尾是常态「专业技能 1」「教育经历 1」「实习/工作 2」。这里断言的是
    **分离性**，不是某个具体拼法。
    """
    _open_picker(page_client)

    chips = page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.navchip')].map((c) => "
        "({ name: c.firstChild.textContent, count: c.querySelector('.c').textContent,"
        "   group: c.dataset.group }))"
    )
    assert chips == [
        {"name": "身份信息", "count": "1", "group": "身份信息"},
        {"name": "联系方式", "count": "1", "group": "联系方式"},
        {"name": "教育经历 1", "count": "2", "group": "教育经历 1"},
    ], chips
    assert page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.navchip')].every((c) => c.firstChild.className === 'nm')"
    ) is True
    assert page_client.evaluate(_shadow("querySelector('.nav').getAttribute('role')")) == "group"
    # 条数**不在名字里**，这才是不产生歧义的原因。
    assert all(not c["name"].endswith(c["count"]) or not c["name"][:-1].endswith(" " + c["count"])
               for c in chips)


def test_group_headers_and_jump_chips_keep_stable_color_tones(page_client):
    _open_picker(page_client, catalog=COLOR_CATALOG)

    tones = page_client.evaluate(
        f"({{headers: [...{_ROOT}.querySelectorAll('.grp')].map((el) => el.dataset.tone),"
        f"chips: [...{_ROOT}.querySelectorAll('.navchip')].map((el) => el.dataset.tone),"
        f"rows: [...{_ROOT}.querySelectorAll('.row')].map((el) => "
        "({group: el.dataset.group, tone: el.dataset.tone}))})"
    )
    assert tones["headers"] == ["0", "0", "1", "2"], tones
    assert tones["headers"] == tones["chips"], tones
    assert all(
        row["tone"] == {"教育经历 1": "1", "实习经历 2": "2"}.get(row["group"], "0")
        for row in tones["rows"]
    ), tones
    colors = page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.grp')].map((el) => "
        "getComputedStyle(el).getPropertyValue('--grp-text').trim())"
    )
    assert colors[0] == colors[1] == "#2e6da4", colors
    assert colors[2] != colors[0] and colors[3] != colors[0] and colors[2] != colors[3], colors

    first_group = f"[...{_ROOT}.querySelectorAll('.grp')][0]"
    page_client.evaluate(f"{first_group}.click()")
    after_toggle = page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.grp')].map((el) => el.dataset.tone)"
    )
    assert after_toggle == tones["headers"]

    page_client.evaluate(_shadow("querySelector('.search input').value = '实习'"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))
    assert page_client.evaluate(
        _shadow("querySelector('.grp').dataset.tone")
    ) == "2"
    page_client.evaluate(_shadow("querySelector('.search input').value = ''"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))
    assert page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.grp')].map((el) => el.dataset.tone)"
    ) == tones["headers"]


def test_jumping_from_a_chip_expands_that_group_and_marks_the_chip(page_client):
    """跳过去必须是**看得见内容**的：折着的先展开，否则"跳过去"是一片空白。"""
    _open_picker(page_client)
    edu = f"[...{_ROOT}.querySelectorAll('.grp')].find((g) => g.textContent.includes('教育经历'))"

    page_client.evaluate(f"{edu}.click()")
    assert page_client.evaluate(f"{edu}.classList.contains('fold')") is True

    page_client.evaluate(f"{_chip('教育经历 1')}.click()")

    assert page_client.evaluate(f"{edu}.classList.contains('fold')") is False, "跳过去还是折着的"
    assert page_client.evaluate(f"{_chip('教育经历 1')}.classList.contains('on')") is True


def test_a_group_header_collapses_and_restores_its_rows(page_client):
    """每组可折叠——把不看的折起来，剩下的才好找。"""
    _open_picker(page_client)
    edu = f"[...{_ROOT}.querySelectorAll('.grp')].find((g) => g.textContent.includes('教育经历'))"
    rows = f"[...{_ROOT}.querySelectorAll('.row')].filter((r) => r.title.includes('学校') || r.title.includes('专业'))"

    assert page_client.evaluate(f"{rows}.every((r) => getComputedStyle(r).display !== 'none')") is True

    page_client.evaluate(f"{edu}.click()")

    assert page_client.evaluate(f"{rows}.every((r) => getComputedStyle(r).display === 'none')") is True

    page_client.evaluate(f"{edu}.click()")

    assert page_client.evaluate(f"{rows}.every((r) => getComputedStyle(r).display !== 'none')") is True


def test_searching_reports_the_hit_count_and_puts_the_nav_away(page_client):
    """搜索时要给**命中数**：搜出"一条都没有"和"还有几十条"是两种完全不同的处境。

    同时把跳转条收起来——搜索结果本来就短，不需要跳，留着只占高度。
    """
    _open_picker(page_client)
    page_client.evaluate(_shadow("querySelector('.search input').value = '教育'"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))

    assert page_client.evaluate(_shadow("querySelector('.hits').textContent")) == "命中 2 条"
    assert page_client.evaluate(_shadow("querySelector('.nav').style.display")) == "none"


def test_a_search_that_matches_nothing_says_so_instead_of_showing_a_blank(page_client):
    """空结果要**说清楚**，不能只留一片空白让人以为坏了。"""
    _open_picker(page_client)
    page_client.evaluate(_shadow("querySelector('.search input').value = 'zzzz不存在zzzz'"))
    page_client.evaluate(_shadow("querySelector('.search input').dispatchEvent(new Event('input'))"))

    assert page_client.evaluate(_shadow("querySelector('.hits').textContent")) == "没有匹配的资料"
    empty = page_client.evaluate(_shadow("querySelector('.empty').textContent"))
    assert "没有匹配" in empty and "清空搜索" in empty, empty


LONG_LABEL = "求职意向岗位类别偏好的详细补充说明字段名称特别长"
LONG_CATALOG = [
    {"group": "身份信息", "label": LONG_LABEL, "value": "产品运营"},
    {"group": "联系方式", "label": "手机号", "value": "13800000000"},
]


def test_a_long_field_name_is_clamped_to_two_lines_and_keeps_the_full_text_in_the_title(page_client):
    """长字段名最多展示两行，完整名字仍挂在 title 上，避免把整条资料撑乱。"""
    _open_picker(page_client, catalog=LONG_CATALOG)
    row = _rows_matching("特别长")

    layout = page_client.evaluate(
        f"(() => {{ const el = {row}.querySelector('.l');"
        "const style = getComputedStyle(el);"
        "return {display: style.display, lineClamp: style.webkitLineClamp,"
        "overflow: style.overflow, height: el.getBoundingClientRect().height,"
        "lineHeight: parseFloat(style.lineHeight)}; })()"
    )
    assert layout["lineClamp"] == "2", layout
    assert layout["overflow"] == "hidden", layout
    assert layout["height"] <= layout["lineHeight"] * 2 + 1, layout
    # 完整内容仍然拿得到。
    assert page_client.evaluate(f"{row}.title.includes('{LONG_LABEL}')") is True


def test_a_web_form_field_is_marked_as_such_and_stays_visible(page_client):
    """来自「网申资料」的那条要有个标记——它不在简历里，来源不同该看得出来。

    **`display` 一起断言**，因为这条踩过坑：类名原本叫 `src`，而面板顶上那个 `.src`
    是 AI 建议徽标、基础规则是 `display:none`（等 showPanel 去点亮）。同名把这条标签
    按掉了，**没有任何报错**——测试断言"元素存在、文案对"照样全绿，只有截图看得出来。
    所以这里必须断言它**真的可见**。
    """
    catalog = CATALOG + [{"group": "网申资料", "label": "身高(cm)", "value": "178", "source": "extra"}]
    _open_picker(page_client, catalog=catalog)

    row = _rows_matching("身高")
    tag = f"{row}.querySelector('.from')"
    assert page_client.evaluate(f"!!{tag}") is True, "网申资料的标记没渲染"
    assert page_client.evaluate(f"{tag}.textContent") == "网申资料"
    assert page_client.evaluate(f"getComputedStyle({tag}).display") != "none", (
        "标记渲染了却被样式按掉了"
    )
    # 简历资料那几条不该带这个标记。
    assert page_client.evaluate(f"!!{_rows_matching('姓名')}.querySelector('.from')") is False


def test_every_row_offers_an_explicit_fill_action(page_client):
    """每条资料都带一个「填入」——不用猜"点这一行会怎样"。"""
    _open_picker(page_client)

    row = _rows_matching("学校")
    assert page_client.evaluate(f"{row}.querySelector('.go').textContent") == "填入"

    # 点它和点整行是同一个动作。
    page_client.evaluate(f"{row}.querySelector('.go').click()")

    accept = page_client.evaluate("window.__rfAccept")
    assert accept["label"] == "学校"
    assert accept["value"] == "天津工业大学"


def test_the_picker_rows_and_group_headers_are_keyboard_reachable(page_client):
    """键盘也要能用：整行可聚焦、回车就是「填入」；组头同样可聚焦、回车折叠。

    用户提的是"不好找"，但只给鼠标优化会让键盘用户彻底用不了这一屏。
    """
    _open_picker(page_client)

    row = _rows_matching("学校")
    assert page_client.evaluate(f"{row}.tabIndex") == 0
    page_client.evaluate(
        f"{row}.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter', bubbles: true}}))"
    )
    assert page_client.evaluate("window.__rfAccept")["value"] == "天津工业大学"

    edu = f"[...{_ROOT}.querySelectorAll('.grp')].find((g) => g.textContent.includes('教育经历'))"
    assert page_client.evaluate(f"{edu}.tabIndex") == 0
    page_client.evaluate(
        f"{edu}.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter', bubbles: true}}))"
    )
    assert page_client.evaluate(f"{edu}.classList.contains('fold')") is True


# ===== 「可能是这几个」（按当前框的文字置顶）=====

RELATED = [
    {"group": "联系方式", "label": "当前所处地", "value": "天津"},
    {"group": "教育信息", "label": "研究方向", "value": "分布式系统"},
]


def _show_with_related(page_client, related) -> None:
    page_client.evaluate(
        "window.__rfShowPanel({status: 'unmatched', related: "
        + json.dumps(related, ensure_ascii=False)
        + "})"
    )


def test_the_related_section_sits_on_top_and_takes_nothing_away(page_client):
    """推荐栏压在清单上面，**而下面的完整清单一条都没少**。

    这是这一栏能被接受的前提：它是"顺手置顶"，不是"替你筛掉"。判错一条的代价只是
    多看一眼，绝不会让用户找不到东西。
    """
    _open_panel(page_client)
    _show_with_related(page_client, RELATED)
    page_client.evaluate(_shadow("querySelector('.more').click()"))

    assert page_client.evaluate(_shadow("querySelector('.related').classList.contains('on')")) is True
    text = page_client.evaluate(_shadow("querySelector('.related').textContent"))
    assert "当前所处地" in text and "天津" in text, text
    assert "完整清单在下面" in text, text

    # 完整清单照旧。
    listing = page_client.evaluate(_shadow("querySelector('.list').textContent"))
    for label in ("姓名", "手机号", "学校", "专业"):
        assert label in listing, f"完整清单里少了 {label}"


def test_clicking_a_related_row_fills_it(page_client):
    """推荐栏里那一行走的是与清单行**同一个** accept。"""
    _open_panel(page_client)
    page_client.evaluate("window.__rfAccept = null")
    _show_with_related(page_client, RELATED)
    rows = _shadow("querySelectorAll('.related .row')")
    page_client.evaluate(f"[...{rows}].find((r) => r.title.includes('当前所处地')).click()")

    accept = page_client.evaluate("window.__rfAccept")
    assert accept, "点推荐那行没有记下选择"
    assert accept["value"] == "天津"


def test_the_related_section_stays_hidden_when_nothing_was_picked(page_client):
    """一条都没挑出来就整块不显示——那时面板和以前完全一样，不多占一行。"""
    _open_panel(page_client)
    page_client.evaluate(_shadow("querySelector('.more').click()"))

    assert page_client.evaluate(_shadow("querySelector('.related').classList.contains('on')")) is False

    _show_with_related(page_client, [])

    assert page_client.evaluate(_shadow("querySelector('.related').classList.contains('on')")) is False


MANY_GROUPS = [
    {"group": f"分组{index}", "label": f"字段{index}", "value": f"值{index}"}
    for index in range(1, 15)
]


def test_the_group_nav_wraps_instead_of_scrolling_sideways(page_client):
    """分组多时**换行铺开**，不横向溢出。

    横向溢出会让"跳转"退化成两步：先横向滚着找到那个组、再点——那和纵向滚着找条目
    是同一种累，等于白做了跳转条。这条用 14 个分组把它钉住。
    """
    _open_picker(page_client, catalog=MANY_GROUPS)

    body = _shadow("querySelector('.navbody')")
    overflow = page_client.evaluate(f"{body}.scrollWidth - {body}.clientWidth")
    assert overflow <= 1, f"跳转条横向溢出了 {overflow}px"
    assert page_client.evaluate(f"getComputedStyle({body}).flexWrap") == "wrap"
    assert page_client.evaluate(_shadow("querySelectorAll('.navchip').length")) == 14


def test_jumping_to_a_group_actually_brings_it_into_view(page_client):
    """点跳转条必须**真的把那一组带到眼前**——连着点几个不同的组也一样。

    用户报的是"多次点了不同的按钮之后按钮有点失灵，点了没跳到相关项里"。这条按
    **可见性**断言（而不是"它一定贴在最顶上"）：靠后的分组下面没有足够内容，
    本来就滚不到顶部，那时候"滚到能看见"就是正确行为。
    """
    _open_picker(page_client, catalog=MANY_GROUPS)

    for name in ("分组3", "分组8", "分组13", "分组5", "分组14"):
        page_client.evaluate(f"{_chip(name)}.click()")
        state = page_client.evaluate(
            "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
            " const pr = r.querySelector('.pick').getBoundingClientRect();"
            f" const head = [...r.querySelectorAll('.grp')].find((g) => g.textContent.includes('{name}'));"
            " if (!head) { return {found: false}; }"
            " const h = head.getBoundingClientRect();"
            " return {found: true, visible: h.top >= pr.top - 2 && h.bottom <= pr.bottom + 2,"
            "         offset: Math.round(h.top - pr.top), pickH: Math.round(pr.height)}; })()"
        )
        assert state["found"], f"找不到「{name}」那一组"
        assert state["visible"], f"点「{name}」之后它没被带到眼前：{state}"


# ===== 跳转条"盖住资料"与同类分组的聚类 =====
#
# 用户报的是：分组一多，跳转条就把下面的「可能是这几个」和完整清单**整片盖住**，滚也
# 滚不出来。根因是几何的——跳转条挂在 `position:sticky` 的搜索块里，而它自己的高度
# **没有上限**；真实资料库有 50 个左右的分组，胶囊铺十几行，sticky 块于是高过资料区的
# 可见高度。所以这些用例断言的是**位置关系**（资料区里还能看见几行、sticky 块占几成），
# 不是"某个 class 在不在"。
#
# 同类分组（「荣誉奖项 1/2/3」）聚成一块：序号是后端拼的（`data.py` / `repeated_profile.py`
# 都写 `名字 + ' ' + 序号`），按"去掉结尾的序号"认族。

_BIG_REPEATED = (
    ("教育经历", 3),
    ("实习和工作", 5),
    ("校园经历", 2),
    ("项目经历", 2),
    ("专业技能", 6),
    ("荣誉奖项", 3),
    ("学术成果", 2),
    ("证书", 3),
    ("语言能力", 2),
    ("技能", 2),
    ("紧急联系人", 2),
    ("作品和附件", 3),
    ("社交账号", 2),
    ("校园和社会实践", 2),
    ("竞赛和获奖", 3),
    ("实习和工作补充", 2),
    ("教育经历补充", 2),
    ("证书补充", 2),
    ("语言能力补充", 2),
    ("项目经历补充", 1),
)

# 接近真实规模：50 个左右的分组，其中大半是"同名不同序号"的同类分组。
BIG_CATALOG = [
    {"group": "身份信息", "label": "姓名", "value": "张三"},
    {"group": "联系方式", "label": "手机号", "value": "13800000000"},
    {"group": "其他", "label": "备注", "value": "无"},
] + [
    {"group": f"{name} {index}", "label": f"{name}字段", "value": f"{name}值"}
    for name, count in _BIG_REPEATED
    for index in range(1, count + 1)
]
BIG_GROUP_COUNT = len(BIG_CATALOG)
BIG_FAMILY_COUNT = 3 + len(_BIG_REPEATED)

# 资料区的几何：sticky 块占多高、里面还剩几行、胶囊区被限到多高。
_LAYOUT_PROBE = (
    "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
    " const pick = r.querySelector('.pick');"
    " const search = r.querySelector('.search');"
    " const body = r.querySelector('.navbody');"
    " const pr = pick.getBoundingClientRect();"
    " const sr = search.getBoundingClientRect();"
    " const top = Math.max(pr.top, sr.bottom);"
    " const rows = [...r.querySelectorAll('.row')].filter((row) => {"
    "   const b = row.getBoundingClientRect();"
    "   return b.height > 0 && b.top >= top - 1 && b.bottom <= pr.bottom + 1; });"
    " return {sticky: Math.round(sr.height), pick: Math.round(pr.height), rows: rows.length,"
    "         navBody: Math.round(body.getBoundingClientRect().height),"
    "         navMax: Math.round(parseFloat(getComputedStyle(body).maxHeight)),"
    "         folded: r.querySelector('.nav').classList.contains('fold')}; })()"
)


def _open_picker_in_viewport(page_client, width: int, height: int) -> None:
    """把视口缩到指定尺寸再开资料面板：窗口越矮，资料区的可见高度越小。

    **用完必须清掉**（用例自己 try/finally）——覆盖是挂在调试目标上的，留着会影响同
    一个标签页后面的断言。
    """
    page_client.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False},
    )


def test_a_long_group_list_can_never_cover_the_details_below(page_client):
    """**这就是用户报的那个 bug 的正面约束**：跳转条再长也不许把资料区吃光。

    摊开跳转条（最坏情况）+ 50 个分组 + 偏矮的窗口，三者叠起来正是复现条件。断言
    "资料区里还看得见行、sticky 块不超过资料区高度的 55%"——按原实现，此时跳转条
    （实测 544px）比资料区（372px）还高，可见行数是 0，这条必然红。
    """
    try:
        _open_picker_in_viewport(page_client, 1000, 560)
        _open_picker(page_client, catalog=BIG_CATALOG)

        state = page_client.evaluate(_LAYOUT_PROBE)
        assert state["folded"] is False, f"这条要的是摊开后的最坏情况：{state}"
        assert state["rows"] >= 1, f"资料区一行都看不见了：{state}"
        assert state["sticky"] <= state["pick"] * 0.55, f"跳转条把资料区吃掉了：{state}"
    finally:
        page_client.send("Emulation.clearDeviceMetricsOverride")


def test_the_nav_body_is_capped_so_the_details_keep_their_room(page_client):
    """胶囊区的上限**从资料区的可见高度里倒推**，不是一个写死的数。

    判据是"资料区至少还剩多少"（矮窗口里留一半、正常窗口里不少于 150px）——写死的高度
    在矮窗口里迟早翻车。
    """
    try:
        _open_picker_in_viewport(page_client, 1000, 560)
        _open_picker(page_client, catalog=BIG_CATALOG)

        state = page_client.evaluate(_LAYOUT_PROBE)
        assert state["navBody"] <= state["navMax"] + 1, state
        assert state["pick"] - state["sticky"] >= 140, f"资料区没留住地方：{state}"
    finally:
        page_client.send("Emulation.clearDeviceMetricsOverride")


def test_a_long_group_list_starts_with_the_nav_folded(page_client):
    """分组多时跳转条**默认折起来**：只留一行说明自己有什么，点一下才摊开。

    跳转条本是"分组多到找不到"的解药，可它自己长到十几行时又变成同一个病。折起来只占
    一行，资料区因此永远有地方——这是"盖不住"的第一道闸。
    """
    _open_panel(page_client, catalog=BIG_CATALOG)
    page_client.evaluate(_shadow("querySelector('.more').click()"))

    assert page_client.evaluate(_shadow("querySelector('.nav').classList.contains('fold')")) is True
    assert page_client.evaluate(
        _shadow("querySelector('.navhead .sum').textContent")
    ) == f"{BIG_FAMILY_COUNT} 组 · {BIG_GROUP_COUNT} 条"
    # 折起来 = 胶囊区不参与布局（元素还在 DOM 里，只是没有高度）。
    assert page_client.evaluate(_shadow("querySelector('.navbody').getBoundingClientRect().height")) == 0
    folded = page_client.evaluate(_LAYOUT_PROBE)
    assert folded["rows"] >= 1, f"折起来之后资料区还是看不见：{folded}"
    assert folded["sticky"] <= folded["pick"] * 0.35, f"折起来的一行也不该占这么多：{folded}"

    page_client.evaluate(_shadow("querySelector('.navhead').click()"))

    assert page_client.evaluate(_shadow("querySelector('.nav').classList.contains('fold')")) is False
    assert page_client.evaluate(_shadow("querySelector('.navbody').getBoundingClientRect().height")) > 0
    assert page_client.evaluate(_shadow("querySelector('.navhead').getAttribute('aria-expanded')")) == "true"


FAMILY_CATALOG = [
    {"group": "身份信息", "label": "姓名", "value": "张三"},
    {"group": "荣誉奖项 1", "label": "奖项名称", "value": "校级一等奖"},
    {"group": "荣誉奖项 1", "label": "获奖时间", "value": "2024-06"},
    {"group": "荣誉奖项 2", "label": "奖项名称", "value": "院级二等奖"},
    {"group": "荣誉奖项 3", "label": "奖项名称", "value": "院级三等奖"},
]


def test_same_kind_groups_are_clustered_into_one_family(page_client):
    """「荣誉奖项 1/2/3」聚成**一块**：一张家族胶囊 + 折着的三个成员。

    用户的原话是"同一个类型的多个字段放到一起"。单成员的分组（身份信息）仍然是老样子
    的一张胶囊——聚类不该把没有同类的东西也塞进一个壳里。
    """
    _open_picker(page_client, catalog=FAMILY_CATALOG)

    families = page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.navfam')].map((f) => ({{"
        " family: f.dataset.family,"
        " head: f.querySelector('.navchip .nm').textContent,"
        " total: f.querySelector('.navchip .c').textContent,"
        " kids: [...f.querySelectorAll('.navchip.kid')].map((k) => ({"
        "   label: k.querySelector('.nm').textContent,"
        "   count: k.querySelector('.c').textContent, group: k.dataset.group})),"
        " open: f.classList.contains('open')}))"
    )
    assert families == [
        {
            "family": "荣誉奖项",
            "head": "荣誉奖项",
            "total": "4",
            "kids": [
                {"label": "1", "count": "2", "group": "荣誉奖项 1"},
                {"label": "2", "count": "1", "group": "荣誉奖项 2"},
                {"label": "3", "count": "1", "group": "荣誉奖项 3"},
            ],
            "open": False,
        }
    ], families
    singles = page_client.evaluate(
        f"[...{_ROOT}.querySelectorAll('.navchip')]"
        ".filter((c) => !c.classList.contains('kid') && !c.dataset.family)"
        ".map((c) => c.dataset.group)"
    )
    assert singles == ["身份信息"], singles


def test_a_family_chip_expands_its_members_and_members_jump(page_client):
    """家族胶囊管展开、成员胶囊管跳转；人进了哪一族，那一族要看得出来。"""
    _open_picker(page_client, catalog=FAMILY_CATALOG)
    family = f"{_ROOT}.querySelector('.navfam')"
    kids = f"[...{family}.querySelectorAll('.navchip.kid')]"

    assert page_client.evaluate(f"{kids}.every((k) => k.getBoundingClientRect().height === 0)") is True

    page_client.evaluate(f"{family}.querySelector('.navchip').click()")

    assert page_client.evaluate(f"{family}.classList.contains('open')") is True
    assert page_client.evaluate(f"{kids}.every((k) => k.getBoundingClientRect().height > 0)") is True
    assert page_client.evaluate(
        f"{family}.querySelector('.navchip').getAttribute('aria-expanded')"
    ) == "true"

    page_client.evaluate(f"{kids}[1].click()")

    assert page_client.evaluate(f"{kids}[1].classList.contains('on')") is True, "跳过去的那一格没点亮"
    assert page_client.evaluate(f"{family}.classList.contains('active')") is True, "看不出人在哪一族"
    jumped = page_client.evaluate(
        "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
        " const pr = r.querySelector('.pick').getBoundingClientRect();"
        " const head = [...r.querySelectorAll('.grp')].find((g) => g.textContent.includes('荣誉奖项 2'));"
        " if (!head) { return null; }"
        " const h = head.getBoundingClientRect();"
        " return {visible: h.top >= pr.top - 2 && h.bottom <= pr.bottom + 2}; })()"
    )
    assert jumped == {"visible": True}, jumped

    page_client.evaluate(f"{family}.querySelector('.navchip').click()")

    assert page_client.evaluate(f"{family}.classList.contains('open')") is False


def test_the_action_buttons_never_wrap_their_own_labels(page_client):
    """按钮文字不许折行。

    原先提示文字和三个按钮挤在同一个 flex 行里，而按钮默认可被压缩——提示一写长
    （比如只读控件那句），「填入」「收起」就被挤成竖排的两行。
    """
    _open_panel(page_client)
    page_client.evaluate(
        "window.__rfShowPanel({status: 'blocked', field_label: '', value: '',"
        " note: '这是个只能点选的选择控件（值不能直接写进去），需要你在页面上自己点选'})"
    )

    box = page_client.evaluate(
        "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
        " const b = r.querySelector('.more').getBoundingClientRect();"
        " return {w: Math.round(b.width), h: Math.round(b.height)}; })()"
    )
    # 折行会让高度翻倍（12px 字号 + 内边距，单行约 24px）。
    assert box["h"] <= 30, f"按钮被挤成两行了：{box}"
    # 提示独占一行，所以它自己也不该把按钮挤走。
    text = page_client.evaluate(_shadow("querySelector('.more').textContent"))
    assert text == "换个资料…", text


def test_panel_explains_that_the_title_bar_can_be_dragged(page_client):
    """拖动能力要在界面上自解释，且提示不能变成一个可误触的按钮。"""
    _open_panel(page_client)

    hint = page_client.evaluate(_shadow("querySelector('.drag-hint').textContent"))
    assert hint == "可拖动标题栏调整位置", hint
    assert page_client.evaluate(
        _shadow("getComputedStyle(querySelector('.drag-hint')).fontSize")
    ) == "10px"
    assert page_client.evaluate(
        _shadow("getComputedStyle(querySelector('.head')).cursor")
    ) == "grab"

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

本文件是 canary 家族的主文件（快照/读取与「点哪个填哪个」的监听、焦点捕获），选择器
拾取、「记住这条」、分组导航、面板 chrome 分别在
``test_webform_js_canary_picker/remember/nav/chrome.py``；共享的合成 DOM、资料目录与
helper 在 ``webform_canary_support.py``。
"""
import json

from webform_canary_support import (
    _focus,
    _index_of,
    _install,
    _snapshot,
    page_client,
)

# page_client 是 pytest fixture（定义在支撑模块），经本模块命名空间解析；显式 re-export。
__all__ = ["page_client"]


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

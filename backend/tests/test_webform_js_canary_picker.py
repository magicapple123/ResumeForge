# SPDX-License-Identifier: Apache-2.0
"""canary 家族 · 选择器拾取与面板定位。

「换个资料…」清单的展开/搜索/拾取，以及面板的定位契约（贴着输入框、不跑出视口、
跟得住页面重排、拖动保留相对偏移）。运行方式与 skip 契约见主文件
``test_webform_js_canary.py`` 的 docstring；共享的合成 DOM、资料目录与 helper 在
``webform_canary_support.py``。
"""
import time

from webform_canary_support import (
    _box,
    _distance,
    _focus,
    _install,
    _offset_after_switching_field,
    _open_panel,
    _overlaps,
    _shadow,
    _snapshot,
    page_client,
)

# page_client 是 pytest fixture（定义在支撑模块），经本模块命名空间解析；显式 re-export。
__all__ = ["page_client"]

# ===== AI 候选、来源标记与面板定位 =====


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


def _panel_rect(page_client) -> dict:
    return page_client.evaluate(
        "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
        " const b = r.querySelector('.p').getBoundingClientRect();"
        " return {left: Math.round(b.left), top: Math.round(b.top),"
        " w: Math.round(b.width), h: Math.round(b.height)}; })()"
    )


def _drag_panel(page_client, dx: int, dy: int) -> None:
    """按住面板标题栏拖 (dx, dy)。**坐标从面板的实际位置取**，不假设它贴在哪。"""
    origin = _panel_rect(page_client)
    x, y = origin["left"] + 12, origin["top"] + 6
    page_client.evaluate(
        "(() => {"
        " const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " const panel = root.querySelector('.p');"
        f" panel.dispatchEvent(new MouseEvent('mousedown',"
        f"   {{bubbles: true, button: 0, buttons: 1, clientX: {x}, clientY: {y}}}));"
        f" window.dispatchEvent(new MouseEvent('mousemove',"
        f"   {{bubbles: true, buttons: 1, clientX: {x + dx}, clientY: {y + dy}}}));"
        " window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));"
        "})()"
    )


def _drag_resize(page_client, dx: int, dy: int) -> None:
    """按住右下角把手拖 (dx, dy)。"""
    corner = page_client.evaluate(
        "(() => { const r = document.getElementById('__rf_live_host__').shadowRoot;"
        " const b = r.querySelector('.rs').getBoundingClientRect();"
        " return {x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2)}; })()"
    )
    page_client.evaluate(
        "(() => {"
        " const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " const handle = root.querySelector('.rs');"
        f" handle.dispatchEvent(new MouseEvent('mousedown',"
        f"   {{bubbles: true, button: 0, buttons: 1, clientX: {corner['x']}, clientY: {corner['y']}}}));"
        f" window.dispatchEvent(new MouseEvent('mousemove',"
        f"   {{bubbles: true, buttons: 1, clientX: {corner['x'] + dx}, clientY: {corner['y'] + dy}}}));"
        " window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));"
        "})()"
    )


def test_dragging_the_title_bar_moves_the_panel_by_exactly_that_much(page_client):
    """拖多少就走多少。
    旧实现把拖动量当成"相对输入框的绝对偏移"再叠加，面板本来就被视口夹在某个位置时，
    夹掉的差值会一直留在算式里——用户往上拖，面板纹丝不动（反馈原话：「顶部像是被什么
    东西抵住了，明明还有空间却拖不动」）。这条用例钉住"跟手"这个性质本身。
    """
    _open_panel(page_client)

    # 先把面板往下挪出一段**上方余量**：面板默认贴着输入框顶部，视口里它上面只剩
    # 个位数像素，直接往上拖会被视口上沿正确夹住（那不是缺陷，是边界）。挪下来之后
    # 再测"往上拖多少就走多少"才有意义，且与浏览器窗口高度无关。
    _drag_panel(page_client, 0, DRAG_DELTA)
    before = _panel_rect(page_client)
    _drag_panel(page_client, 0, -DRAG_DELTA)
    after = _panel_rect(page_client)

    moved = before["top"] - after["top"]
    assert abs(moved - DRAG_DELTA) <= 4, f"往上拖 {DRAG_DELTA}px，面板只移动了 {moved}px"


def test_the_panel_can_be_resized_from_its_corner_with_a_floor(page_client):
    """右下角把手改尺寸；**缩到 380×300 就停住**，不会变成一条看不清的窄缝。

    下限是刻意的：再小就塞不下搜索框加一行资料，而"拖到最小"的用户本意是别挡着表单，
    不是要一块没法读的卡片。

    **左上角必须锚住。** 把手在右下角，拖它只该改宽高；宽度一变，`position()` 的
    `maxLeft` 会跟着变小，旧实现于是把 left 往左推——用户看到的是"拖右下角、动的却是
    左边"（2026-10-28 反馈），再继续拖还会让把手和鼠标错位。视口放大到 1200×900 再测，
    小视口下面板本来就贴着左上角，锚没锚住看不出来。
    """
    page_client.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": 1200, "height": 900, "deviceScaleFactor": 1, "mobile": False},
    )
    try:
        _open_panel(page_client)
        page_client.evaluate(_shadow("querySelector('.more').click()"))

        before = _panel_rect(page_client)
        _drag_resize(page_client, 60, -80)
        grown = _panel_rect(page_client)
        assert (grown["left"], grown["top"]) == (before["left"], before["top"]), (
            f"拖右下角把面板整体挪走了：{before} → {grown}"
        )
        assert grown["w"] == before["w"] + 60, f"宽度没跟着拖动走：{before} → {grown}"
        assert grown["h"] == before["h"] - 80, f"高度没跟着拖动走：{before} → {grown}"

        _drag_resize(page_client, -900, -900)
        floor = _panel_rect(page_client)
        assert (floor["w"], floor["h"]) == (380, 300), f"最小尺寸没守住：{floor}"
        assert (floor["left"], floor["top"]) == (before["left"], before["top"]), (
            f"缩到最小又把面板挪走了：{floor}"
        )

        # **贴住右边界时再拖宽**：右侧没有余量，宽度就该停住，left 尤其不许被推走。
        # 旧实现按 `innerWidth - 2*gap` 算上限，这里会得到"变宽 80px、同时左移 80px"。
        _drag_panel(page_client, 900, 0)
        edge = _panel_rect(page_client)
        _drag_resize(page_client, 80, 0)
        pushed = _panel_rect(page_client)
        assert (pushed["left"], pushed["w"]) == (edge["left"], edge["w"]), (
            f"贴右边拖宽把面板推走了：{edge} → {pushed}"
        )
    finally:
        page_client.send("Emulation.clearDeviceMetricsOverride")

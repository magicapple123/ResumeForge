"""webform 注入脚本真机验证（canary 家族）的共享支撑模块。

test_webform_js_canary.py 按面板功能拆成主文件 + picker/remember/nav/chrome 四个
主题文件后，单浏览器串行契约、合成 DOM、资料目录与全部 helper 落在本模块，
由五个测试文件共同 import（先例：``tests/profile_relevance_fixtures.py``）。

**非 test_ 前缀，pytest 不收集本文件。**
"""
import json
import os

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
    <div class="sd-Dropdown-container">
      <label class="sd-Input-container"><input id="component-picker" type="text"></label>
    </div>
    <div contenteditable="true" id="rich-note"></div>
    <textarea id="long-note"></textarea>
    <input id="capped" type="text" maxlength="5">
    <div style="height: 3000px"></div>
    <input id="far-away" type="text">
    <button id="submit-btn">提交</button>
  </div>
</body></html>
"""

CATALOG = [
    {"group": "身份信息", "label": "姓名", "value": "张三"},
    {"group": "联系方式", "label": "手机号", "value": "13800000000"},
    {"group": "教育经历 1", "label": "学校", "value": "天津工业大学"},
    {"group": "教育经历 1", "label": "专业", "value": "软件工程"},
]


def browser_or_skip() -> WebsocketCdpClient:
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
    # 所以就照它本来的定位办：**本地单独跑这个 canary 家族**（CI 上本来也永远是 skip）。
    os.environ.get("PYTEST_XDIST_WORKER") and pytest.skip(
        "真机 canary 共用同一个浏览器，并行会互相抢标签页——请单独跑 tests/test_webform_js_canary*.py"
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
    client = browser_or_skip()
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


def _install_editor(page_client, targets: list[dict]) -> None:
    """装焦点监听 + 记忆编辑器，并把目标推进页面（顺序与 ``LiveSession._attach`` 一致）。"""
    from app.services.webform.live_memory_panel import (
        REMEMBER_EDITOR_SCRIPT,
        memory_targets_script,
    )

    _install(page_client)
    page_client.evaluate(memory_targets_script(targets))
    page_client.evaluate(REMEMBER_EDITOR_SCRIPT)


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


def _show_with_related(page_client, related) -> None:
    page_client.evaluate(
        "window.__rfShowPanel({status: 'unmatched', related: "
        + json.dumps(related, ensure_ascii=False)
        + "})"
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

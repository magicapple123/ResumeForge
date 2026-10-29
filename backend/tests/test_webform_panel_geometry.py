# SPDX-License-Identifier: Apache-2.0
"""焦点面板的**几何**：默认尺寸不贴边、拖右下角只改宽高、松手位置不跳。

这里是**源码级**守卫（不启浏览器）——真机那条链路由 ``test_webform_js_canary*.py``
覆盖，它们需要 127.0.0.1:9333 上的受控浏览器，CI 上永远是 skip。而这三个缺陷的形态
恰好可以用"脚本里到底怎么算"来钉住，所以放在这里，任何时候都能跑。

## 用户报的三个形态（同一块面板）

1. 620px 宽的窗口里卡片几乎铺满整屏、上下左右都贴着边（``100vw - 16px`` 的锅）；
2. 按住右下角把手拖动时**左边框在动**，继续拖整块卡片**跳到输入框右侧**；
3. 松手后位置又跳回按输入框算出来的落点。

根因链：``onResizeStart`` 每帧调 ``position()``，而 ``position()`` → ``targetPosition()``
是**按焦点输入框重算落点**的（``fitsRight`` 一翻转就走 ``rect.left - gap - width``，
那个分支的 left 随宽度变），200ms 的 reflow 定时器也在旁边一起抢位置。
"""

from __future__ import annotations

import re

from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live_memory_panel import REMEMBER_EDITOR_SCRIPT


def _slice(start: str, end: str) -> str:
    """从注入脚本里切出一段源码（两个锚点都必须在，否则用例自己就该红）。"""
    begin = FOCUS_LISTENER_SCRIPT.index(start)
    finish = FOCUS_LISTENER_SCRIPT.index(end, begin)
    return FOCUS_LISTENER_SCRIPT[begin:finish]


def _panel_css() -> str:
    """``.p{...}`` 那条规则（含续行）。"""
    return _slice("'  .p{position:fixed;", "'  .rs{")


# ===== 缺陷 3：默认尺寸不要顶格 =====


def test_the_default_panel_size_leaves_a_visible_margin_on_every_side() -> None:
    """默认宽高都留白：``100vw - 16px`` / ``100vh - 16px`` 在窄窗口里就是"铺满整屏"。"""
    css = _panel_css()

    assert "width:min(520px,calc(100vw - 32px))" in css
    assert "max-height:min(560px,calc(100vh - 48px))" in css
    # 贴边的那两个值不许再回来。
    assert "min(620px" not in css
    assert "max-height:calc(100vh - 16px)" not in css


def test_the_hard_caps_still_allow_every_size_the_resize_clamp_permits() -> None:
    """``max-width`` / ``max-height`` 是**用户拖大之后的**上限，不能比拖动钳制还紧。

    钳制用的是 ``EDGE_GAP = 8``：``left ≥ 8`` ⇒ 宽 ≤ ``vw - 16``。默认宽度收窄到
    ``vw - 32`` 之后，硬上限仍必须是 ``vw - 16``，否则用户拖不到自己该拖到的尺寸。
    """
    css = _panel_css()

    assert "max-width:calc(100vw - 16px)" in css
    assert re.search(r"max-width:calc\(100vw - (?:1[0-5]|[0-9])px\)", css) is None


def test_a_narrow_window_degrades_to_full_width_minus_the_margin() -> None:
    """480px 这类窄窗口要退化成"满宽减边距"，不能溢出。"""
    css = _panel_css()

    assert "calc(100vw - 32px)" in css
    # 上下限同源：``min()`` 的第二项就是窄窗口里的实际宽度。
    assert css.count("min(520px,calc(100vw - 32px))") == 1


def test_the_minimum_size_and_edge_gap_are_unchanged() -> None:
    """380×300 与 ``EDGE_GAP = 8`` 是和定位钳制共用的常量，不能悄悄改。"""
    assert "  const MIN_PANEL_W = 380;\n" in FOCUS_LISTENER_SCRIPT
    assert "  const MIN_PANEL_H = 300;\n" in FOCUS_LISTENER_SCRIPT
    assert "  const EDGE_GAP = 8;\n" in FOCUS_LISTENER_SCRIPT


def test_manual_size_overrides_the_default_height_cap() -> None:
    """用户拖出来的尺寸要压过默认的 ``max-height``，否则"拖到一半就拖不动"。

    ``max-height`` 与高度**只在资料区展开时**落：折叠态没有能吃掉剩余高度的内容，
    写死高度会在按钮下方留一大片空白（见下面折叠高度的用例）。
    """
    apply_size = _slice("const applySize = () => {", "window.__rfApplySize = applySize;")

    assert "panel.style.maxHeight = expanded ? 'none' : '';" in apply_size
    # 清掉手动尺寸时要还回样式表的默认上限（否则编辑器关闭后高度再也回不到默认形态）。
    assert "panel.style.maxHeight = '';" in apply_size
    # 还回去的仍然是**用户缩放的尺寸**，不是一律清空。
    assert "panel.style.width = manualSize.width + 'px';" in apply_size


# ===== 缺陷 2：缩放期间锚死左上角 =====


def test_position_refuses_to_run_while_the_handle_is_being_dragged() -> None:
    """拖动期间 ``position()`` 必须早退——它按焦点输入框重算落点，正是"左边框在动"的根因。"""
    assert "  let resizingPanel = false;\n" in FOCUS_LISTENER_SCRIPT
    position = _slice("const position = () => {", "// 用户手动缩放过之后的尺寸")

    guard = position.index("if (resizingPanel) { return; }")
    assert guard < position.index("targetPosition()")
    # 200ms 的 reflow 定时器也走 position()，同一道闸把它一起挡住。
    assert "window.setInterval(position, REFLOW_CHECK_MS)" in FOCUS_LISTENER_SCRIPT


def test_the_resize_handle_anchors_the_top_left_corner() -> None:
    """拖动全程 ``left`` / ``top`` 钉在起始值，上限按锚点到视口右边/下边算。"""
    resize = _slice("const onResizeStart = (event) => {", "shadow.querySelector('.rs')")

    assert "const anchorLeft = box.left;" in resize
    assert "const anchorTop = box.top;" in resize
    assert "window.innerWidth - anchorLeft - EDGE_GAP" in resize
    assert "window.innerHeight - anchorTop - EDGE_GAP" in resize
    # 起始与每一帧都要写回锚点（宽度变了也不许推着左边框动）。
    assert resize.count("panel.style.left = anchorLeft + 'px';") == 2
    assert resize.count("panel.style.top = anchorTop + 'px';") == 2
    assert "resizingPanel = true;" in resize


def test_the_resize_move_handler_does_not_reposition_the_panel() -> None:
    """``move`` 里不许调 ``position()``；只有松手那一步才允许重算一次。"""
    resize = _slice("const onResizeStart = (event) => {", "shadow.querySelector('.rs')")
    move = resize[
        resize.index("const move = (moveEvent) => {") : resize.index("const up = () => {")
    ]

    assert "position()" not in move
    up = resize[resize.index("const up = () => {") :]
    assert "position()" in up
    assert "resizingPanel = false;" in up


def test_releasing_the_handle_keeps_the_panel_where_the_user_put_it() -> None:
    """松手后位置不能跳：把"看到的这个位置"换算成 ``dragOffset``（与 ``onDragStart`` 同法）。"""
    resize = _slice("const onResizeStart = (event) => {", "shadow.querySelector('.rs')")
    up = resize[resize.index("const up = () => {") :]

    assert "dragOffset = { left: 0, top: 0 };" in up
    assert "dragOffset = { left: anchorLeft - now.rawLeft, top: anchorTop - now.rawTop };" in up
    # 缓存必须清掉，否则命中"坐标没变就不写"的短路，松手后第一帧不会重算。
    assert "lastLeft = -1;" in up and "lastTop = -1;" in up
    # 高度变了，跳转条的高度上限要按新高度重算（不然它按旧资料区高度算出来偏大）。
    assert "measureNavLimit();" in up


def test_relayout_still_resets_the_cached_position() -> None:
    """``window.__rfRelayout()`` 的语义不变：清缓存 + 立刻重算（编辑器关闭时也走它）。"""
    assert (
        "window.__rfRelayout = () => { lastLeft = -1; lastTop = -1; position(); };\n"
        in FOCUS_LISTENER_SCRIPT
    )


def test_a_lost_mouseup_does_not_leave_the_panel_frozen() -> None:
    """``mouseup`` 丢失（拖出窗口松手 / 远程桌面 / 触控）时也要收尾。

    把窗口拖出屏幕再松手、系统弹窗抢走鼠标——这些情况下 ``mouseup`` 可能根本不到。
    如果 ``resizingPanel`` 就永远停在 true，``position()`` 每帧早退，用户下次点别的框
    时面板再也不跟随（比"拖不动"更难查：没有任何报错，只有"面板不理我了"）。
    """
    resize = _slice("const onResizeStart = (event) => {", "shadow.querySelector('.rs')")
    move = resize[
        resize.index("const move = (moveEvent) => {") : resize.index("const up = () => {")
    ]

    # 按键已经松开（buttons === 0）就当作松手，走与 mouseup 同一条收尾路径。
    assert "if (moveEvent.buttons === 0) { up(); return; }" in move
    # 面板被收起时同样要复位，否则下次显示出来仍旧不跟随。
    hide = _slice("function hide() {", "function accept(label, value) {")
    assert "resizingPanel = false;" in hide


# ===== 「记住这条」编辑器：吃掉面板剩余高度 =====
#
# 用户报的形态：把面板拖高之后，编辑器不再跟着长，卡片底部留一大片空白（截图里的那块白）。
# 根因是编辑器自己写死了两个上限（``.rf-memory`` 的 ``min(680px,76vh)`` 与目标清单的
# ``min(430px,50vh)``），而面板 ``.p`` 是 ``display:flex;flex-direction:column``——面板
# 长高了，这块固定高度的子元素只会在下面留白。


def _memory_rule(selector: str) -> str:
    """「记住这条」编辑器样式表里某一条规则（含续行，到该行的 ``,`` 为止）。"""
    begin = REMEMBER_EDITOR_SCRIPT.index("'" + selector + "{")
    finish = REMEMBER_EDITOR_SCRIPT.index("}',", begin)
    return REMEMBER_EDITOR_SCRIPT[begin:finish]


def _without_memory_comments() -> str:
    """去掉纯注释行：模板的实现说明会引用被删掉的旧值，那不是实现。"""
    return "\n".join(
        line for line in REMEMBER_EDITOR_SCRIPT.splitlines() if not line.lstrip().startswith("//")
    )


def test_the_remember_editor_takes_the_panel_leftover_height() -> None:
    """``.rf-memory`` 参与纵向分配且可缩，默认仍不显示。"""
    css = _memory_rule(".rf-memory")

    assert "flex:1 1 auto" in css
    assert "min-height:0" in css
    assert "flex-direction:column" in css
    assert "display:none" in css
    # 写死的高度上限就是"底部那片空白"的根因，不许回来。
    assert "max-height" not in css
    assert "max-height:min(680px,76vh)" not in _without_memory_comments()


def test_the_remember_editor_scrolls_itself_only_when_the_panel_is_too_short() -> None:
    """极端矮的面板（``MIN_PANEL_H = 300``）下整块编辑器可滚，而不是把清单压成 0 高。"""
    css = _memory_rule(".rf-memory")

    assert "overflow:auto" in css


def test_the_target_list_grows_with_the_panel_and_scrolls_inside_itself() -> None:
    """目标清单跟着面板长；短了在自己内部滚，并且还留得住可点的高度。"""
    css = _memory_rule(".rf-memory-targets")

    assert "flex:1 1 auto" in css
    assert "min-height:96px" in css
    assert "max-height:none" in css
    assert "overflow:auto" in css
    # 430/50vh 那个上限正是"面板变高了清单却到顶"的根因。
    assert "max-height:min(430px,50vh)" not in _without_memory_comments()


def test_every_fixed_block_of_the_remember_editor_refuses_to_be_squashed() -> None:
    """标题 / 副标题 / label+input / hint / 按钮行都不参与压缩，只有清单让位。"""
    assert "'.rf-memory > :not(.rf-memory-targets){flex:0 0 auto}'" in REMEMBER_EDITOR_SCRIPT


def test_opening_the_remember_editor_switches_it_to_flex() -> None:
    """打开时必须设成 ``flex``：``block`` 会把 ``flex:1 1 auto`` 丢回按内容算高度。"""
    assert "editor.style.display = 'flex';" in REMEMBER_EDITOR_SCRIPT
    assert "editor.style.display = 'block';" not in REMEMBER_EDITOR_SCRIPT
    # 关闭仍走 `close()`：不显示 + 把用户缩放过的尺寸还回去。
    close = REMEMBER_EDITOR_SCRIPT[
        REMEMBER_EDITOR_SCRIPT.index("const close = () => {") : REMEMBER_EDITOR_SCRIPT.index(
            "button.addEventListener('click'"
        )
    ]
    assert "editor.style.display = 'none';" in close
    assert "window.__rfApplySize" in close


def test_manual_height_is_dropped_while_the_picker_is_collapsed() -> None:
    """折叠态没有能吃掉剩余高度的内容，写死高度只会在按钮下方留一大片空白。"""
    script = FOCUS_LISTENER_SCRIPT
    assert "panel.style.height = expanded ? manualSize.height + 'px' : '';" in script
    assert "panel.style.maxHeight = expanded ? 'none' : '';" in script
    # 折叠 / 展开 / 重新显示面板都要重新落一次尺寸，否则"收起后又变回固定高度"。
    assert script.count("applySize();") == 3
    set_expanded = script[script.index("const setExpanded = (next)") :]
    assert "applySize();" in set_expanded[: set_expanded.index("};")]

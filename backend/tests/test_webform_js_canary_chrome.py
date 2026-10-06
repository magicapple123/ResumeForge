"""canary 家族 · 视口封顶 / 族聚合 / 操作按钮 / 拖动提示 / 吉祥物 / 悬浮球样式刷新。

跳转条"盖住资料"与同类分组的聚类：用户报的是分组一多，跳转条就把下面的「可能是这几个」
和完整清单**整片盖住**，滚也滚不出来。根因是几何的——跳转条挂在 `position:sticky` 的
搜索块里，而它自己的高度**没有上限**；真实资料库有 50 个左右的分组，胶囊铺十几行，
sticky 块于是高过资料区的可见高度。所以这些用例断言的是**位置关系**（资料区里还能看见
几行、sticky 块占几成），不是"某个 class 在不在"。

同类分组（「荣誉奖项 1/2/3」）聚成一块：序号是后端拼的（`data.py` / `repeated_profile.py`
都写 `名字 + ' ' + 序号`），按"去掉结尾的序号"认族。
运行方式与 skip 契约见主文件 ``test_webform_js_canary.py`` 的 docstring；共享的合成
DOM、资料目录与 helper 在 ``webform_canary_support.py``。
"""
import json
import time

from webform_canary_support import (
    _ROOT,
    _open_panel,
    _open_picker,
    _open_picker_in_viewport,
    _shadow,
    _urlencode,
    page_client,
)

# page_client 是 pytest fixture（定义在支撑模块），经本模块命名空间解析；显式 re-export。
__all__ = ["page_client"]

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


# ===== 历历悬浮球的注入脚本 =====

# 球的脚本要 shadow host 先存在（它只往里装东西，自己不建 host）。
LIVE_CONTROL_FIXTURE = """
<!doctype html><html><body>
  <div id="__rf_live_host__"></div>
  <script>document.getElementById('__rf_live_host__').attachShadow({ mode: 'open' });</script>
</body></html>
"""

# 悬停用例**不能**用上面那份：监听脚本只在"host 还不存在"时才建它，也才会顺手装上
# 那份面板样式（里面那条通配 `button:hover` 正是把球刷成蓝色的元凶）。自己预建 host
# 的话，这条用例会永远绿——等于没测。
HOVER_FIXTURE = """
<!doctype html><html><body>
  <input id="rf-hover-field" type="text">
</body></html>
"""


def test_the_control_ball_refreshes_its_styles_when_reinstalled(page_client):
    """重复注入要**刷新样式表**，而不是"球已经在了就直接返回"。

    这段脚本跟着应用版本走，而页面里那颗球是注入那一刻的样子：升级后如果不重载页面，
    老样式会一直留着。用户反馈的"鼠标放上去仍有一圈深蓝底色"就是这么来的——那条
    `:hover` 阴影早删了，页面上用的还是旧样式表（`object-fit` 那次也踩过同一个坑）。
    """
    from app.services.webform.live_control import install_live_control_script

    page_client.navigate(f"data:text/html;charset=utf-8,{_urlencode(LIVE_CONTROL_FIXTURE)}")
    script = install_live_control_script(True)
    page_client.evaluate(script)

    # 把样式表改写成"上一版"的样子，模拟页面里那颗老球。
    page_client.evaluate(
        # 标记必须是不可能出现在真样式表里的字符串：`#1677ff` 这类颜色值真表里也有，
        # 拿它当哨兵会让"旧样式还在"永远为真。
        "(() => { const style = document.getElementById('__rf_live_host__')"
        ".shadowRoot.querySelector('style');"
        " style.textContent = '.rf-stale-style-marker{outline:9px dashed red}'; return 'ok'; })()"
    )

    page_client.evaluate(script)

    report = json.loads(
        page_client.evaluate(
            "(() => { const shadow = document.getElementById('__rf_live_host__').shadowRoot;"
            " const style = shadow.querySelector('style');"
            " return JSON.stringify({"
            "   stillOld: style.textContent.indexOf('rf-stale-style-marker') >= 0,"
            "   refreshed: style.textContent.indexOf('.has-avatar:hover') >= 0,"
            "   balls: shadow.querySelectorAll('.rf-live-switch').length,"
            "   avatars: shadow.querySelectorAll('.rf-live-avatar').length }); })()"
        )
    )
    assert report["refreshed"] is True, "重复注入没有刷新样式表"
    assert report["stillOld"] is False, "旧样式表还在"
    assert report["balls"] == 1, "重复注入不该再建一颗球"
    assert report["avatars"] == 1


def test_the_mascot_button_keeps_its_own_look_on_hover(page_client):
    """鼠标放到历历球上，它的底色不该被**面板的通配按钮规则**刷成蓝色。

    面板那条 `button:not(.navchip)…:hover:not(:disabled)` 的特异性是 (0,5,1)，压得过球自己的
    `.rf-live-switch.has-avatar:hover`（0,3,0）——两个脚本同住一个 shadow root，用户看到的就是
    "鼠标一放上去多出一圈深蓝底"。**必须真的悬停再量计算样式**：只看静态断言的话，这条规则
    与球的关系（谁压过谁）根本看不出来，这正是上一次漏掉它的原因。
    """
    from app.services.webform.engine import FOCUS_LISTENER_SCRIPT
    from app.services.webform.live_control import install_live_control_script

    page_client.navigate(f"data:text/html;charset=utf-8,{_urlencode(HOVER_FIXTURE)}")
    page_client.evaluate(FOCUS_LISTENER_SCRIPT)
    page_client.evaluate(install_live_control_script(True))
    assert page_client.evaluate("Boolean(document.getElementById('__rf_live_host__'))"), (
        "监听脚本没有建出 shadow host，这条会变成假绿"
    )

    center = json.loads(
        page_client.evaluate(
            "(() => { const host = document.getElementById('__rf_live_host__');"
            " const b = host.shadowRoot.querySelector('.rf-live-switch').getBoundingClientRect();"
            " return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()"
        )
    )
    page_client.send(
        "Input.dispatchMouseEvent",
        {"type": "mouseMoved", "x": center["x"], "y": center["y"], "buttons": 0},
    )
    time.sleep(0.3)

    style = json.loads(
        page_client.evaluate(
            "(() => { const host = document.getElementById('__rf_live_host__');"
            " const ball = host.shadowRoot.querySelector('.rf-live-switch');"
            " const s = getComputedStyle(ball);"
            " return JSON.stringify({ hovering: ball.matches(':hover'),"
            "   background: s.backgroundColor, boxShadow: s.boxShadow }); })()"
        )
    )
    # **先证明鼠标真的落在球上**：不证明的话，悬停没生效时这条会空过（踩过）。
    assert style["hovering"] is True, f"鼠标没有停在球上，这条等于没测：{style}"
    assert style["background"] == "rgba(0, 0, 0, 0)", f"悬停时球被刷上了底色：{style}"
    assert style["boxShadow"] == "none", f"悬停时球多出了阴影：{style}"

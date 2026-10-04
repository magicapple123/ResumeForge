"""canary 家族 · 「换个资料…」那一屏：分组跳转 / 折叠 / 命中数 / 截断 / 相关项。

起因是用户的反馈：内容一多就只能在面板里上下滚着翻找；单条字段名过长时会把整行
撑乱。改法是给三样东西——顶部的分组跳转条、每组可折叠、搜索时给出命中数。

面板最宽 620px（`.p{width:min(620px,calc(100vw - 16px))}`），装不下左侧栏，
所以跳转条是**横着排在搜索框下面**的，不是 Codex 计划里写的左侧目录。

同样是真机验证：这一屏是注入脚本现场渲染的，离线测试只能断言"脚本里有某个标记"。
运行方式与 skip 契约见主文件 ``test_webform_js_canary.py`` 的 docstring；共享的合成
DOM、资料目录与 helper 在 ``webform_canary_support.py``。
"""
from webform_canary_support import (
    CATALOG,
    _chip,
    _open_panel,
    _open_picker,
    _rows_matching,
    _ROOT,
    _shadow,
    _show_with_related,
    page_client,
)

# page_client 是 pytest fixture（定义在支撑模块），经本模块命名空间解析；显式 re-export。
__all__ = ["page_client"]


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


COLOR_CATALOG = CATALOG + [
    {"group": "实习经历 2", "label": "公司", "value": "星河科技"},
    {"group": "实习经历 2", "label": "职位", "value": "产品实习生"},
]


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

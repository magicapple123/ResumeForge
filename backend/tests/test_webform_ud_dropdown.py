"""UD Design（字节自研）弹层 DOM 守卫测试。

2026-10-06 字节校招页真机取证：7 个弹层代选全失败，因为字节不用 Semi/antd——
弹层是 `ud__select__dropdown` 挂 body、选项行 `ud__select__list__item` /
`ud__tree__node`、**没有 role="option"**，且 rc-virtual-list 只渲染可视行。
本文件用 node+jsdom 把取证到的 DOM 形态做成 fixture，**执行真实生成的 JS**
（custom_select_scripts），钉死四条契约：

1. 通用 portal 根发现能认 UD 弹层（列表与树两种形态）；
2. 点击前已在页面上的残留浮层（atsx-select 关闭后 display:block 残留）被时序排除；
3. 树形多选行的点选目标是行内 checkbox（点行中心只是展开）；
4. 同名选项去重（rc-virtual-list 重复渲染不卡 ambiguous）。
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from app.services.webform.custom_select import _already_selected, _parse_snapshot
from app.services.webform.custom_select_scripts import (
    mark_preexisting_script,
    option_snapshot_script,
    parse_preexisting,
    trigger_display_script,
)

FRONTEND_NODE_MODULES = Path(__file__).resolve().parents[2] / "frontend" / "node_modules"
_JSDOM_MODULE = FRONTEND_NODE_MODULES / "jsdom"


def _jsdom_available() -> bool:
    """node 与前端 jsdom 模块都可用才执行真 DOM 契约。

    backend 的 CI 作业不装 frontend 依赖（node_modules 不存在），runner 预装
    的 node 也不够——require('jsdom') 会直接挂。缺一样就跳过，与 canary
    的「无受控浏览器跳过」同一惯例。
    """
    return shutil.which("node") is not None and _JSDOM_MODULE.is_dir()

# 真机取证 2026-10-06：字节页控件与弹层的形状（类名逐字符保留）。
_UD_LIST_DROPDOWN = """
<div class="ud__select__dropdown ud__select__dropdown-placement-bottomLeft" data-rect="944,470,552,208">
 <div class="ud__select__list"><div class="ud__select__list__menu">
  <div class="rc-virtual-list"><div class="rc-virtual-list-holder">
   <div class="rc-virtual-list-holder-inner">
    {items}
   </div>
  </div></div>
 </div></div>
</div>
"""

_UD_LIST_ITEM = (
    '<div class="ud__select__list__item" data-rect="944,{top},552,36">'
    '<div class="ud__select__list__item__content">{text}</div></div>'
)

_UD_TREE_DROPDOWN = """
<div class="ud__select__dropdown citySelectWrapper__1-XSn" data-rect="932,560,600,230">
 <div class="ud__select__list ud__treeSelect__overlay"><div class="ud__tree"><div class="ud__tree__list">
  <div class="rc-virtual-list"><div class="rc-virtual-list-holder">
   <div class="rc-virtual-list-holder-inner">
    {items}
   </div>
  </div></div>
 </div></div></div>
</div>
"""

_UD_TREE_NODE = (
    '<div class="ud__tree__node" data-rect="932,{top},600,38">'
    '<label class="ud__checkbox__wrapper"><span class="ud__checkbox">'
    '<input type="checkbox" class="ud__checkbox__input"/></span></label>'
    '<div class="ud__tree__node__label">{text}</div></div>'
)

# 触发控件（UD 把标签画在触发框容器里，input 只读、value 恒空）。
_UD_CONTROL = (
    '<input data-rf-index="14" class="ud__select__selector__search__input" '
    'readonly data-rect="944,450,552,36"/>'
)

# 残留弹层（atsx-select 关闭后 display:block 留在 DOM——真机取证）。
_ATSX_RESIDUE = """
<div class="atsx-select-dropdown atsx-select-theme-default" data-rect="932,499,600,92">
 <div class="atsx-select-dropdown-menu">
  <div class="atsx-select-dropdown-menu-item" data-rect="932,507,600,38">北京</div>
  <div class="atsx-select-dropdown-menu-item" data-rect="932,545,600,38">上海</div>
 </div>
</div>
"""

# 同一弹层的"点开前"形态：display:none（点击控件后才显示）。
_HIDDEN_DROPDOWN = (
    '<div class="ud__select__dropdown ud__select__dropdown-placement-bottomLeft" '
    'data-rect="944,470,552,208" style="display:none">{items}</div>'
)


def _page(control: str, *portals: str) -> str:
    return f"<!doctype html><html><body><div class='form'>{control}</div>{''.join(portals)}</body></html>"


def _run_jsdom(page: str, script: str) -> str:
    """在 jsdom 里执行一段页面脚本（与后端注入页面的方式一致），返回其返回值。"""
    if not _jsdom_available():  # pragma: no cover - 无 node 或缺前端依赖的环境跳过真 DOM 契约
        pytest.skip("node 或 frontend/node_modules/jsdom 不可用")
    runner = f"""
    const {{ JSDOM }} = require({json.dumps(str(FRONTEND_NODE_MODULES / 'jsdom').replace(chr(92), '/'))});
    const dom = new JSDOM({json.dumps(page)}, {{ runScripts: 'dangerously' }});
    const doc = dom.window.document;
    for (const el of doc.querySelectorAll('[data-rect]')) {{
      const [l, t, w, h] = el.getAttribute('data-rect').split(',').map(Number);
      el.getBoundingClientRect = () => ({{
        left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t,
      }});
    }}
    dom.window.scrollX = 0; dom.window.scrollY = 0;
    const out = dom.window.eval({json.dumps(script)});
    console.log(typeof out === 'string' ? out : JSON.stringify(out));
    """
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(runner)
        path = fh.name
    try:
        proc = subprocess.run(
            ["node", path], capture_output=True, text=True, timeout=60, encoding="utf-8"
        )
    finally:
        Path(path).unlink(missing_ok=True)
    assert proc.returncode == 0, f"jsdom 执行失败：{proc.stderr[:600]}"
    return proc.stdout.strip()


def _read_options(page: str, preexisting: list | None = None) -> tuple[list, list]:
    script = option_snapshot_script('[data-rf-index="14"]', "rf-guard", preexisting or [])
    payload = json.loads(_run_jsdom(page, script))
    return _parse_snapshot(payload)


def test_ud_list_dropdown_roots_and_options_are_found():
    """UD 列表弹层（无 role="option"）被通用 portal 发现，选项按行收集。"""
    items = "".join(_UD_LIST_ITEM.format(top=470 + i * 40, text=text) for i, text in
                    enumerate(("高中", "大专", "本科", "硕士", "博士")))
    page = _page(_UD_CONTROL, _UD_LIST_DROPDOWN.format(items=items))
    options, selectors = _read_options(page)

    assert [option.text for option in options] == ["高中", "大专", "本科", "硕士", "博士"]
    assert all(selector.startswith('[data-rf-option-token="rf-guard-') for selector in selectors)
    # token 打在行元素上且当刻可解析到（同一 jsdom 实例内完成）。
    probe = _probe(page, 2)
    assert "本科" in probe["text"]


def test_ud_tree_row_click_target_is_the_checkbox():
    """树形多选行（城市）：token 打在行内 checkbox 上，点行中心才真的勾选。"""
    items = "".join(_UD_TREE_NODE.format(top=560 + i * 40, text=text) for i, text in
                    enumerate(("北京", "上海", "深圳")))
    page = _page(_UD_CONTROL, _UD_TREE_DROPDOWN.format(items=items))
    options, _ = _read_options(page)
    assert [option.text for option in options] == ["北京", "上海", "深圳"]

    probe = _probe(page, 1)
    assert probe["tag"] == "input", "树行的点选目标必须是 checkbox，点行中心只是展开"


def _probe(page: str, index: int) -> dict:
    """同一次 jsdom 执行里：读选项 → 按 selector 找回 token 元素 → 报告其形态。

    jsdom 不实现 innerText，回读文本用 textContent（真弹层走的是真浏览器）。
    """
    # option_snapshot_script 的结果先算好再内插：f-string 表达式里不能出现
    # 反斜杠与外层引号复用（Python 3.10 的 f-string 语法限制，仓库下限）。
    snapshot_js = option_snapshot_script('[data-rf-index="14"]', "rf-guard", [])
    script = (
        "(() => {"
        f"const snap = JSON.parse(({snapshot_js}));"
        f"const el = document.querySelector(snap.options[{index}].selector);"
        "return JSON.stringify({text: (el.textContent||''), tag: el.tagName.toLowerCase()});"
        "})()"
    )
    return json.loads(_run_jsdom(page, script))


def test_preexisting_portal_is_excluded_by_temporal_rule():
    """时序排除：点击前就挂着的残留弹层不参与选项收集（传入它的文档坐标）。

    两阶段模拟点击前后：mark 时真弹层还藏著（display:none），点开后残留在
    PRE 里被排除、真弹层正常收集——两个 jsdom 实例靠 Python 侧传递的坐标
    序列衔接，与生产代码 mark → click → snapshot 的数据流一致。
    """
    items = "".join(_UD_LIST_ITEM.format(top=470 + i * 40, text=text) for i, text in
                    enumerate(("高中", "本科")))
    closed = _page(_UD_CONTROL, _ATSX_RESIDUE, _HIDDEN_DROPDOWN.format(items=items))
    preexisting = parse_preexisting(_run_jsdom(closed, mark_preexisting_script()))
    assert any(rect["w"] == 600 and rect["h"] == 92 for rect in preexisting), "mark 漏了残留弹层"
    assert not any(rect["h"] == 208 for rect in preexisting), "真弹层藏著时不应被 mark"

    opened = _page(_UD_CONTROL, _ATSX_RESIDUE, _UD_LIST_DROPDOWN.format(items=items))
    options, _ = _read_options(opened, preexisting)
    assert [option.text for option in options] == ["高中", "本科"], "残留弹层必须被时序排除"


def test_mark_and_snapshot_survive_round_trip_via_python():
    """mark 脚本返回值经 Python 解析再注入 JS 的往返契约（序列键名 l/t/w/h）。

    mark 记录**所有**类名含 dropdown 的可见元素（含弹层的 menu/menu-item 子层），
    这里断言弹层根的 rect 一定在其中。
    """
    residue = _ATSX_RESIDUE.replace('data-rect="932,499,600,92"', 'data-rect="1000,499,600,92"')
    page = _page(_UD_CONTROL, residue)
    rects = parse_preexisting(_run_jsdom(page, mark_preexisting_script()))
    assert any(rect == {"l": 1000.0, "t": 499.0, "w": 600.0, "h": 92.0} for rect in rects)


def test_duplicate_option_texts_are_deduped():
    """rc-virtual-list 重复渲染同名行：去重，不让严格解析卡死在 ambiguous。"""
    raw = {
        "ok": True,
        "options": [
            {"value": "上海", "text": "上海", "selector": "#a"},
            {"value": "shanghai", "text": "上海", "selector": "#b"},
            {"value": "北京", "text": "北京", "selector": "#c"},
        ],
    }
    options, selectors = _parse_snapshot(raw)
    assert [option.text for option in options] == ["上海", "北京"]
    assert selectors == ["#a", "#c"]


def test_already_selected_skips_click_for_toggle_rows():
    """预检：显示值已含期望值时不再点开弹层（树形 checkbox 重复点会取消勾选）。"""

    class _Client:
        def __init__(self, display):
            self.display = display
            self.evaluated = []

        def evaluate(self, expression, *, timeout=None):
            self.evaluated.append(expression)
            return self.display

    client = _Client("中国 - 居民身份证")
    assert _already_selected(client, "#idtype", "居民身份证", timeout=None) is True
    assert client.evaluated == [trigger_display_script("#idtype")], "已选中预检不应点开弹层"

    client = _Client("中国 - 护照")
    assert _already_selected(client, "#idtype", "居民身份证", timeout=None) is False

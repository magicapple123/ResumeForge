"""写入 / 回读 JS 构造器与 ``_PROTOTYPE_BY_TYPE``。"""
from __future__ import annotations

import json


def _set_value_script(
    selector: str, value: str, *, prototype: str, full_events: bool = False
) -> str:
    """给输入框赋值并触发 input/change（用原生 setter，绕开前端框架对 value 的拦截）。

    ``prototype`` 由调用方按控件类型给出——**这正是原先那个 bug 的根源**：类型搞错会抛
    ``Illegal invocation``，而且只有真跑 JS 才会暴露。

    写值前先 ``scrollIntoView`` + ``focus``：一部分组件只在获得焦点后才把值同步进内部
    状态，也有页面用 IntersectionObserver 判断"这个框真的被看到了"。``full_events=True``
    （重试路径）在最后补一个 ``blur``——有些站点把校验挂在 onblur 上；happy path 不发
    blur，它会触发站点校验提示，个别站点还会在 onblur 里清掉未通过校验的值。
    """
    lines = [
        "(() => { /* rf:set-value */\n",
        f"  const el = document.querySelector({json.dumps(selector)});\n",
        "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
        "  el.scrollIntoView({ block: 'center', behavior: 'instant' });\n",
        "  if (el.focus) { el.focus({ preventScroll: true }); }\n",
        f"  const setter = Object.getOwnPropertyDescriptor({prototype}.prototype, 'value').set;\n",
        f"  setter.call(el, {json.dumps(value)});\n",
        "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
        "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
    ]
    if full_events:
        lines.append("  if (el.blur) { el.blur(); }\n")
    lines.extend(
        [
            "  return JSON.stringify({ ok: true, value: String(el.value) });\n",
            "})()",
        ]
    )
    return "".join(lines)


def _select_option_script(selector: str, option_value: str) -> str:
    """把 ``<select>`` 选到指定选项上。

    候选值由 Python 从快照里的真实 ``option.value`` 算出来，这里**不做任何判断**。
    单选用 ``HTMLSelectElement`` 的 value setter（对 ``<option value="3">`` 这类必须按
    value 而不是文本设置）；多选逐个置 ``selected``，不清空用户已有的其他选择。
    """
    return "".join(
        [
            "(() => { /* rf:select-option */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  const wanted = {json.dumps(option_value)};\n",
            "  if (el.multiple) {\n",
            "    let hit = false;\n",
            "    for (const option of el.options) { if (option.value === wanted) { option.selected = true; hit = true; } }\n",
            "    if (!hit) { return JSON.stringify({ ok: false, reason: 'no_option' }); }\n",
            "  } else {\n",
            "    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;\n",
            "    setter.call(el, wanted);\n",
            "    if (el.value !== wanted) { return JSON.stringify({ ok: false, reason: 'no_option' }); }\n",
            "  }\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
            "  const picked = el.selectedOptions && el.selectedOptions[0];\n",
            "  return JSON.stringify({ ok: true, value: String(el.value), display: picked ? (picked.textContent || '').trim() : '' });\n",
            "})()",
        ]
    )


def _read_select_options_script(selector: str) -> str:
    """读取当前页面里的原生 ``<select>`` 选项。

    联动下拉在首次读取表单时经常只有「请选择」一个占位项；父级选择完成后，
    子级选项才会异步出现。这里重新读取**当前 DOM**，而不是复用旧快照里的空列表。
    这个脚本只读原生 select，不碰自定义弹层/级联组件。
    """
    return "".join(
        [
            "(() => { /* rf:select-options */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el || el.tagName.toLowerCase() !== 'select') { return JSON.stringify({ ok: false, reason: 'no_select' }); }\n",
            "  return JSON.stringify({ ok: true, options: [...el.options].map((o) => ({ v: String(o.value), t: (o.textContent || '').trim(), d: o.disabled === true })) });\n",
            "})()",
        ]
    )


def _set_richtext_script(selector: str, value: str, *, full_events: bool = False) -> str:
    """contenteditable 富文本：写 textContent 并派发 input/change。

    与文本类同样的滚入视口 + 聚焦；``change`` 此前漏发——只发 ``input`` 会让
    "提交时读 change 才同步的编辑器"读到空值。``full_events`` 同 ``_set_value_script``。
    """
    lines = [
        "(() => { /* rf:set-richtext */\n",
        f"  const el = document.querySelector({json.dumps(selector)});\n",
        "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
        "  el.scrollIntoView({ block: 'center', behavior: 'instant' });\n",
        "  if (el.focus) { el.focus({ preventScroll: true }); }\n",
        f"  el.textContent = {json.dumps(value)};\n",
        "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
        "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
    ]
    if full_events:
        lines.append("  if (el.blur) { el.blur(); }\n")
    lines.extend(
        [
            "  return JSON.stringify({ ok: true });\n",
            "})()",
        ]
    )
    return "".join(lines)


def _read_back_script(selector: str, *, rich: bool = False) -> str:
    """回读控件的当前值，用于填充后校验"看起来填了、其实没进去"。

    ``rich=True``（contenteditable）读 ``textContent``：富文本元素没有 ``value``
    属性，读 ``el.value`` 恒为空串——富文本框填完会被判成 ``unverified``，
    与真实结果无关。

    UD Design 一类的自定义下拉把显示值画在触发框容器里，input 的 ``value``
    恒为空——``value`` 为空时（**不限只读**，过滤型 combobox 的 input 可写但
    选中值同样不在 ``value`` 里）从父节点向上找**第一个显示文本非空的祖先**
    （最多 5 层，即组件容器），把它的文本放进 ``display``，判定层用它做包含
    比对（真机取证 2026-10-06 字节页：点选成功后 input.value 仍是 ''，显示
    文本是「中国 - 居民身份证」）。不能用 ``closest('[class*="select"]')``——
    UD 的类名层层都含 "select" 字样，最近祖先命中 innerText 恒空的 search
    容器。
    """
    value_expr = (
        "String(el.textContent == null ? '' : el.textContent).trim()"
        if rich
        else "String(el.value == null ? '' : el.value)"
    )
    display_expr = (
        "(selected.textContent || '').trim()"
        if rich
        else (
            "selected ? (selected.textContent || '').trim() : boxText"
        )
    )
    box_read = (
        ""
        if rich
        else (
            "  if (!String(el.value == null ? '' : el.value)) {\n"
            "    let node = el.parentElement;\n"
            "    for (let i = 0; i < 5 && node; i++) {\n"
            "      const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();\n"
            "      if (text) { boxText = text; break; }\n"
            "      node = node.parentElement;\n"
            "    }\n"
            "  }\n"
        )
    )
    return "".join(
        [
            "(() => { /* rf:read-back */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            "  const selected = el.tagName.toLowerCase() === 'select' && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;\n",
            "  let boxText = '';\n",
            box_read,
            "  return JSON.stringify({\n",
            "    ok: true,\n",
            f"    value: {value_expr},\n",
            f"    display: {display_expr},\n",
            "    checked: el.checked === true,\n",
            "  });\n",
            "})()",
        ]
    )


# 控件类型 → 原生 setter 所在的接口。``select`` 与 ``textarea`` 各走自己的接口，
# 其余（含 date/month/email/tel/number）都是 ``HTMLInputElement``。
_PROTOTYPE_BY_TYPE = {
    "textarea": "HTMLTextAreaElement",
    "richtext": "HTMLElement",
}

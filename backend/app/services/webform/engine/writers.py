"""写入 / 回读 JS 构造器与 ``_PROTOTYPE_BY_TYPE``。"""
from __future__ import annotations

import json

def _set_value_script(selector: str, value: str, *, prototype: str) -> str:
    """给输入框赋值并触发 input/change（用原生 setter，绕开前端框架对 value 的拦截）。

    ``prototype`` 由调用方按控件类型给出——**这正是原先那个 bug 的根源**：类型搞错会抛
    ``Illegal invocation``，而且只有真跑 JS 才会暴露。
    """
    return "".join(
        [
            "(() => { /* rf:set-value */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  const setter = Object.getOwnPropertyDescriptor({prototype}.prototype, 'value').set;\n",
            f"  setter.call(el, {json.dumps(value)});\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
            "  return JSON.stringify({ ok: true, value: String(el.value) });\n",
            "})()",
        ]
    )


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


def _set_richtext_script(selector: str, value: str) -> str:
    return "".join(
        [
            "(() => { /* rf:set-richtext */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  el.textContent = {json.dumps(value)};\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  return JSON.stringify({ ok: true });\n",
            "})()",
        ]
    )


def _read_back_script(selector: str) -> str:
    """回读控件的当前值，用于填充后校验"看起来填了、其实没进去"。"""
    return "".join(
        [
            "(() => { /* rf:read-back */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            "  const selected = el.tagName.toLowerCase() === 'select' && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;\n",
            "  return JSON.stringify({\n",
            "    ok: true,\n",
            "    value: String(el.value == null ? '' : el.value),\n",
            "    display: selected ? (selected.textContent || '').trim() : '',\n",
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

"""custom_select 的 JS 页面协议脚本资源。

与 ``engine/scripts.py`` 同等待遇：主体是注入页面的 JS 字符串（弹层根发现、
选项读取、虚拟列表滚动、输入过滤、确认按钮），逐字符协议契约由 canary 测试
钉死，Python 编排留在 ``custom_select.py``。
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

# 多选弹层的确认按钮文案（先勾多个再点确定提交的那类形态）。
_CONFIRM_TEXTS = ("确定", "确认", "完成", "ok")

# 位置判定容差（px）：弹层打开前后 rect 相差不超过这个数才算"没动"。
_RECT_TOLERANCE = 6

# 「点击前就在页面上」的浮层时序排除（见 mark_preexisting_script 与 _pre_js）。
#
# 为什么用文档坐标（left+scrollX / top+scrollY）：fill 时 click_selector 会先把控件
# scrollIntoView，页面一滚动，absolute 定位的残留弹层（真机取证：字节页 atsx-select
# 关闭后仍 display:block 留在 DOM）的**视口** rect 就变了——拿视口坐标比对会误判成
# "弹层重新定位了"而放过它；文档坐标对 fixed 与 absolute 定位都是滚动不变量。
# 为什么由 Python 持有坐标序列再注入 JS，而不是打在 DOM 属性上：点击控件会触发
# 站点 React 重渲染，portal 弹层节点可能被重建，DOM 属性会凭空丢失。


def _pre_js(preexisting: Sequence[dict[str, float]]) -> str:
    """把"点击前就在页面上"的浮层文档坐标序列注入 JS 常量 ``PRE``。"""
    return f"const PRE={json.dumps(preexisting)};"


_PRE_IN_PAGE_JS = (
    "const rectOf=(el)=>{const r=el.getBoundingClientRect();"
    "return {l:r.left+window.scrollX,t:r.top+window.scrollY,w:r.width,h:r.height};};"
)

# 时序排除判定（_ROOTS_JS 的 portal 分支内用）：当前文档坐标与 PRE 里某条吻合 = 没动过。
_PRE_SKIP_JS = (
    "const r0=rectOf(el);"
    f"if(PRE.some((p)=>Math.abs(r0.l-p.l)<{_RECT_TOLERANCE}&&Math.abs(r0.t-p.t)<{_RECT_TOLERANCE}"
    f"&&Math.abs(r0.w-p.w)<{_RECT_TOLERANCE}&&Math.abs(r0.h-p.h)<{_RECT_TOLERANCE}))continue;"
)

# 弹层根与滚动/过滤共用的 JS 前缀：三种根来源，从强到弱。
# 1. aria 声明（站点自己说的）；
# 2. 可见 role="listbox"（antd / Semi / 原生形态）；
# 3. **通用开放 portal**（字节 UD 等挂在 body 的自研弹层）：类名含 dropdown/popover/popup
#    的可见浮层，按「横向重叠过半 + 纵向贴近（弹层贴着控件上/下缘展开）+ 不包含控件」
#    判定属于当前控件——门户选择器必须带位置邻近判定，否则页面上别人的浮层也会混进来。
#    另有一条时序排除（真机实测 2026-10-06，字节页）：**点击控件之前就已在页面上、
#    且位置没动过的浮层不算数**；而"单例 portal 复用"的库换控件时会把弹层重新定位，
#    文档 rect 一变就不再是"没动过"，不会误伤。
_ROOTS_JS = (
    "const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return !!(r.width&&r.height)&&s.display!=='none'&&s.visibility!=='hidden';};"
    + _PRE_IN_PAGE_JS
    + "const findRoots=(control)=>{"
    "const roots=[];const seen=new Set();"
    "const push=(el)=>{if(el&&!seen.has(el)){seen.add(el);roots.push(el);}};"
    "const ids=((control.getAttribute('aria-controls')||control.getAttribute('aria-owns')||'').trim().split(/\\s+/)).filter(Boolean);"
    "ids.map((id)=>document.getElementById(id)).filter((el)=>el&&visible(el)).forEach(push);"
    "[...document.querySelectorAll('[role=\"listbox\"]')].filter(visible).forEach(push);"
    "const cr=control.getBoundingClientRect();"
    "for(const el of document.querySelectorAll('[class*=\"dropdown\"],[class*=\"popover\"],[class*=\"popup\"]')){"
    "if(!visible(el)||el.contains(control))continue;"
    + _PRE_SKIP_JS
    + "const r=el.getBoundingClientRect();"
    "const overlap=Math.min(r.right,cr.right)-Math.max(r.left,cr.left);"
    "if(overlap<Math.min(r.width,cr.width)*0.5)continue;"
    "if(r.top>cr.bottom+80||r.bottom<cr.top-80)continue;"
    "push(el);}"
    "return roots;};"
    "const collectOptions=(roots)=>{"
    "const raw=[];"
    # 选项行选择器：role="option" / 原生 option / 类名含 option、list__item、menu-item、
    # dropdown__item、cascader-node、select-option、option-item（Element UI、UD、Semi、antd），
    # 以及 tree__node / tree-node——UD 的城市多选是树形弹层
    # （真机取证 2026-10-06 字节页：行元素是 ud__tree__node，无 role="option"）。
    "for(const root of roots){"
    "for(const el of [...root.querySelectorAll('[role=\"option\"],option,[class*=\"option\"],[class*=\"list__item\"],[class*=\"menu-item\"],[class*=\"dropdown__item\"],[class*=\"cascader-node\"],[class*=\"select-option\"],[class*=\"option-item\"],[class*=\"tree__node\"],[class*=\"tree-node\"]')].filter(visible)){"
    "raw.push(el);}}"
    "const kept=raw.filter((el)=>!raw.some((o)=>o!==el&&o.contains(el)));"
    "return kept;};"
)


def mark_preexisting_script() -> str:
    """记录"此刻已在页面上"的可见浮层的文档坐标，返回 ``JSON 数组`` 字符串。

    在点开控件**之前**执行：关闭后仍残留 display:block 的弹层（真机取证：
    atsx-select）会被 findRoots 的时序排除跳过；真弹层在点击后才出现，或由
    单例 portal 重新定位（文档 rect 变了），都不受影响。
    """
    return (
        "(() => { /* rf:combobox-mark */"
        "const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return !!(r.width&&r.height)&&s.display!=='none'&&s.visibility!=='hidden';};"
        "const rectOf=(el)=>{const r=el.getBoundingClientRect();"
        "return {l:r.left+window.scrollX,t:r.top+window.scrollY,w:r.width,h:r.height};};"
        "return JSON.stringify([...document.querySelectorAll('[class*=\"dropdown\"],[class*=\"popover\"],[class*=\"popup\"]')]"
        ".filter(visible).map(rectOf));})()"
    )


def parse_preexisting(payload: Any) -> list[dict[str, float]]:
    """解析 mark_preexisting_script 的返回；形态不对就当空（只少一层排除）。"""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return []
    if not isinstance(payload, list):
        return []
    rects: list[dict[str, float]] = []
    for item in payload:
        if isinstance(item, dict) and {"l", "t", "w", "h"} <= set(item):
            rects.append({key: float(item[key]) for key in ("l", "t", "w", "h")})
    return rects


def option_snapshot_script(
    selector: str, marker: str, preexisting: Sequence[dict[str, float]]
) -> str:
    return (
        "(() => { /* rf:combobox-options */"
        f"const control=document.querySelector({json.dumps(selector)});"
        "if(!control){return JSON.stringify({ok:false,reason:'no_control',options:[]});}"
        + _pre_js(preexisting)
        + _ROOTS_JS
        + f"const marker={json.dumps(marker)};"
        "const options=collectOptions(findRoots(control)).map((el,index)=>{"
        "const token=marker+'-'+index;"
        # 树形多选行（ud__tree__node 一类）：点击行中心只是展开/无效果，勾选目标是
        # 行内的 checkbox/radio（真机取证 2026-10-06 字节页城市树：点行不勾、点
        # checkbox 即选且无确定按钮）。有 input 时 token 打在 input 上。
        "const clickTarget=el.querySelector('input[type=\"checkbox\"]:not(:disabled),input[type=\"radio\"]:not(:disabled)')||el;"
        "clickTarget.setAttribute('data-rf-option-token',token);"
        "const text=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();"
        "return {value:String(el.value||el.getAttribute('data-value')||text),text,disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true',selector:'[data-rf-option-token=\"'+token+'\"]'};})"
        ".filter((item)=>item.text&&!item.disabled);"
        "return JSON.stringify({ok:true,options});})()"
    )


def scroll_options_script(selector: str, preexisting: Sequence[dict[str, float]]) -> str:
    """把弹层里的虚拟列表向前滚一屏（滚到底就回到顶部，供外层按"无新行"终止）。

    rc-virtual-list 的滚动容器是 `.rc-virtual-list-holder`；兜底再找任何
    overflowY 可滚的后代。rc-virtual-list 监听 scroll 同步重渲染，外层在
    滚动后重读选项即可拿到新行。
    """
    return (
        "(() => { /* rf:combobox-scroll */"
        f"const control=document.querySelector({json.dumps(selector)});"
        "if(!control){return '0';}"
        + _pre_js(preexisting)
        + _ROOTS_JS
        + "const holders=[];"
        "for(const root of findRoots(control)){"
        "for(const el of [...root.querySelectorAll('.rc-virtual-list-holder,[class*=\"virtual-list\"] [class*=\"holder\"]')]){"
        "if(el.scrollHeight>el.clientHeight+2){holders.push(el);}}}"
        "if(!holders.length){"
        "for(const root of findRoots(control)){"
        "for(const el of [...root.querySelectorAll('*')]){"
        "if(el.scrollHeight>el.clientHeight+4&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)){holders.push(el);break;}}}}"
        "let moved=0;"
        "for(const holder of holders){"
        "if(holder.scrollTop+holder.clientHeight>=holder.scrollHeight-1){holder.scrollTop=0;}"
        "else{holder.scrollTop+=Math.max(holder.clientHeight*0.8,40);moved++;}}"
        "return moved?'1':'0';})()"
    )


def filter_input_script(selector: str, text: str) -> str:
    """把可输入的触发框（combobox 的过滤框）值改成目标文本并派发 input 事件。

    UD/antd 的过滤框就是触发控件里的一个非只读 input（字节页实测：区号与意向城市的
    触发框可直接过滤；证件类型/学历的框是 readonly，跳过这条路）。React 受控组件
    要走 native setter 才能触发 onChange。
    """
    return (
        "(() => { /* rf:combobox-filter */"
        f"const control=document.querySelector({json.dumps(selector)});"
        "if(!control){return '0';}"
        "const input=control.tagName==='INPUT'&&!control.readOnly"
        "?control:(control.querySelector('input:not([readonly]):not([type=\"hidden\"])'));"
        "if(!input||input.readOnly){return '0';}"
        "const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
        "setter.call(input,'');"
        "input.dispatchEvent(new Event('input',{bubbles:true}));"
        f"setter.call(input,{json.dumps(text)});"
        "input.dispatchEvent(new Event('input',{bubbles:true}));"
        "return '1';})()"
    )


def trigger_display_script(selector: str) -> str:
    """读触发框**当前显示值**（不点开弹层）。

    与 writers._read_back_script 的容器文本同法：value 空、只读或为空时向上找
    第一个显示文本非空的祖先（最多 5 层）。用于点选前的"已选中就跳过"预检——
    树形多选的 checkbox 是 toggle，重复点会把已选中的值取消掉。
    """
    return (
        "(() => { /* rf:combobox-current */"
        f"const el=document.querySelector({json.dumps(selector)});"
        "if(!el){return '';}"
        "if(!String(el.value==null?'':el.value)){"
        "let node=el.parentElement;"
        "for(let i=0;i<5&&node;i++){"
        "const t=(node.innerText||'').replace(/\\s+/g,' ').trim();"
        "if(t){return t;}"
        "node=node.parentElement;}"
        "return '';}"
        "return String(el.value);})()"
    )


def confirm_script(selector: str, preexisting: Sequence[dict[str, float]]) -> str:
    """在点开的弹层里点一次「确定」（多选弹层"先勾多个再提交"的形态）。

    **尽力而为**：即点即选形态的弹层没有确定按钮，脚本返回 0，调用方忽略——
    是否真的选中了由调用方的回读验证说话，这里不猜。
    """
    return (
        "(() => { /* rf:combobox-confirm */"
        f"const control=document.querySelector({json.dumps(selector)});"
        "if(!control){return '0';}"
        + _pre_js(preexisting)
        + _ROOTS_JS
        + f"const words={json.dumps(list(_CONFIRM_TEXTS))};"
        "for(const root of findRoots(control)){"
        "for(const el of [...root.querySelectorAll('button,[role=\"button\"]')]){"
        "if(!visible(el))continue;"
        "const text=(el.innerText||el.textContent||'').replace(/\\s+/g,'').toLowerCase();"
        "if(words.includes(text)){el.click();return '1';}}}"
        "return '0';})()"
    )


def cleanup_script(marker: str) -> str:
    return (
        "(() => { /* rf:combobox-cleanup */"
        f"const marker={json.dumps(marker)};"
        "document.querySelectorAll('[data-rf-option-token]').forEach((el)=>{if(el.getAttribute('data-rf-option-token').startsWith(marker+'-'))el.removeAttribute('data-rf-option-token');});"
        "return '1';})()"
    )


__all__ = [
    "cleanup_script",
    "confirm_script",
    "filter_input_script",
    "mark_preexisting_script",
    "option_snapshot_script",
    "parse_preexisting",
    "scroll_options_script",
]

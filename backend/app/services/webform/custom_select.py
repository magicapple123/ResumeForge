"""Read and select options from accessible custom combobox popups."""

from __future__ import annotations

import json
import time
from uuid import uuid4
from typing import Any

from ..browser.cdp_client import CdpClient
from ..browser.interaction import click_selector
from .matching import SelectOption, SelectResolution, resolve_select_option

_WAIT_SECONDS = 1.5
_POLL_SECONDS = 0.08


def _option_snapshot_script(selector: str, marker: str) -> str:
    return (
        "(() => { /* rf:combobox-options */"
        f"const control=document.querySelector({json.dumps(selector)});"
        "if(!control){return JSON.stringify({ok:false,reason:'no_control',options:[]});}"
        "const visible=(el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return !!(r.width&&r.height)&&s.display!=='none'&&s.visibility!=='hidden';};"
        "const ids=((control.getAttribute('aria-controls')||control.getAttribute('aria-owns')||'').trim().split(/\\s+/)).filter(Boolean);"
        "const roots=ids.map((id)=>document.getElementById(id)).filter((el)=>el&&visible(el));"
        "const listboxes=[...document.querySelectorAll('[role=\"listbox\"]')].filter(visible);"
        "if(!roots.length&&listboxes.length)roots.push(listboxes[listboxes.length-1]);"
        "const nodes=[];const seen=new Set();for(const root of roots){for(const el of [...root.querySelectorAll('[role=\"option\"],option')].filter(visible)){if(!seen.has(el)){seen.add(el);nodes.push(el);}}}"
        f"const marker={json.dumps(marker)};"
        "const options=nodes.map((el,index)=>{const token=marker+'-'+index;el.setAttribute('data-rf-option-token',token);const text=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();return {value:String(el.value||el.getAttribute('data-value')||text),text,disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true',selector:'[data-rf-option-token=\"'+token+'\"]'};}).filter((item)=>item.text&&!item.disabled);"
        "return JSON.stringify({ok:true,options});})()"
    )


def _cleanup_script(marker: str) -> str:
    return (
        "(() => { /* rf:combobox-cleanup */"
        f"const marker={json.dumps(marker)};"
        "document.querySelectorAll('[data-rf-option-token]').forEach((el)=>{if(el.getAttribute('data-rf-option-token').startsWith(marker+'-'))el.removeAttribute('data-rf-option-token');});"
        "return '1';})()"
    )


def _parse_snapshot(payload: Any) -> tuple[list[SelectOption], list[str]]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return [], []
    if not isinstance(payload, dict) or not payload.get('ok'):
        return [], []
    options: list[SelectOption] = []
    selectors: list[str] = []
    for item in payload.get('options', []):
        if not isinstance(item, dict):
            continue
        text = str(item.get('text') or '').strip()
        if not text or item.get('disabled') is True:
            continue
        options.append(SelectOption(str(item.get('value') or text), text))
        selectors.append(str(item.get('selector') or ''))
    return options, selectors


def select_combobox_option(
    client: CdpClient, selector: str, value: str, *, timeout: float | None = None
) -> SelectResolution:
    """Open a custom combobox, resolve one unique option, then click it as a user would."""
    if not click_selector(client, selector, timeout=timeout):
        return SelectResolution('no_option', reason='自定义下拉控件不可见或无法点击')

    marker = f'rf-{uuid4().hex}'
    deadline = time.monotonic() + min(_WAIT_SECONDS, max(timeout, 0.0) if timeout is not None else _WAIT_SECONDS)
    options: list[SelectOption] = []
    selectors: list[str] = []
    try:
        while True:
            payload = client.evaluate(_option_snapshot_script(selector, marker), timeout=timeout)
            options, selectors = _parse_snapshot(payload)
            if options or time.monotonic() >= deadline:
                break
            time.sleep(_POLL_SECONDS)

        resolution = resolve_select_option(options, value)
        if resolution.status != 'matched' or resolution.option is None:
            return resolution
        try:
            option_index = options.index(resolution.option)
        except ValueError:
            return SelectResolution('no_option', reason='下拉选项在读取后发生变化，请重新读取表单')
        if option_index >= len(selectors) or not selectors[option_index]:
            return SelectResolution('no_option', reason='无法定位匹配的下拉选项')
        if not click_selector(client, selectors[option_index], timeout=timeout):
            return SelectResolution('no_option', reason='匹配选项已消失或不可见，请重新读取表单')
        return resolution
    finally:
        try:
            client.evaluate(_cleanup_script(marker), timeout=timeout)
        except Exception:  # noqa: BLE001 - popup navigation may remove its nodes
            pass


__all__ = ['select_combobox_option']

"""Read and select options from accessible custom combobox popups.

弹层家族与形态（真机取证 2026-10-06，字节自研 UD Design 页）：

- **aria 声明 / 原生 listbox**（Semi Design、antd 新版、原生 select）：`aria-controls` /
  `aria-owns` / `[role="option"]`；
- **UD Design**（字节 ats）：弹层 portal 挂在 body（`ud__select__dropdown`），内部
  `ud__select__list → ud__select__list__menu → rc-virtual-list`，选项行是
  `ud__select__list__item`，**没有 role="option"**；
- **通用开放 portal**：任何类名含 dropdown/popover 的可见浮层，按「与控件横向重叠过半 +
  纵向贴近 + 不包含控件 + 时序排除（点击前就存在的浮层不算数）」判定归属；
- **rc-virtual-list 虚拟化**：长列表只渲染可视行——先读当前可见的，读不到时优先
  「输入过滤」（触发框可输入时键入目标文本），再不行逐屏滚动虚拟列表加载。

JS 页面协议脚本在 ``custom_select_scripts.py``；本模块只做 Python 编排。
"""

from __future__ import annotations

import json
import re
import time
from uuid import uuid4
from typing import Any, Sequence

from ..browser.cdp_client import CdpClient
from ..browser.interaction import click_selector
from .custom_select_scripts import (
    cleanup_script,
    confirm_script,
    filter_input_script,
    mark_preexisting_script,
    option_snapshot_script,
    parse_preexisting,
    trigger_display_script,
)
from .matching import (
    SelectOption,
    SelectResolution,
    normalize_option_text,
    resolve_select_option,
)

_WAIT_SECONDS = 1.5
_POLL_SECONDS = 0.08

# 多值分隔符：资料里「上海、北京、广州」这类写法按它拆开逐个匹配。
# **不收 "/"**——URL 与"和/或"类值里太常见，拆错了比不拆更糟。
_MULTI_VALUE_SEPARATOR = re.compile(r"\s*[、，,;；]\s*")

# 虚拟列表滚动加载的步数上限（每步约一屏，30 步足够覆盖几百项的城市列表）。
_MAX_SCROLL_STEPS = 30


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
    seen_texts: set[str] = set()
    for item in payload.get('options', []):
        if not isinstance(item, dict):
            continue
        text = str(item.get('text') or '').strip()
        if not text or item.get('disabled') is True:
            continue
        if text in seen_texts:
            # 同名条目去重（真机取证：rc-virtual-list 底部溢出行、组件重复渲染）。
            # 文本相同就是同一个选项，选哪个都符合用户意图——不去重会把严格解析
            # 卡死在 ambiguous 上。
            continue
        seen_texts.add(text)
        options.append(SelectOption(str(item.get('value') or text), text))
        selectors.append(str(item.get('selector') or ''))
    return options, selectors


def _read_visible_options(
    client: CdpClient,
    selector: str,
    marker: str,
    *,
    timeout: float | None,
    preexisting: Sequence[dict[str, float]] = (),
) -> tuple[list[SelectOption], list[str]]:
    payload = client.evaluate(
        option_snapshot_script(selector, marker, preexisting), timeout=timeout
    )
    return _parse_snapshot(payload)


def _try_click(
    client: CdpClient,
    options: Sequence[SelectOption],
    selectors: Sequence[str],
    resolution: SelectResolution,
    *,
    timeout: float | None,
) -> str | None:
    """点选已解析的选项；失败返回原因，成功返回 ``None``。"""
    if resolution.option is None:
        return "解析结果里没有选项"
    try:
        option_index = options.index(resolution.option)
    except ValueError:
        return "下拉选项在读取后发生变化，请重新读取表单"
    if option_index >= len(selectors) or not selectors[option_index]:
        return "无法定位匹配的下拉选项"
    if not click_selector(client, selectors[option_index], timeout=timeout):
        return "匹配选项已消失或不可见，请重新读取表单"
    return None


def _locate_by_scrolling(
    client: CdpClient,
    selector: str,
    marker: str,
    value: str,
    *,
    timeout: float | None,
    preexisting: Sequence[dict[str, float]] = (),
) -> SelectResolution | None:
    """虚拟列表滚动加载：逐屏滚动并重读，找到目标就地点选；扫完仍没有返回 ``None``。

    token 在采集当刻仍然有效（下一步滚动之前就点），不存在"点了过期节点"的问题。
    """
    seen: set[str] = set()
    for _step in range(_MAX_SCROLL_STEPS):
        time.sleep(_POLL_SECONDS)
        options, selectors = _read_visible_options(
            client, selector, marker, timeout=timeout, preexisting=preexisting
        )
        fresh = [option for option in options if option.text not in seen]
        if not fresh:
            return None
        for option in fresh:
            seen.add(option.text)
        resolution = resolve_select_option(options, value)
        if resolution.status == "matched":
            failure = _try_click(client, options, selectors, resolution, timeout=timeout)
            if failure is None:
                return resolution
    return None


def _filterable(client: CdpClient, selector: str, value: str, *, timeout: float | None) -> bool:
    """触发框可输入时键入目标文本缩小选项范围；不可输入返回 ``False``。"""
    try:
        payload = client.evaluate(filter_input_script(selector, value), timeout=timeout)
    except Exception:  # noqa: BLE001 - 过滤失败就退回滚动加载
        return False
    return payload == "1"


def _open_and_read_options(
    client: CdpClient, selector: str, *, timeout: float | None
) -> tuple[list[SelectOption], list[str], str, list[dict[str, float]]]:
    """点开弹层并轮询读选项，返回 ``(选项, 选项定位符, marker, 点击前浮层序列)``。

    单选与多值代选共用这一段——两份轮询实现迟早会分叉。点击**之前**先记录页面上
    已存在的浮层（文档坐标），后续读选项、滚动、确认都带上这份序列做时序排除。
    """
    preexisting: list[dict[str, float]] = []
    try:
        preexisting = parse_preexisting(
            client.evaluate(mark_preexisting_script(), timeout=timeout)
        )
    except Exception:  # noqa: BLE001 - 记录失败只是少一层排除，继续走
        pass
    if not click_selector(client, selector, timeout=timeout):
        return [], [], "", preexisting
    marker = f"rf-{uuid4().hex}"
    deadline = time.monotonic() + min(_WAIT_SECONDS, max(timeout, 0.0) if timeout is not None else _WAIT_SECONDS)
    options: list[SelectOption] = []
    selectors: list[str] = []
    while True:
        options, selectors = _read_visible_options(
            client, selector, marker, timeout=timeout, preexisting=preexisting
        )
        if options or time.monotonic() >= deadline:
            break
        time.sleep(_POLL_SECONDS)
    return options, selectors, marker, preexisting


def _cleanup(client: CdpClient, marker: str, *, timeout: float | None = None) -> None:
    if not marker:
        return
    try:
        client.evaluate(cleanup_script(marker), timeout=timeout)
    except Exception:  # noqa: BLE001 - popup navigation may remove its nodes
        pass


def _already_selected(
    client: CdpClient, selector: str, value: str, *, timeout: float | None
) -> bool:
    """触发框的当前显示值已经是期望值吗（**不点开弹层**的预检）。

    树形多选的 checkbox 是 **toggle**：控件已经有期望值时再点一次会把勾选取消
    （真机取证 2026-10-06 字节页城市树），重试路径尤其会踩——上一轮"点了但
    回读没过"、这一轮再点，值反而被清掉。显示值里含期望值即视为已选中
    （UD 的显示是「中国 - 居民身份证」这类"前缀 - 枚举值"拼法）。
    """
    try:
        current = str(client.evaluate(trigger_display_script(selector), timeout=timeout) or "")
    except Exception:  # noqa: BLE001 - 预检失败就照常走点选流程
        return False
    target = normalize_option_text(value)
    page = normalize_option_text(current)
    return bool(target) and target in page


def select_combobox_option(
    client: CdpClient, selector: str, value: str, *, timeout: float | None = None
) -> SelectResolution:
    """Open a custom combobox, resolve one unique option, then click it as a user would.

    首读命不中时按「输入过滤 → 虚拟滚动」两步兜底——UD 的长列表（城市）只有可视行
    在 DOM 里，光靠首读永远找不到列表下方的选项。
    """
    if _already_selected(client, selector, value, timeout=timeout):
        return SelectResolution("matched", option=SelectOption(value=value, text=value))
    options, selectors, marker, preexisting = _open_and_read_options(
        client, selector, timeout=timeout
    )
    try:
        if not options:
            # 区分两种"没有选项"：控件没点开 vs 点开了但弹层里没有可选项。
            if not marker:
                return SelectResolution("no_option", reason="自定义下拉控件不可见或无法点击")
            return SelectResolution("no_option", reason="自定义下拉里没有可选项")
        resolution = resolve_select_option(options, value)
        if resolution.status == "ambiguous":
            # 首读就有多个匹配，滚动只会看到同样的重复项——如实交给用户。
            return resolution
        click_failure: str | None = None
        if resolution.status == "matched":
            click_failure = _try_click(client, options, selectors, resolution, timeout=timeout)
            if click_failure is None:
                _confirm_if_any(client, selector, preexisting, timeout=timeout)
                return resolution
        # 兜底一：输入过滤（可输入的 combobox）。过滤后重读，命不中再滚动。
        if _filterable(client, selector, value, timeout=timeout):
            options, selectors = _read_visible_options(
                client, selector, marker, timeout=timeout, preexisting=preexisting
            )
            resolution = resolve_select_option(options, value)
            if resolution.status == "matched":
                click_failure = _try_click(client, options, selectors, resolution, timeout=timeout)
                if click_failure is None:
                    _confirm_if_any(client, selector, preexisting, timeout=timeout)
                    return resolution
        # 兜底二：虚拟列表滚动加载。
        if located := _locate_by_scrolling(
            client, selector, marker, value, timeout=timeout, preexisting=preexisting
        ):
            _confirm_if_any(client, selector, preexisting, timeout=timeout)
            return located
        if click_failure is not None:
            return SelectResolution("no_option", reason=click_failure)
        return resolution
    finally:
        _cleanup(client, marker, timeout=timeout)


def select_combobox_options(
    client: CdpClient, selector: str, values: Sequence[str], *, timeout: float | None = None
) -> SelectResolution:
    """多值代选：点开**一次**弹层，逐个匹配并点选，全部命中才动手。

    **任一不命中整体放弃**，原因里如实报缺的是哪一个——选了一半发现缺一项，留下的是
    "选了一半"的状态，比不选更难收拾。每个值仍走 ``resolve_select_option`` 的严格口径
    （精确 → 别名 → 包含，多候选 ``ambiguous`` 不猜）。

    虚拟列表下的让步（真机实测 rc-virtual-list 只渲染可视行）：首读命中不全时改为
    **逐值**定位——优先输入过滤，其次滚动加载，找到即点（选中态在组件内部持久，
    不随行被虚拟化回收）；若最终仍缺某一项，如实报缺哪个，此时**可能已经点上前面
    几个值**——半选状态由回读验证如实上报，不假装成功。点完若有「确定」按钮尽力点
    一次（没有就忽略）。
    """
    if not values:
        return SelectResolution("empty", reason="没有值可填")
    options, selectors, marker, preexisting = _open_and_read_options(
        client, selector, timeout=timeout
    )
    try:
        if not options:
            if not marker:
                return SelectResolution("no_option", reason="自定义下拉控件不可见或无法点击")
            return SelectResolution("no_option", reason="自定义下拉里没有可选项")

        # 快路径：全部值在首读里就齐了——保持严格的全或无语义。
        matched: list[tuple[SelectOption, str]] = []
        for value in values:
            resolution = resolve_select_option(options, value)
            if resolution.status != "matched" or resolution.option is None:
                matched = []
                break
            try:
                option_index = options.index(resolution.option)
            except ValueError:
                return SelectResolution("no_option", reason="下拉选项在读取后发生变化，请重新读取表单")
            if option_index >= len(selectors) or not selectors[option_index]:
                return SelectResolution("no_option", reason="无法定位匹配的下拉选项")
            matched.append((resolution.option, selectors[option_index]))
        if matched:
            for option, option_selector in matched:
                if not click_selector(client, option_selector, timeout=timeout):
                    return SelectResolution("no_option", reason="匹配选项已消失或不可见，请重新读取表单")
            _confirm_if_any(client, selector, preexisting, timeout=timeout)
            text = "、".join(option.display() for option, _ in matched)
            return SelectResolution("matched", option=SelectOption(value=text, text=text))

        # 慢路径（虚拟列表）：逐值定位（过滤优先、滚动兜底），找到即点。
        clicked: list[str] = []
        for value in values:
            resolution = resolve_select_option(options, value)
            done = False
            if resolution.status == "matched":
                failure = _try_click(client, options, selectors, resolution, timeout=timeout)
                done = failure is None
            if not done and _filterable(client, selector, value, timeout=timeout):
                filtered, filtered_selectors = _read_visible_options(
                    client, selector, marker, timeout=timeout, preexisting=preexisting
                )
                resolution = resolve_select_option(filtered, value)
                if resolution.status == "matched":
                    failure = _try_click(
                        client, filtered, filtered_selectors, resolution, timeout=timeout
                    )
                    done = failure is None
                    options, selectors = filtered, filtered_selectors
            if not done:
                resolution = (
                    _locate_by_scrolling(
                        client, selector, marker, value, timeout=timeout, preexisting=preexisting
                    )
                    or SelectResolution("no_option")
                )
                done = resolution.status == "matched"
            if not done:
                return SelectResolution(
                    "no_option",
                    reason=(
                        resolution.reason
                        or f"弹层选项里没有与“{value}”匹配的项（要求选 {len(values)} 个）"
                    ),
                )
            clicked.append(value)
        _confirm_if_any(client, selector, preexisting, timeout=timeout)
        text = "、".join(clicked)
        return SelectResolution("matched", option=SelectOption(value=text, text=text))
    finally:
        _cleanup(client, marker, timeout=timeout)


def _confirm_if_any(
    client: CdpClient, selector: str, preexisting: Sequence[dict[str, float]], *, timeout: float | None
) -> None:
    try:
        client.evaluate(confirm_script(selector, preexisting), timeout=timeout)
    except Exception:  # noqa: BLE001 - 确定按钮点不到就交给回读验证说话
        pass


def split_multi_values(value: str) -> list[str]:
    """「上海、北京」→ ``["上海", "北京"]``；没有分隔符就还是单值。

    只在弹层代选的写入路径上用：单值原样走既有单选路径，行为不变。
    """
    return [
        part for part in (segment.strip() for segment in _MULTI_VALUE_SEPARATOR.split(value or "")) if part
    ]


__all__ = ["select_combobox_option", "select_combobox_options", "split_multi_values"]

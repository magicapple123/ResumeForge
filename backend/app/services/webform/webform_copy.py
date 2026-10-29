# SPDX-License-Identifier: Apache-2.0
"""专用浏览器里**注入脚本**的界面文案（中 / 英）。

为什么文案在 Python 侧而不是页面里：注入脚本跑在第三方网页的上下文，不能反过来请求本地
接口（那等于把一个本地 API 暴露给所有站点）。所以界面文案只能随脚本一起送进去。

用法只有两个：

- ``apply_copy(script, locale)``：把脚本里的 ``%%copy:key%%`` 占位换成对应语言的文案。
  脚本模板本身是 ASCII 的（中文以 ``\\uXXXX`` 转义写入），占位符（``%%copy:key%%``）是唯一的"可变文案"入口。
- ``ui_text(locale, key, **params)``：Python 侧也要显示同一批文案时（面板上的状态说明、
  填入结果等），从这里取，避免两处各写一份。

``zh-CN`` 是**原文**：中文文案必须与改造前逐字一致，否则中文界面的表现就变了。
"""

from __future__ import annotations

import re

# zh-CN 是源语言；en-US 只覆盖需要翻译的键，缺失键自动回退到中文。
_COPY: dict[str, dict[str, str]] = {
    "zh-CN": {
        # ── 悬浮球 / 菜单（live_control.py）──
        "ball.aria.on": "历历求职助手：实时填表已开启，单击切换，双击打开菜单，按住拖动",
        "ball.aria.off": "历历求职助手：实时填表已关闭，单击开启，双击打开菜单，按住拖动",
        "ball.title.on": "历历求职助手：实时填表已开启。单击切换，双击打开菜单，按住拖动",
        "ball.title.off": "历历求职助手：实时填表已关闭。单击开启，双击打开菜单，按住拖动",
        "ball.fallback.on": "填",
        "ball.fallback.off": "关",
        "menu.title": "当前页面助手",
        "menu.subtitle": "仅填写，不替你提交",
        "autofill.action": "自动填写当前页面",
        "autofill.busy": "正在填写中…",
        "autofill.idle": "识别到的字段会逐项写入，已有内容不会覆盖。",
        "autofill.recognizing": "正在识别当前页面…",
        "autofill.running": "正在填写：{current}（{done}/{total}）",
        "autofill.done": "已完成 {filled}/{total} 个表单框，请回到页面核对",
        "autofill.stopped": "自动填写已停止",
        "autofill.nothing": "当前页面没有可自动填写的空字段",
        "autofill.rate": "（成功率 {percent}%）",
        "ask.open": "问历历",
        "ask.close": "收起问答",
        "ask.placeholder": "问历历：岗位、简历、填表问题…",
        "ask.send": "发送",
        "ask.thinking": "历历思考中…",
        # ── 焦点面板（engine/scripts.py）──
        "panel.fill": "填入",
        "panel.filled": "已填入",
        "panel.remember": "记住这条",
        "panel.more": "换个资料…",
        "panel.collapse": "收起",
        "panel.dragHint": "可拖动标题栏调整位置",
        "panel.search": "搜索资料（如：手机、学校、实习）",
        "panel.source.webform": "网申资料",
        "panel.source.webformTitle": "这条来自「网申资料」，不在简历里",
        "panel.nav.title": "分组快速定位",
        "panel.nav.fold": "收起分组跳转条",
        "panel.nav.unfold": "点开快速跳转到某个分组",
        # 跳转条的两段小标题：左边是跟着简历走的分区，右边是只在网申表里补的资料。
        "panel.nav.sectionResume": "简历资料",
        "panel.nav.summary": "{groups} 组 · {entries} 条",
        "panel.nav.chip": "跳到「{group}」（{count} 条）",
        "panel.nav.grip": "上下拖动调整跳转条高度",
        "panel.resize": "拖动调整面板大小",
        "panel.nav.head": "「{group}」共 {groups} 组、{count} 条，点击展开每一组",
        "panel.related": "可能是这几个（共 {count} 条，完整清单在下面）",
        "panel.hits": "命中 {count} 条",
        "panel.hits.none": "没有匹配的资料",
        "panel.empty.search": "没有匹配「{query}」的资料。换个词，或者清空搜索看全部。",
        "panel.empty.list": "资料还是空的，先去「我的资料」填一些",
        "panel.group.count": "{count} 条",
        "panel.group.countGroups": "{count} 组",
        "panel.group.head": "「{group}」共 {count} 条，点击折叠或展开",
        "panel.group.fold": "点击折叠这一组",
        "panel.group.unfold": "点击展开这一组",
        "panel.thinking": "正在看这个框…",
        "panel.thinking.ai": "AI 正在识别这个框…",
        "panel.badge.ai": "AI 建议",
        "panel.pick.useLabel": "使用上方字段名",
        "panel.pick.empty": "（尚未填写）",
        # 网申资料的协议分组标识 → 展示名
        "group.identity": "身份信息",
        "group.contact": "联系方式",
        "group.education": "教育经历",
        "group.other": "其他",
        "group.school": "学籍与档案",
        "group.language": "语言与证书",
        "group.family": "家庭与紧急联系人",
        "group.party": "党团信息",
        "group.health": "身体情况",
        "group.intent": "意向与到岗",
        "group.misc": "其他补充",
        "group.custom": "自定义",
        # ── 「记住这条」编辑器（live_memory_panel.py）──
        "memory.title": "记住这条：确认字段名与保存位置",
        "memory.subtitle": "默认先保存到网申资料·自定义；如果已有对应字段，也可以在下面展开后选择。",
        "memory.fieldName": "字段名",
        "memory.fieldValue": "字段内容",
        "memory.target": "保存到哪里（支持模糊搜索）",
        "memory.targetPlaceholder": "搜索资料模块、字段名或当前值",
        "memory.cancel": "取消",
        "memory.save": "保存这条",
        "memory.empty": "没有匹配的保存位置",
        "memory.nameRequired": "请先填写字段名。",
        "memory.valueRequired": "请先填写字段内容。",
        "memory.updateHint": "将更新「网申资料 · {group} · {label}」。已有字段名称不变。",
        "memory.createHint": "将按上方字段名新增或更新「网申资料 · 自定义」。",
        "memory.currentValue": "当前值：{value}",
        # ── Python 侧回写到面板的状态说明（live.py / live_autofill.py）──
        "note.aiThinking": "AI 正在识别这个框…",
        "note.pickFromList": "{note}，点「换个资料…」自己挑一条",
        "note.aiRejected": "AI 猜的字段和这个框的语义对不上，未采纳",
        "note.filled": "已填入，请核对",
        "note.relaxedFailed": "代选失败：{detail}",
        "note.autofillFilled": "已填入",
        "note.autofillUnconfirmed": "这一项未能确认，请稍后核对",
    },
    "en-US": {
        "ball.aria.on": "Lili job assistant: live fill is on. Click to toggle, double-click for the menu, "
        "press and drag to move",
        "ball.aria.off": "Lili job assistant: live fill is off. Click to turn on, double-click for the menu, "
        "press and drag to move",
        "ball.title.on": "Lili job assistant: live fill is on. Click to toggle, double-click for the menu, "
        "press and drag to move",
        "ball.title.off": "Lili job assistant: live fill is off. Click to turn on, double-click for the menu, "
        "press and drag to move",
        "ball.fallback.on": "Fill",
        "ball.fallback.off": "Off",
        "menu.title": "Page assistant",
        "menu.subtitle": "Fills only · never submits",
        "autofill.action": "Fill this page",
        "autofill.busy": "Filling…",
        "autofill.idle": "Recognised fields are written one by one; existing content is kept.",
        "autofill.recognizing": "Reading this page…",
        "autofill.running": "Filling {current} ({done}/{total})",
        "autofill.done": "Filled {filled} of {total} fields; check the page to confirm",
        "autofill.stopped": "Auto-fill stopped",
        "autofill.nothing": "No empty fields on this page to fill",
        "autofill.rate": " ({percent}% succeeded)",
        "ask.open": "Ask Lili",
        "ask.close": "Hide chat",
        "ask.placeholder": "Ask Lili about the Job, Resume or this form…",
        "ask.send": "Send",
        "ask.thinking": "Lili is thinking…",
        "panel.fill": "Fill",
        "panel.filled": "Filled",
        "panel.remember": "Remember this",
        "panel.more": "Pick another…",
        "panel.collapse": "Collapse",
        "panel.dragHint": "Drag the title bar to move",
        "panel.search": "Search Profile (phone, school, internship…)",
        "panel.source.webform": "Web form Profile",
        "panel.source.webformTitle": "Saved in “Web form Profile”, not in a Resume",
        "panel.nav.title": "Jump to a group",
        "panel.nav.fold": "Collapse the group jump bar",
        "panel.nav.unfold": "Open the group jump bar",
        "panel.nav.sectionResume": "Resume Profile",
        "panel.nav.summary": "{groups} groups · {entries} entries",
        "panel.nav.chip": "Jump to “{group}” ({count})",
        "panel.nav.grip": "Drag up or down to resize the jump bar",
        "panel.resize": "Drag to resize the panel",
        "panel.nav.head": "“{group}” has {groups} groups and {count} entries; click to expand",
        "panel.related": "Probably these ({count} in total; the full list is below)",
        "panel.hits": "{count} matches",
        "panel.hits.none": "No matching Profile entries",
        "panel.empty.search": "Nothing matches “{query}”. Try another word, or clear the search.",
        "panel.empty.list": "This Profile is still empty — add some entries in My Profile first",
        "panel.group.count": "{count}",
        "panel.group.countGroups": "{count} groups",
        "panel.group.head": "“{group}”: {count} entries, click to fold or unfold",
        "panel.group.fold": "Click to fold this group",
        "panel.group.unfold": "Click to unfold this group",
        "panel.thinking": "Reading this field…",
        "panel.thinking.ai": "The model is reading this field…",
        "panel.badge.ai": "AI guess",
        "panel.pick.useLabel": "Use the field name above",
        "panel.pick.empty": "(not filled in yet)",
        "group.identity": "Identity",
        "group.contact": "Contact",
        "group.education": "Education",
        "group.other": "Other",
        "group.school": "School records",
        "group.language": "Languages and certificates",
        "group.family": "Family and emergency contact",
        "group.party": "Party and youth league",
        "group.health": "Health",
        "group.intent": "Intent and availability",
        "group.misc": "Other details",
        "group.custom": "Custom",
        "memory.title": "Remember this: confirm the field name and where to save it",
        "memory.subtitle": "Saved to Web form Profile · Custom by default; if a matching field exists, "
        "expand the list below and pick it.",
        "memory.fieldName": "Field name",
        "memory.fieldValue": "Value",
        "memory.target": "Save to (fuzzy search supported)",
        "memory.targetPlaceholder": "Search a section, field name or current value",
        "memory.cancel": "Cancel",
        "memory.save": "Save",
        "memory.empty": "No matching destination",
        "memory.nameRequired": "Enter a field name first.",
        "memory.valueRequired": "Enter a value first.",
        "memory.updateHint": "Will update “Web form Profile · {group} · {label}”; the field name stays.",
        "memory.createHint": "Will add or update “Web form Profile · Custom” using the name above.",
        "memory.currentValue": "Current value: {value}",
        "note.aiThinking": "The model is reading this field…",
        "note.pickFromList": "{note}. Click “Pick another…” to choose one yourself",
        "note.aiRejected": "The model's guess does not match this field, so it was not used",
        "note.filled": "Filled in — please check",
        "note.relaxedFailed": "Could not pick the option: {detail}",
        "note.autofillFilled": "Filled in",
        "note.autofillUnconfirmed": "This field could not be confirmed; check it before submitting",
    },
}

DEFAULT_LOCALE = "zh-CN"
# 占位符刻意不用花括号：注入脚本是 Python f-string 拼的（``{{`` 会被吃掉），
# 用 ``%%copy:key%%`` 才能在两种字符串写法里都原样活到渲染阶段。
_TOKEN = re.compile(r"%%copy:([a-zA-Z0-9_.]+)%%")


def copy_for(locale: str | None) -> dict[str, str]:
    """取一份**完整**文案表：目标语言缺失的键回退到中文（源语言）。"""
    base = dict(_COPY[DEFAULT_LOCALE])
    override = _COPY.get((locale or "").strip()) or {}
    base.update(override)
    return base


def apply_copy(script: str, locale: str | None) -> str:
    """把脚本里的 ``%%copy:key%%`` 换成对应语言的文案。

    未知键原样保留（渲染结果里能一眼看到 ``%%copy:xxx%%``），而不是静默变成空串——
    文案缺失应该在联调/截图时暴露，不该变成一串空白按钮。
    """
    table = copy_for(locale)

    def _replace(match: re.Match[str]) -> str:
        return table.get(match.group(1), match.group(0))

    return _TOKEN.sub(_replace, script)


def ui_text(locale: str | None, key: str, **params: object) -> str:
    """Python 侧取同一条文案（面板状态、填入结果等），``{name}`` 用 ``params`` 填充。"""
    template = copy_for(locale).get(key)
    if template is None:
        return ""
    for name, value in params.items():
        template = template.replace("{" + name + "}", str(value))
    return template


def locale_key(value: str | None) -> str:
    """把任意 locale 值收敛成受支持的两个键；未知/缺失一律按源语言处理。"""
    text = (value or "").strip()
    if text.lower().startswith("en"):
        return "en-US"
    return DEFAULT_LOCALE


__all__ = ["apply_copy", "copy_for", "locale_key", "ui_text"]

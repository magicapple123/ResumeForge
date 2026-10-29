# SPDX-License-Identifier: Apache-2.0
"""焦点面板（``engine/scripts.py`` 里那段注入 JS）的**注入期**文案本地化。

为什么不在源头改成占位符：那段脚本是逐字符拼装的大字符串，另一位协作者正在同时改它
（导航跳转条 / 缩放把手）。为了不和他的改动互相踩，这里用"渲染前替换"的方式做本地化：
脚本照原样拼，装进页面前按界面语言把**已知的中文界面文案**换掉。

三条纪律：

1. **只对非源语言生效**：``zh-CN`` 原样返回，中文界面与改造前逐字一致。
2. **长串优先**：``已填入`` 必须在 ``填入`` 之前替换，``收起分组跳转条`` 必须在 ``收起``
   之前——否则会切出「已Fill」这种半截词。表按长度倒序预排。
3. **动态数字用正则**：``${groupItems.length} 条`` 这类模板无法整句替换，按模式换成
   ``entries`` / ``groups``；匹配不到就保持原样（宁可露出中文，也不要出空串）。
"""

from __future__ import annotations

import re

from .webform_copy import copy_for, locale_key

# (中文原文, 文案 key)；**必须**按 key 在 copy 表里的英文值替换。
# 顺序由模块底部按长度倒序重排，新增时不用自己找位置。
_PHRASES: list[tuple[str, str]] = [
    # —— 面板骨架 ——
    ("可拖动标题栏调整位置", "panel.dragHint"),
    ("上下拖动调整跳转条高度", "panel.nav.grip"),
    ("拖动调整面板大小", "panel.resize"),
    ("分组快速定位", "panel.nav.title"),
    ("搜索资料（如：手机、学校、实习）", "panel.search"),
    ("点开快速跳转到某个分组", "panel.nav.unfold"),
    ("收起分组跳转条", "panel.nav.fold"),
    # 跳转条上「简历资料 / 网申资料」两段小标题。右边那段与来源徽标同一句
    # （``panel.source.webform``），左边这段原先漏了，英文界面里只剩它一个中文。
    ("简历资料", "panel.nav.sectionResume"),
    # —— 按钮与状态 ——
    ("已填入", "panel.filled"),
    ("记住这条", "panel.remember"),
    ("换个资料…", "panel.more"),
    ("收起", "panel.collapse"),
    ("填入", "panel.fill"),
    ("正在看这个框…", "panel.thinking"),
    ("AI 正在识别这个框…", "panel.thinking.ai"),
    ("AI 建议", "panel.badge.ai"),
    # —— 来源与空态 ——
    ("这条来自「网申资料」，不在简历里", "panel.source.webformTitle"),
    ("网申资料", "panel.source.webform"),
    ("没有匹配的资料", "panel.hits.none"),
    ("资料还是空的，先去「我的资料」填一些", "panel.empty.list"),
    ("使用上方字段名", "panel.pick.useLabel"),
    ("（尚未填写）", "panel.pick.empty"),
    ("点击折叠这一组", "panel.group.fold"),
    ("点击展开这一组", "panel.group.unfold"),
    # —— 网申资料的协议分组名（值，不是键）——
    ("家庭与紧急联系人", "group.family"),
    ("意向与到岗", "group.intent"),
    ("学籍与档案", "group.school"),
    ("语言与证书", "group.language"),
    ("其他补充", "group.misc"),
    ("身份信息", "group.identity"),
    ("联系方式", "group.contact"),
    ("教育经历", "group.education"),
    ("党团信息", "group.party"),
    ("身体情况", "group.health"),
    ("自定义", "group.custom"),
    ("其他", "group.other"),
]

# 动态模板：整句替换（含 ${...} 的部分用正则）。
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"「\$\{([^{}]+)\}」共 \$\{([^{}]+)\} 组、\$\{([^{}]+)\} 条，点击展开每一组"),
        r"“${\1}” has ${\2} groups and ${\3} entries; click to expand",
    ),
    (
        re.compile(r"「\$\{([^{}]+)\}」共 \$\{([^{}]+)\} 条，点击折叠或展开"),
        r"“${\1}”: ${\2} entries, click to fold or unfold",
    ),
    (
        re.compile(r"跳到「\$\{([^{}]+)\}」（\$\{([^{}]+)\} 条）"),
        r"Jump to “${\1}” (${\2})",
    ),
    (
        re.compile(r"可能是这几个（共 \$\{([^{}]+)\} 条，完整清单在下面）"),
        r"Probably these (${\1} total; full list below)",
    ),
    (re.compile(r"命中 \$\{([^{}]+)\} 条"), r"${\1} matches"),
    (
        re.compile(r"没有匹配「\$\{([^{}]+)\}」的资料。换个词，或者清空搜索看全部。"),
        r"Nothing matches “${\1}”. Try another word, or clear the search.",
    ),
    (re.compile(r"\$\{([^{}]+)\} 组 · \$\{([^{}]+)\} 条"), r"${\1} groups · ${\2} entries"),
    (re.compile(r"\$\{([^{}]+)\} 条"), r"${\1} entries"),
    (re.compile(r"\$\{([^{}]+)\} 组"), r"${\1} groups"),
    (re.compile(r"当前值："), "Current value: "),
]

_ORDERED = sorted(_PHRASES, key=lambda item: len(item[0]), reverse=True)


def localize_panel(script: str, locale: str | None) -> str:
    """把面板脚本里的中文界面文案换成 ``locale`` 对应的语言。

    ``zh-CN``（源语言）原样返回；未知语言同样按源语言处理——宁可露出中文，也不要
    把界面切成半英文半中文。
    """
    if locale_key(locale) == "zh-CN":
        return script
    table = copy_for(locale)
    text = script
    # 先跑正则（整句模板），再跑短语：整句命中后短语不会重复替换到它上面。
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(lambda _m, r=replacement: _m.expand(r), text)
    for zh, key in _ORDERED:
        translated = table.get(key)
        if translated:
            text = text.replace(zh, translated)
    return text


__all__ = ["localize_panel"]

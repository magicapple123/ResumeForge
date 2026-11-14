"""在页面上给"需要人工看"的控件画黄框——只做标记，不写值、不点击。

为什么单独注入一小段脚本：预览阶段用户要一眼看出"哪几个框没把握 / 有冲突 / 是 AI 猜的"，
但这份信息只该停留在 DOM 属性上（``data-rf-form-review``），不能回填值，更不能触发站点
自己的校验。样式也只加一条 outline，不改控件外观与布局。

三条边界：
- 脚本开头校验 ``location.href``：标签页已经导航走时返回 ``{stale:true}``，不误标新页面；
- 每次先清旧标记再标：重复预览不会叠出两种状态；
- 整个过程失败只记一条诊断事件——"装饰"绝不能把预览结果搞失败。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from ..diagnostics import record_event
from .service.models import STATUS_CONFLICT, STATUS_LOW_CONFIDENCE

if TYPE_CHECKING:
    from .service.models import PreviewReport
    from .session import Snapshot


def review_script(snapshot: Snapshot, report: PreviewReport) -> str:
    # 同一控件可能同时出现在多个清单里：按 unknown → manual → candidate 的顺序覆盖（后写赢）。
    states = {item.index: "unknown" for item in report.unrecognized}
    states.update({item.index: "manual" for item in report.blocked})
    states.update(
        {
            item.index: "candidate"
            for item in report.items
            if item.source == "ai" or item.status in (STATUS_LOW_CONFIDENCE, STATUS_CONFLICT)
        }
    )
    targets = [
        {"selector": control.selector, "state": states[control.index]}
        for control in snapshot.controls
        if control.index in states and control.selector
    ]
    return "".join(
        [
            "(() => { /* rf:review-highlights */\n",
            f"if (location.href !== {json.dumps(snapshot.url)}) return {{stale:true}};\n",
            "const attr = 'data-rf-form-review';\n",
            "document.querySelectorAll('['+attr+']').forEach(el=>el.removeAttribute(attr));\n",
            "let style = document.querySelector('style[data-rf-form-review-style]');\n",
            "if (!style) { style=document.createElement('style');\n",
            "style.setAttribute('data-rf-form-review-style','');\n",
            "style.textContent='[data-rf-form-review]{outline:2px solid #d48806!important;outline-offset:2px}';\n",
            "document.head.appendChild(style); }\n",
            "let marked=0;\n",
            f"for (const target of {json.dumps(targets)}) {{\n",
            "try { const el=document.querySelector(target.selector);\n",
            "if(el){el.setAttribute(attr,target.state);marked++;} }catch{} }\n",
            "return {marked};\n",
            "})()",
        ]
    )


def highlight_review(client: Any, snapshot: Snapshot, report: PreviewReport) -> None:
    """A stale/closed tab must never make the computed preview fail."""
    if client is None:
        return
    try:
        client.evaluate(review_script(snapshot, report), timeout=3)
    except Exception as error:  # noqa: BLE001 - optional page decoration
        record_event("webform.review_highlight_failed", error=type(error).__name__)

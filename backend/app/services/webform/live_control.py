# SPDX-License-Identifier: Apache-2.0
"""专用浏览器内的实时填表悬浮球「历历」。

页面只负责把用户的开关/拖动动作写进一个受用的 window 状态；
Python 侧通过 CDP 轮询这个状态，再决定当前标签页是否继续处理焦点。
这样网页不需要、也不能直接访问 ResumeForge 的本地 API。

历历与主界面的「投投」是两个吉祥物：历历是**静态**的（一张图，无表情动画），
交互为——单击切换实时填表开关、双击展开/收起菜单、按住左键即可拖动（无需长按）。

「问历历」问答走同一条中转纪律：页面把 ``{seq, text}`` 写进
``window.__rfAssistantAsk``，Python 轮询读到后调模型，再把 ``{seq, text|error}``
写回 ``window.__rfAssistantReply``。**注入脚本里没有任何对本地 API 的请求**——
素材也以 base64 data URI 随脚本携带，不给第三方页面留直连通道。
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

from .live_control_script import render_live_control_script
from .webform_copy import apply_copy

# 吉祥物素材目录（``backend/app/assets``，透明底小图，由美术原图切出）。
_ASSET_DIR = Path(__file__).resolve().parents[2] / "assets"
# 历历的形象：``deliverables/mascot/02-投投-悬浮球B-简历球.png`` 的 128px 透明底版，
# 由 ``backend/scripts/build_lili_orb.py`` 生成（抠底 / 按内容重新定框 / 缩放）。
# **别按"圆形裁切"处理这张图**：右上角的星星探出球体、球下还有一层投影，
# 裁圆会把它们切掉。资产缺失时回退为渐变球 + 文字，不炸功能。
_LILI_ORB_FILE = "lili/lili-orb-128.png"


def _load_face_data_uri(filename: str) -> str | None:
    """把 96px 吉祥物形象读成 base64 data URI；文件缺失时返回 None（脚本侧降级为渐变球）。

    为什么内嵌而不是让页面去取：注入脚本运行在第三方网页上下文，任何对本地 API 的
    请求都是被禁止的安全边界；素材随脚本一起进去是唯一合规的携带方式。
    """
    try:
        raw = (_ASSET_DIR / filename).read_bytes()
    except OSError:
        return None
    return f"data:image/png;base64,{base64.b64encode(raw).decode('ascii')}"


def install_live_control_script(enabled: bool = True, locale: str | None = None) -> str:
    """返回幂等的悬浮球安装脚本；界面文案按 ``locale`` 取（缺省中文）。"""
    avatar_literal = json.dumps(_load_face_data_uri(_LILI_ORB_FILE))
    return apply_copy(render_live_control_script(avatar_literal, enabled), locale)


LIVE_CONTROL_STATE_SCRIPT = """
(() => {
  /* rf:live-control-state */
const value = window.__rfLiveControl;
  return JSON.stringify(value && typeof value === 'object'
    ? {
        enabled: value.enabled !== false,
        seq: Number(value.seq) || 0,
        autofill: window.__rfAutoFillRequest || null,
        autofill_status: window.__rfAutoFillStatus || null,
      }
    : {enabled: true, seq: 0, autofill: window.__rfAutoFillRequest || null, autofill_status: window.__rfAutoFillStatus || null});
})()
"""


def set_live_enabled_script(enabled: bool) -> str:
    value = json.dumps(bool(enabled))
    return (
        "(() => { /* rf:live-control-set */"
        f" window.__rfSetLiveEnabled && window.__rfSetLiveEnabled({value}); return '1'; }})()"
    )


def set_autofill_status_script(status: dict[str, object]) -> str:
    """把后台逐项填充进度推回悬浮球，不依赖主应用轮询。"""
    payload = json.dumps(status, ensure_ascii=False)
    return (
        "(() => { /* rf:autofill-status */"
        f" window.__rfAutoFillStatus = {payload};"
        f" window.__rfSetAutoFillStatus && window.__rfSetAutoFillStatus({payload});"
        " return '1'; })()"
    )


def set_assistant_reply_script(payload: dict[str, object]) -> str:
    """把「问投投」的回答/错误写回页面（``{seq, text}`` 或 ``{seq, error}``）。

    与 ``set_autofill_status_script`` 同款先存全局再调回调的写法：即使面板刚好错过
    回调（比如正在重渲染），状态也从 ``window.__rfAssistantReply`` 拿得到。
    """
    serialized = json.dumps(payload, ensure_ascii=False)
    return (
        "(() => { /* rf:assistant-reply */"
        f" window.__rfAssistantReply = {serialized};"
        f" window.__rfSetAssistantReply && window.__rfSetAssistantReply({serialized});"
        " return '1'; })()"
    )


__all__ = [
    "LIVE_CONTROL_STATE_SCRIPT",
    "install_live_control_script",
    "set_assistant_reply_script",
    "set_autofill_status_script",
    "set_live_enabled_script",
]

# SPDX-License-Identifier: Apache-2.0
"""诊断包预览说明：界面语言包与后端常量必须逐字一致。

界面读 ``settingsUi.help.previewNote``（``HelpDiagnosticsCard`` 走 ``t()``），后端
``note`` 字段只服务非界面消费者。两份文案一直是人工同步、全库没有断言——2026-11
之前「只包含脱敏运行事件、系统信息与近期**后端**日志尾部」漏了桌面壳日志这一整类
成员，而同一块文字里的 ``files`` 清单已经把它们列了出来。

反证方式：改后端常量里的一个字，本用例必须精确变红（不是"文件里存在这个键"）。
"""

from __future__ import annotations

import json
import pathlib
import re

from app.api.system import _DIAGNOSTICS_PREVIEW_NOTE

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
ZH_SETTINGS_UI = REPO_ROOT / "frontend" / "src" / "i18n" / "messages" / "zh-CN.settingsUi.ts"

# 必须锚到键名之后的**第一个字符串字面量**：注释块里也引用了同名键，
# 只找 key 会命中注释，守卫会恒绿（见 docs/defect-patterns.md 的 E3）。
_ENTRY = re.compile(r'"settingsUi\.help\.previewNote"\s*:\s*("(?:[^"\\]|\\.)*")', re.S)


def _frontend_note() -> str:
    """从中文语言包取出这句说明的**值**（不是键、不是注释）。"""
    match = _ENTRY.search(ZH_SETTINGS_UI.read_text(encoding="utf-8"))
    assert match, "zh-CN.settingsUi.ts 里找不到 settingsUi.help.previewNote"
    return json.loads(match.group(1))


def test_preview_note_matches_frontend_copy() -> None:
    """两处逐字一致：改一处必须同批改另一处。"""
    assert _frontend_note() == _DIAGNOSTICS_PREVIEW_NOTE


def test_preview_note_covers_desktop_logs() -> None:
    """成员清单本身要被钉住：只调标点或长度不该让上一条继续绿。"""
    for text in (_frontend_note(), _DIAGNOSTICS_PREVIEW_NOTE):
        assert "桌面壳日志" in text
        assert "不包含" in text

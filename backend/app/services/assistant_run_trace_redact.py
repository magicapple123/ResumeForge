# SPDX-License-Identifier: Apache-2.0
"""T21 轨迹摘要脱敏与越界键检测（与 assistant_run_trace 同属运行轨迹，拆文件保持行数余量）。

只做两件事：
- redact_summary()：把工具摘要里的邮箱/手机/密钥/家目录掩码，并截断到 120 字；
- forbidden_keys_in()：递归找出视图里越界的键（简历正文/附件/参数/提示词/推理/Key）。
"""

from __future__ import annotations

import re
from collections.abc import Mapping

MAX_SUMMARY_CHARS = 120

# 这些键一旦出现在轨迹视图里就是越界（简历正文/附件/参数/提示词/推理过程/Key）。
FORBIDDEN_KEYS = frozenset(
    {
        "content",
        "attachments",
        "attachment",
        "arguments",
        "result_text",
        "prompt",
        "prompts",
        "messages",
        "reasoning",
        "reasoning_content",
        "chain_of_thought",
        "thinking",
        "api_key",
        "apikey",
        "key",
        "secret",
        "password",
        "photo",
        "raw_text",
        "text",
    }
)

_MASK = "[已脱敏]"
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)")
_SECRET_RE = re.compile(
    r"(?i)\b(?:sk-[A-Za-z0-9_-]{6,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}"
    r"|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+)"
)
_HOME_RE = re.compile(r"(?i)(?:[A-Z]:\\Users\\|/home/|/Users/)[^\s\"']+")


def redact_summary(text: object, *, limit: int = MAX_SUMMARY_CHARS) -> str:
    """工具摘要脱敏：去换行/控制符 → 掩码邮箱/手机/密钥/家目录 → 截断。

    summary 是**人可见**的短句（如「更新了简历「X」的收藏」），不是正文；
    这里只负责把不该出现在摘要里的敏感模式再兜一层，不承担"描述用户数据"的职责。
    """
    if not isinstance(text, str):
        return ""
    value = " ".join(text.split())
    value = _EMAIL_RE.sub(_MASK, value)
    value = _PHONE_RE.sub(_MASK, value)
    value = _SECRET_RE.sub(_MASK, value)
    value = _HOME_RE.sub(_MASK, value)
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[: max(limit - 1, 0)].rstrip() + "…"


def forbidden_keys_in(value: object) -> list[str]:
    """递归找出视图里越界的键（供测试/后续运行时守卫使用；正常应为空）。"""
    found: set[str] = set()

    def _walk(node: object) -> None:
        if isinstance(node, Mapping):
            for key, item in node.items():
                if isinstance(key, str) and key in FORBIDDEN_KEYS:
                    found.add(key)
                _walk(item)
        elif isinstance(node, (list, tuple)):
            for item in node:
                _walk(item)

    _walk(value)
    return sorted(found)

"""备份包的下载文件名：把用户填的名字规整成安全的 ``.zip`` 文件名。

为什么单独一个模块：同一套规则要被单数据集导出、全量导出和前端默认名三处使用，
写在路由里就会各写一遍、各自的边界还不一样（一个允许 128 字、另一个允许 64 字）。

规则（与计划 R15 一致）：
- 去掉控制字符，把 Windows/macOS 都不允许的 ``\\ / : * ? " < > |`` 换成 ``-``；
- 保留中文与空格（浏览器与各系统都支持 UTF-8 文件名，Content-Disposition 已用 RFC 5987）；
- 主体最长 64 字符（不含扩展名），末尾的点、空格与连字符在 Windows 上会出问题，一律削掉；
- 用户没填、或填完只剩非法字符时，回退到调用方给的默认名。
"""

from __future__ import annotations

import re
from datetime import datetime

# 文件系统不允许的字符 + 全部 C0 控制字符（含换行：它能把 Content-Disposition 拆成两行）。
_ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_COLLAPSED_DASHES = re.compile(r"-{2,}")
SUFFIX = ".zip"
MAX_STEM_LENGTH = 64


def safe_backup_filename(raw: str | None, *, default_stem: str) -> str:
    """把 ``raw`` 规整成 ``<stem>.zip``；无效或为空时用 ``default_stem``。"""
    stem = _ILLEGAL_CHARS.sub("-", (raw or "").strip())
    stem = _COLLAPSED_DASHES.sub("-", stem).strip(" .-")
    if stem.lower().endswith(SUFFIX):
        stem = stem[: -len(SUFFIX)].strip(" .-")
    stem = stem[:MAX_STEM_LENGTH].strip(" .-")
    if not stem:
        stem = _ILLEGAL_CHARS.sub("-", default_stem).strip(" .-")[:MAX_STEM_LENGTH] or "backup"
    return f"{stem}{SUFFIX}"


def default_backup_stem(label: str) -> str:
    """默认名：``<数据集名>-<YYYYMMDD-HHMMSS>``。

    带上时间戳是因为备份包最容易发生的事故是"同名覆盖"——用户在下载目录里连续导出
    两次，第二次把第一次顶掉了，而内容其实不同。
    """
    cleaned = _ILLEGAL_CHARS.sub("-", (label or "").strip()).strip(" .-")[:MAX_STEM_LENGTH]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{cleaned or '数据集'}-{stamp}"


__all__ = ["MAX_STEM_LENGTH", "SUFFIX", "default_backup_stem", "safe_backup_filename"]

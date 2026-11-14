# SPDX-License-Identifier: Apache-2.0
"""内置字体的文件清单与错误类型（从 app.services.resume_font_builtin 纯搬迁拆出）。

思源黑体两份字重的清单（字节数 + sha256）、镜像地址、目标目录名、磁盘预检倍数，以及下载
链用到的错误类型。resume_font_builtin 把它们 import 回自己的命名空间，因此 tests 对
BUILTIN_FILES 的 monkeypatch（patch 的是模块属性）语义不变；本模块只存常量与异常类型。
"""

from __future__ import annotations

import httpx

FONT_ID = "source-han-sans-sc"
FONT_LABEL = "思源黑体"
BASE_URL = "https://mirrors.tuna.tsinghua.edu.cn/adobe-fonts/source-han-sans/OTF/SimplifiedChinese/"

# ``role`` 只用于日志与"谁是常规字重"的判断；文件顺序有意义——第一个是 Regular，
# 下载完成后它会被设为当前字体（用户点一次"下载"就该能直接用）。
BUILTIN_FILES: tuple[dict[str, object], ...] = (
    {
        "role": "regular",
        "name": "SourceHanSansSC-Regular.otf",
        "bytes": 16529832,
        "sha256": "f1d8611151880c6c336aabeac4640ef434fa13cbfbf1ffe82d0a71b2a5637256",
    },
    {
        "role": "bold",
        "name": "SourceHanSansSC-Bold.otf",
        "bytes": 16963428,
        "sha256": "df2b90f5bcc6d01dfc964cec5f6d535d6b6aebd26ed7fd79a9c1b3f2112fcb6b",
    },
)

DIR_NAME = "fonts"
# 磁盘预检倍数：下载要写临时文件再 rename，峰值占用略高于最终体积。
DISK_HEADROOM = 1.2
_TIMEOUT = httpx.Timeout(connect=10, read=60, write=10, pool=10)


class FontBusy(RuntimeError):
    """已有一个下载任务在跑（API 映射 409）。"""


class FontDiskFull(RuntimeError):
    """磁盘剩余空间不够（API 映射 507）。"""


class FontDownloadError(RuntimeError):
    """下载或校验失败；消息可直接展示给用户。"""


class FontNotDownloaded(RuntimeError):
    """本机没有下载过内置字体（API 映射 404）。"""


class FontDeleteError(RuntimeError):
    """删除字体文件失败（被占用 / 无权限）：文件保留原样，API 映射 500，不假装成功。"""

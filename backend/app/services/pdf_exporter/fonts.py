"""字体解析（系统中文字体查找 + 环境变量兜底）。"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

FONT_FAMILY = "resume-cjk"
# 允许用户用环境变量指定字体（Linux 发行版字体路径五花八门时的兜底）。
FONT_ENV_VAR = "RESUMEFORGE_PDF_FONT"

# (常规, 粗体)；粗体缺失时退回常规。
_FONT_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc"),
    ("C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simhei.ttf"),
    ("C:/Windows/Fonts/simsun.ttc", "C:/Windows/Fonts/simsun.ttc"),
    ("C:/Windows/Fonts/Deng.ttf", "C:/Windows/Fonts/Dengb.ttf"),
    ("/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/PingFang.ttc"),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", "/System/Library/Fonts/Supplemental/Songti.ttc"),
    ("/Library/Fonts/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"),
    (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    ),
    (
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    ),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
    ("/usr/share/fonts/truetype/arphic/uming.ttc", "/usr/share/fonts/truetype/arphic/uming.ttc"),
)


class ResumePDFError(Exception):
    """对外暴露的 PDF 生成错误，message 可直接展示给用户。"""


def _resolve_font_paths() -> tuple[str, str] | None:
    override = os.environ.get(FONT_ENV_VAR, "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return str(path), str(path)
        logger.warning("环境变量 %s 指向的字体不存在：%s", FONT_ENV_VAR, override)
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).is_file():
            return regular, bold if Path(bold).is_file() else regular
    return None


def font_available() -> bool:
    """前端据此决定是否展示「下载 PDF」主按钮。"""
    return _resolve_font_paths() is not None

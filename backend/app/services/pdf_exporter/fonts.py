# SPDX-License-Identifier: Apache-2.0
"""字体解析（系统中文字体查找 + 环境变量兜底）。"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from ..resume.resume_template_format import SYSTEM_FONT

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
    (
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ),
    ("/Library/Fonts/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"),
    (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    ),
    (
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    ),
    (
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ),
    ("/usr/share/fonts/truetype/arphic/uming.ttc", "/usr/share/fonts/truetype/arphic/uming.ttc"),
)


class ResumePDFError(Exception):
    """对外暴露的 PDF 生成错误，message 可直接展示给用户。"""


# 探测结果进程内缓存：字体文件在进程生命周期内不会增减，而每次导出/模板列表都会
# 走到这里，逐个候选路径 is_file() 纯属重复扫描。探测不到也缓存 None——重扫同样
# 找不到，只是白花时间。
#
# 项 14 起**按字体名分键**（``None`` = 跟随当前全局字体）：同一进程里两份选了不同字体的
# 简历会先后导出，只留一个标量缓存的话，第二个会拿到第一个的路径（"换了字体导出没变"）。
# 网格化缓存是这件事唯一正确的形态——不是清缓存，而是让不同选择各自有位置。
_font_paths_cache: dict[str | None, tuple[str, str] | None] = {}


def resolve_font_paths(font_name: str | None = None) -> tuple[str, str] | None:
    """按"这份简历选的字体"解析出 (常规, 粗体) 字体文件路径。

    ``font_name``：

    * ``None`` —— 没设过/不指定：环境变量 → **当前全局字体** → 系统候选（历史行为）；
    * ``SYSTEM_FONT`` —— 显式要求系统字体：跳过全局字体，只走环境变量 + 系统候选；
    * 其它 —— 该上传字体文件；文件已被删则回落到 ``None`` 那一套（同一份简历不该因为
      一个被删掉的字体文件而导不出 PDF）。
    """
    if font_name in _font_paths_cache:
        return _font_paths_cache[font_name]
    resolved = _probe_font_paths(font_name)
    _font_paths_cache[font_name] = resolved
    return resolved


def _resolve_font_paths() -> tuple[str, str] | None:
    """历史入口（无字体选择）：等价于 :func:`resolve_font_paths` 的 ``None``。"""
    return resolve_font_paths(None)


def _pair_paths(path: Path) -> tuple[str, str]:
    """字体文件 → ``(常规, 粗体)`` 字符串路径。

    内置思源黑体带独立的 Bold 字面，必须成对返回：fpdf2 拿不到真粗体时会用描边伪造，
    中文笔画密、描边后糊成一团（"PDF 里加粗不明显"的根因）。其它字体仍返回同一路径
    两次，与本功能上线前逐字一致。
    """
    try:
        from ..user_fonts import font_pair

        regular, bold = font_pair(path.name)
    except Exception:  # noqa: BLE001 - 配对失败退回单文件，导出链路不该因此中断
        return str(path), str(path)
    return str(regular), str(bold)


def _probe_font_paths(font_name: str | None = None) -> tuple[str, str] | None:
    override = os.environ.get(FONT_ENV_VAR, "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return str(path), str(path)
        logger.warning("环境变量 %s 指向的字体不存在：%s", FONT_ENV_VAR, override)
    if font_name == SYSTEM_FONT:
        # 显式系统字体：**不**读全局当前字体——否则"这份简历不用自定义字体"这个选项
        # 会被设备上的全局选择悄悄推翻。
        return _probe_system_font_paths()
    if font_name:
        try:
            from ..user_fonts import FontError, font_path

            chosen = font_path(font_name)
        except FontError:
            logger.warning("简历选用的字体「%s」已不存在，回落到当前字体", font_name)
        except Exception:  # noqa: BLE001 - 字体探测失败不该让导出整条链路崩掉
            # 静默吞掉会让"为什么 Linux CI 上字体选择失效"这类问题无从排查：这里
            # 记录一次（带堆栈），调用方仍然拿到回落行为。
            logger.warning("简历选用的字体「%s」探测失败，回落到当前字体", font_name, exc_info=True)
            chosen = None
        else:
            return _pair_paths(chosen)
    # 用户在设置页选中的字体（R10）优先于系统字体：他明确选了一个，
    # 就该按那个导出；文件被删/移动时自然回落到系统字体，不报错。
    try:
        from ..user_fonts import active_font_paths

        pair = active_font_paths()
    except Exception:  # noqa: BLE001 - 字体探测失败不该让导出整条链路崩掉
        pair = None
    if pair is not None:
        return str(pair[0]), str(pair[1])
    return _probe_system_font_paths()


def _probe_system_font_paths() -> tuple[str, str] | None:
    """只按系统候选列表探测（不看任何用户选择）。"""
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).is_file():
            return regular, bold if Path(bold).is_file() else regular
    return None


def font_available() -> bool:
    """前端据此决定是否展示「下载 PDF」主按钮。"""
    return resolve_font_paths(None) is not None


def reset_font_cache() -> None:
    """字体设置变更后调用：下一次探测重新走一遍候选（含用户字体）。"""
    _font_paths_cache.clear()

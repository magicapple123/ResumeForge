# SPDX-License-Identifier: Apache-2.0
"""字体解析（系统中文字体查找 + 环境变量兜底 + 已下载的内置字体兜底）。"""

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

    * ``None`` —— 没设过/不指定：环境变量 → **当前全局字体** → 系统候选 → **已下载的
      内置字体**（Linux 上没有系统中文字体时的唯一出路）→ ``None``；
    * ``SYSTEM_FONT`` —— 显式要求系统字体：跳过全局字体，只走环境变量 + 系统候选
      （仍然保留内置字体兜底：Linux 上系统字体不存在时，"系统字体"退到思源黑体
      也好过让导出直接 409）；
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
        return _probe_fallback_paths()
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
    return _probe_fallback_paths()


def _probe_fallback_paths() -> tuple[str, str] | None:
    """没有任何"用户选择"时的最后两级：**系统候选 → 已下载的内置字体**。

    优先级写在一处而不是散在两个调用点上：内置字体**必须**排在系统字体后面，否则
    Windows/macOS 上「系统字体」这个选项的语义会被悄悄改掉——用户选了"用系统字体"，
    导出的却成了下载来的思源黑体。

    为什么需要第二级：``_FONT_CANDIDATES`` 里的 Linux 条目（Noto CJK / 文泉驿 /
    arphic）**没有任何主流发行版默认安装**，于是 Linux 上探测必然返回 ``None``，
    导出接口回 409、用户被推回浏览器打印；而内置思源黑体是用户已经花 30 秒下到本机
    的 32MB，本机明明有这个字体，没有理由不给用。
    """
    return _probe_system_font_paths() or _probe_builtin_font_paths()


def _probe_system_font_paths() -> tuple[str, str] | None:
    """只按系统候选列表探测（不看任何用户选择）。"""
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).is_file():
            return regular, bold if Path(bold).is_file() else regular
    return None


def _probe_builtin_font_paths() -> tuple[str, str] | None:
    """已下载的内置思源黑体 ``(常规, 粗体)``；没下载全就 ``None``。

    **无副作用**：只读磁盘，绝不触发下载——下载是用户在前端点"下载"才发生的动作，
    而本函数会在每次导出、每次模板列表时被调用。在这里发起 32MB 下载是灾难。

    判定用 ``resume_font_builtin.downloaded_names()``：它已经做了"两个文件都在、
    且体积与清单对得上"的双重确认（清单见 ``BUILTIN_FILES``），比单独拼路径可靠。

    **成对返回**：内置字体带独立的 Bold 字面。只给常规字面会让 fpdf2 用描边伪造粗体，
    中文笔画密、描边后糊成一团（"PDF 里加粗不明显"的根因，见 ``_pair_paths``）。

    模块内 import 沿用既有写法（``_pair_paths`` / ``active_font_paths`` 同一模式）：
    ``resume_font_builtin`` 是被明确声明为"叶子"的模块（它不 import ``user_fonts``），
    此处调它不成环；但顶层 import 会把"字体探测"与"下载模块"在导入期绑死，任何一侧
    的 import 期异常都会让整个导出链路起不来，所以放进函数里并整体兜住。

    缓存提醒：内置字体是**运行期**才落盘的，而 ``_font_paths_cache`` 会记住 ``None``。
    下载完成后的刷新由 API 层负责（``api/font_builtin._ensure_active`` →
    ``api/fonts._invalidate_render_caches`` → ``reset_font_cache``），这里不挂钩子——
    探测函数保持纯粹。

    **测试隔离注意**：本函数读 ``resume_font_builtin`` 自己的 ``DATA_DIR``，而
    ``tests/conftest.py`` 只隔离了 ``user_fonts.DATA_DIR``。两者在生产里是同一个
    ``DATA_DIR/fonts``；开发机上装了真字体时，本函数只在"系统候选全缺失"时才被用到。
    """
    try:
        from .. import resume_font_builtin

        entries = resume_font_builtin.BUILTIN_FILES
        # 顺序有意义：第一个是 Regular，第二个是它的 Bold 字面（见该模块的注释）。
        if len(entries) < 2:
            return None
        regular_name = str(entries[0]["name"])
        bold_name = str(entries[1]["name"])
        downloaded = set(resume_font_builtin.downloaded_names())
        if regular_name not in downloaded or bold_name not in downloaded:
            return None
        directory = resume_font_builtin.fonts_dir()
    except Exception:  # noqa: BLE001 - 字体探测失败不该让导出整条链路崩掉
        logger.warning("内置字体探测失败，按没有字体处理", exc_info=True)
        return None
    return str(directory / regular_name), str(directory / bold_name)


def font_available() -> bool:
    """前端据此决定是否展示「下载 PDF」主按钮。"""
    return resolve_font_paths(None) is not None


def reset_font_cache() -> None:
    """字体设置变更后调用：下一次探测重新走一遍候选（含用户字体与已下载的内置字体）。

    **只清 ``_font_paths_cache`` 就够**：那张表存的是"上一次探测的结论"（含 ``None``），
    而字体文件本身每次探测都现读磁盘。所以清表就等于让下一次探测重新问一遍磁盘，
    不需要额外给内置字体做失效钩子——下载完成后调一次本函数即可看到新文件。

    真实的调用方是 ``api/fonts._invalidate_render_caches``（字体增删改都走它）；
    内置字体下载完成的路径也接得通：``api/font_builtin._ensure_active`` 在设为当前
    字体后会调它，所以下一次导出就能用上新下载的字体。
    """
    _font_paths_cache.clear()

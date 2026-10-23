# SPDX-License-Identifier: Apache-2.0
"""预子集字体：把「这一份简历真正用到的字」裁成小字体，重复渲染不再解析 19MB 的大字体。

**为什么值得做**：fpdf2 每次 `add_font` 都会把 `glyf` / `cmap` 整表解出来（msyh 两万多
个字形）。实测一趟渲染 ~400ms 里 **83% 是这一步**，而真正的绘制只有 ~13ms。用户拖一次
滑块就把这 330ms 重付一遍——这才是"精确模式调参还是慢"的真身。

而一轮调参里**正文一个字都没变**，变的只是页边距 / 行高 / 字号。所以：把字体先裁到
"这份内容用到的几百个字"，解析与再子集化都只在这个小字体上做。实测 **420ms → 36ms**，
逐字几何（`_text_runs` 的 x/y/字号/文本）与全量字体**完全一致**。

**字符集从上一趟真实渲染里收**，不是从正文猜的。渲染器自己会写「求职意向」「个人总结」
这类标题，也有 `、` `：` `·` 这些分隔符——猜漏一个就是在纸面上少一个字，而这种 bug
几乎不可能被肉眼发现。所以 `_ResumePDF` 记录每一段真正画出去的文本，第一趟仍走全量
字体，第二趟起才用子集；内容变了（签名变）就重新收一轮。

**失败即退回**：任何一步出问题（字体格式奇特、临时目录写不了、字体被替换…）都只记一条
warning 并返回 `None`，调用方用原字体照常渲染。这是加速，不是功能——绝不能因为它让导出
失败或让某一行字消失。
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import threading
import time
from collections import OrderedDict
from collections.abc import Iterable
from contextlib import suppress
from pathlib import Path
from typing import cast

logger = logging.getLogger(__name__)

# 一次编辑会话里同时在用的内容/模板组合不会超过这个量级；再多就该让 LRU 自己淘汰。
MAX_CHARSETS = 8
MAX_SUBSETS = 8
# 磁盘上最多留这么多份子集文件（每份几十到几百 KB），超了按修改时间清最旧的。
MAX_SUBSET_FILES = 32

_lock = threading.Lock()
# 内容签名 → 该内容实际画出来的字符集。
_charsets: OrderedDict[str, frozenset[str]] = OrderedDict()
# 子集指纹 → (常规体路径, 粗体路径)。
_subsets: OrderedDict[str, tuple[str, str]] = OrderedDict()
# 正在后台裁剪中的指纹（防止同一份被两个线程重复裁）。
_warming: set[str] = set()
# 后台预热开关。测试里关掉：预热是异步的，`stats()` 的即时断言会变成抛硬币。
_warm_enabled = True
_root: Path | None = None


def _cache_root() -> Path:
    """子集字体落盘的地方：**系统临时目录下按进程分家**，不碰数据目录。

    为什么不放 `DATA_DIR`：那里每加一个子目录都要进备份的资产类别清单
    （`test_new_data_directory_is_never_silent` 会红），而这里存的是可随时重建的缓存。

    为什么带 pid：`reset()` 会把这个目录清空，而"应用在跑 + 另一个后端进程（测试 / 第二个
    实例）在跑"是很常见的情形——共用一份目录时，对方一次 `reset()` 就能把本进程刚写好的
    子集删掉（实测：写完到 fpdf2 打开之间被删，渲染直接退回全量字体，且完全随机）。
    按进程分家之后谁也删不到谁。
    """
    global _root
    if _root is None:
        parent = Path(tempfile.gettempdir()) / "resumeforge-font-subsets"
        _root = parent / str(os.getpid())
        _sweep_old_processes(parent, keep=_root)
    # 每趟都确认目录还在：系统清理工具会删临时目录，删掉之后 fpdf 打开字体就报 not found。
    _root.mkdir(parents=True, exist_ok=True)
    return _root


def _sweep_old_processes(parent: Path, *, keep: Path) -> None:
    """收掉其它进程（多半是上次运行的应用实例）留下的、已经放了一天的子集目录。

    按 pid 分家的代价是每次启动多一个目录，不清就会一直堆在临时目录里。只清一天没动过的：
    同机上另一个正在跑的后端进程的目录 mtime 是新的，不会被误删。
    """
    cutoff = time.time() - 24 * 3600
    with suppress(OSError):
        for sibling in parent.iterdir():
            if sibling == keep or not sibling.is_dir():
                continue
            with suppress(OSError):
                if sibling.stat().st_mtime >= cutoff:
                    continue
                for stale in sibling.iterdir():
                    with suppress(OSError):
                        stale.unlink()
                sibling.rmdir()


def remember_charset(signature: str, chars: Iterable[str]) -> None:
    """记住"这份内容画了哪些字"，供下一次同内容的渲染用。"""
    # 空集、或只有空白的集合不能收：裁出这样的字体一个字形都没有，画什么都是空白页。
    # 但**空格本身是字形**（有宽度、会被画出来），集合里要留着——剔掉它，右对齐那一行就会
    # 因为空格退化成 fallback 宽度而整体平移十几点。
    payload = frozenset(chars)
    if not any(stripped for stripped in (ch.strip() for ch in payload)):
        return
    with _lock:
        _charsets[signature] = payload
        _charsets.move_to_end(signature)
        while len(_charsets) > MAX_CHARSETS:
            _charsets.popitem(last=False)


def charset_for(signature: str) -> frozenset[str] | None:
    with _lock:
        hit = _charsets.get(signature)
        if hit is not None:
            _charsets.move_to_end(signature)
        return hit


def forget_charset(signature: str) -> None:
    """丢掉一份字符集：子集字体渲染失败时用它退回全量字体。"""
    with _lock:
        _charsets.pop(signature, None)


def prewarm(fonts: tuple[str, str], chars: frozenset[str]) -> None:
    """在后台把子集裁好，好让下一趟同内容的渲染不用替它买单。

    裁一份子集（~200ms/字体）比渲染本身还贵，如果等"下一趟渲染"现裁，用户拖滑块的**第二步**
    就会比优化前还慢（实测 420ms 裁字体 + 36ms 渲染 > 400ms 全量）。而下一趟往往只隔几百
    毫秒（用户看一眼上一张图再拖），把这段开销藏在后台正好。

    失败无所谓：``subset_font_paths`` 自己不抛异常，这里还会再兜一层——预热只是提前干活，
    没干成的话下一趟照原样现裁。
    """
    if not _warm_enabled or not chars:
        return
    try:
        digest = _digest(fonts, chars)
    except Exception:  # noqa: BLE001 - 字体 stat 不到就没什么可预热的
        return
    with _lock:
        if digest in _subsets or digest in _warming:
            return
        _warming.add(digest)
    thread = threading.Thread(
        target=_warm_worker,
        args=(fonts, chars, digest),
        name=f"font-subset-{digest[:6]}",
        daemon=True,
    )
    thread.start()


def _warm_worker(fonts: tuple[str, str], chars: frozenset[str], digest: str) -> None:
    try:
        subset_font_paths(fonts, chars)
    except Exception as exc:  # noqa: BLE001 - 后台线程抛异常没人接，只能记日志
        logger.debug("后台预热字体子集失败：%s", exc)
    finally:
        with _lock:
            _warming.discard(digest)


def pending_warmups() -> int:
    """还没跑完的后台预热数：测试用它等预热结束，别让断言靠 sleep 撞运气。"""
    with _lock:
        return len(_warming)


def subset_font_paths(fonts: tuple[str, str], chars: frozenset[str]) -> tuple[str, str] | None:
    """把两个字体裁到 ``chars``，返回可以交给 fpdf 的两个文件路径。

    失败返回 ``None``（调用方用原字体照常排）——这个函数**永远不会抛异常**。
    """
    regular, bold = fonts
    try:
        # 指纹要 stat 字体文件，字体不存在时就在这里抛——必须留在 try 里，否则会逃出
        # 上面承诺的 fail-open。
        digest = _digest(fonts, chars)
    except Exception as exc:  # noqa: BLE001 - 见模块 docstring
        logger.warning("字体预子集化失败（本次改用全量字体，仅影响速度）：%s", exc)
        return None
    with _lock:
        hit = _subsets.get(digest)
        if hit is not None and all(Path(path).exists() for path in hit):
            _subsets.move_to_end(digest)
            return hit
        # 文件不在了（系统清理过临时目录，或者是并发 reset 之前裁的）：这份记录作废。
        _subsets.pop(digest, None)
    try:
        paths = tuple(
            str(_subset_file(source, style, digest, chars))
            for source, style in ((regular, "regular"), (bold, "bold"))
        )
    except Exception as exc:  # noqa: BLE001 - 见模块 docstring：加速失败绝不能阻断导出
        logger.warning("字体预子集化失败（本次改用全量字体，仅影响速度）：%s", exc)
        return None
    with _lock:
        _subsets[digest] = paths  # type: ignore[assignment]
        _subsets.move_to_end(digest)
        while len(_subsets) > MAX_SUBSETS:
            _subsets.popitem(last=False)
    return paths  # type: ignore[return-value]


def reset() -> None:
    """字体被换掉 / 测试隔离：字符集与子集文件全部作废。

    字体的身份（路径 + 体积 + mtime）已经在子集指纹里，正常换字体不会命中旧文件；这里
    主动清一遍是为了不留垃圾，也让"字体变更"这条路径在内存里立刻生效。
    """
    global _root
    with _lock:
        _charsets.clear()
        _subsets.clear()
        root = _root
    if root is None or not root.exists():
        return
    for path in root.iterdir():
        try:
            path.unlink()
        except OSError as exc:  # Windows 上被占用是常事：留着无害，下次启动会再清
            logger.debug("删不掉旧的字体子集 %s：%s", path, exc)


def stats() -> tuple[int, int]:
    """(记住的字符集条数, 已生成的子集份数)：调试与测试断言用。"""
    with _lock:
        return len(_charsets), len(_subsets)


# ===== 内部实现 =====


def _font_identity(path: str) -> str:
    """字体的身份：路径 + 体积 + 修改时间。

    只用路径不够——用户可能换掉同名文件（下载一个更全的 msyh.ttc 覆盖掉）。加上 mtime
    之后换字体必然换指纹，子集不会串。
    """
    stat = Path(path).stat()
    return f"{path}|{stat.st_size}|{int(stat.st_mtime)}"


def _digest(fonts: tuple[str, str], chars: frozenset[str]) -> str:
    payload = "|".join(_font_identity(path) for path in fonts) + "||" + "".join(sorted(chars))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _subset_file(source: str, style: str, digest: str, chars: frozenset[str]) -> Path:
    root = _cache_root()
    target = root / f"{digest}-{style}.ttf"
    if target.exists():
        return target
    _prune(root)
    _write_subset(source, target, chars)
    return target


def _prune(root: Path) -> None:
    files = sorted(root.glob("*.ttf"), key=lambda item: item.stat().st_mtime)
    for stale in files[: max(0, len(files) - MAX_SUBSET_FILES + 1)]:
        with suppress(OSError):
            stale.unlink()


def _write_subset(source: str, target: Path, chars: frozenset[str]) -> None:
    """用 fontTools 把字体裁到 ``chars``。

    选项与 fpdf2 输出时那一步对齐（保留 name / notdef 轮廓 / 重新算 bbox）：
    fpdf 随后还会再子集化一次，但对象已经是几百字的小字体，几乎不花时间。
    """
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(source, fontNumber=0, recalcTimestamp=False, lazy=True)
    options = subset.Options()
    # fontTools 的类型标注把这两个字段写成 `list[int]`，但运行时明确支持 `"*"`
    # （subset 里对 `"*" in options.name_IDs` 有专门分支，语义是"全部保留"）。
    # 这里按实际语义传，用 `cast` 记录"上游标注与运行时不一致"——换成整数列表会
    # 丢掉 name 记录，那是产物差异，不只是类型问题。
    options.name_IDs = cast("list[int]", ["*"])
    options.name_legacy = True
    options.name_languages = cast("list[int]", ["*"])
    options.layout_features = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=[ord(char) for char in chars])
    subsetter.subset(font)
    # 先写临时名再原子改名：另一个线程/进程不会读到半个文件。临时名带 pid 与线程号，
    # 两个进程同时裁同一份时也不会互相覆盖。
    temp = target.with_name(f"{target.name}.{os.getpid()}-{threading.get_ident()}.tmp")
    try:
        font.save(str(temp))
        _replace_with_retry(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def _replace_with_retry(temp: Path, target: Path, attempts: int = 3) -> None:
    """改名失败重试几次。

    本机 Windows + Defender 实测会抓到一次 ``[WinError 5] 拒绝访问``：文件刚写完就被实时
    防护打开扫描，这一刻改名会被拒。重试三次（每次 30ms）就够躲过去；躲不过就让它抛，
    上层照旧退回全量字体——加速失败不该变成导出失败。
    """
    for attempt in range(attempts):
        try:
            temp.replace(target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.03)

# SPDX-License-Identifier: Apache-2.0
"""精确预览的**逐页位图**（P3-2）：把导出 PDF 光栅化成 WebP，交给前端用 `<img>` 逐页铺开。

## 为什么不再用 iframe 装 PDF

精确预览此前把导出 PDF 交给浏览器内置查看器（`<iframe src="blob:…pdf">`）。产物确实
与导出逐字节相同，但查看器是**别人的文档**：它在 iframe 里再画一条自己的竖向滚动条、
底部再画一条横向滚动条，还在纸边画一圈深色描边。外层 `.exact-preview` 在 100% 时
`overflow: visible`，**不具备滚动能力**——那两条条属于查看器内部，CSS 够不到；
`.exact-preview-paper-column` 恒比 `.exact-preview-stack` 高 56px（`VIEWER_CHROME_PX`）
也是同一个来源。

另一条硬伤：**无头 Chromium 不出图**。`--headless=new` 下内置查看器不渲染 PDF，
我们的截图链与 CI 一直是盲区。

所以改成：服务端把 PDF 的每一页渲染成位图，前端只做 `<img>`。高度、页间距、缩放全部
由我们自己算，滚动条、描边、工具栏一次消失；headless 也能截出完整页面。

## 分辨率口径

`width × dpr × 1.5`：`width` 是前端相框的 CSS 像素宽，`dpr` 是设备像素比，1.5 是
**高倍缩放的余量**（200% 缩放时位图仍有 1.5 倍的像素密度，肉眼已看不出差别）。A4 960px
宽、dpr=1 → 1440×2037；dpr=1.25 → 1800×2546。单页长边封顶 `MAX_LONG_EDGE_PX`，防止
超长稿把内存吃穿。**别再往 2× 调回去**：那是 #23 实测里最贵的一项，像素总量多 78%。

**不要**复用 `services/pdf_page_images.py`：那一份是给模型视觉用的 150DPI / JPEG80 /
长边 1600px，印在屏幕上一眼就糊。

## 并发

一趟渲染按页拆成任务丢进线程池（`min(页数, 4)` 路）。pypdfium2 **不是线程安全的**，
所以每个任务各自 `PdfDocument(io.BytesIO(pdf_bytes))` 打开一份——共用同一个对象会崩在
C 层。字节流本身只读，线程间共享是安全的；落盘按页写不同文件（`_write_atomic` 各自
`os.replace`），不会互相覆盖。

## 缓存

渲染一趟约 200–600ms（3 页 A4，未并发时），而"改一个滑块 → 再拖回来"会重复问同一份。
派生结果落在**系统临时目录**（`%TEMP%/resumeforge-preview-pages/<token>/`）：

- 不进数据集、不进备份——它是可丢弃的中间产物，重启后重算即可；
- token = `sha256(PDF 字节 + 宽高桶 + 超采样倍数)`，内容或版式任何一项变了 token 就变，
  **不需要失效逻辑**；把 `render_config_fingerprint` 折进 PDF 字节这件事本身已经由导出
  管线完成（PDF 内容随版式不同而不同），拿产物哈希当键比再拼一次指纹更严格：产物才是
  渲染的唯一真值；
- 宽高**分桶**（宽度 64px、dpr 0.25）：拖分隔条时宽度每变 1px 都重渲一遍是不可接受的，
  而 64px 的差在屏幕上等价于同一张图（前端按实际宽度缩放显示）。
  **前端 `frontend/src/components/resume-preview/previewPages.ts::previewWidthBucket`
  必须用同一个 64**，改一处必须改另一处（#23 R2：口径不一致会让前端判"没变"、后端仍重渲）。

LRU 写法与 `services/pdf_preview_cache.py` 同一套（OrderedDict + 条数上限 + 整目录回收），
不另发明。写盘一律"先写临时文件再 `os.replace`"，避免半张图被 GET 到。
"""

from __future__ import annotations

import contextlib
import functools
import hashlib
import io
import json
import logging
import os
import re
import shutil
import tempfile
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pypdfium2 as pdfium

logger = logging.getLogger(__name__)

# 1.5× 超采样（#23 P1）：位图仍比 CSS 尺寸密，但像素总量只有 2× 的 56%。
# 降这一项**必须**一起改 `page_token` 里的指纹（它已经折进 token）：否则老目录里
# 2× 的图会被当成 1.5× 的同一份继续复用。
RENDER_SUPERSAMPLE = 1.5
# 单页位图长边上限（px）：3 页 A4 在 1.5× 下约 1900px 长边，封顶 3000 留足余量。
MAX_LONG_EDGE_PX = 3000
# WebP 质量（#23 P1）：82 与 90 在 A4 文字页上肉眼无差（对比图见
# `deliverables/software-company/evidence/23-preview-speed/`），编码耗时与体积都更低。
WEBP_QUALITY = 82
# WebP 编码档位（#23 P1）：4 是最慢档（最高压缩）。2 的体积只大几个百分点、编码快
# 一倍以上——预览图是可重算的派生数据，为几 KB 多等几百毫秒不划算。
# 质量若真发虚，回退顺序是"先把 method 调回 4、再动 quality"，不要反过来。
WEBP_METHOD = 2
# 宽度分桶 64px（#23 P3）：**前端 `previewWidthBucket` 必须同值，改一处必须改另一处**。
# 16px 时拖一次分隔条就换桶、整版重渲；64px 的差在屏幕上等价于同一张图（前端按实际
# 宽度缩放显示），却把重渲次数降到四分之一，也让"前端以为没变、后端已经重渲"的错配消失。
WIDTH_BUCKET_PX = 64
DPR_BUCKET = 0.25
MIN_DPR = 1.0
MAX_DPR = 3.0
# 逐页并发的线程数上限（#23 P2）：pypdfium2 不是线程安全的，所以**每个线程各自打开
# 一份 PDF 字节流**（见 `_open_document`）。4 是"两页稿能并行、多页稿不再无限加线程"
# 的折中：再高只是在 C 层抢同一批内存带宽，顺带把峰值 RSS 顶上去。
MAX_RENDER_THREADS = 4
# 最多留几组 token：一轮"改字号 → 改行距 → 拖回来"最多用到 4 组，12 组足够且不占内存。
MAX_TOKENS = 12

CACHE_ROOT_NAME = "resumeforge-preview-pages"
MANIFEST_NAME = "manifest.json"
PDF_NAME = "document.pdf"
PAGE_MEDIA_TYPE = "image/webp"
#: token 的**唯一**合法形状：`sha256(...).hexdigest()[:32]`，即 32 位小写十六进制。
_TOKEN_RE = re.compile(r"[0-9a-f]{32}")


class PreviewPagesError(RuntimeError):
    """PDF 无法光栅化（文件损坏 / 引擎缺字体）。调用方按 409 + 可读文案回给用户。"""


@dataclass(frozen=True)
class PreviewPageSize:
    """一页位图的**像素**尺寸（不是 CSS 尺寸：前端按宽高比自己折算）。"""

    index: int
    width: int
    height: int


@dataclass(frozen=True)
class RenderedPreviewPages:
    """一趟渲染的结果：token（也是缓存目录名）+ 逐页像素尺寸。"""

    token: str
    pages: tuple[PreviewPageSize, ...]

    @property
    def page_count(self) -> int:
        return len(self.pages)


_lock = threading.Lock()
_tokens: OrderedDict[str, None] = OrderedDict()


def bucket_width(width_px: int) -> int:
    """把请求的 CSS 宽度折进 `WIDTH_BUCKET_PX` 的桶（向上取，绝不小于 1）。"""
    width = int(width_px)
    if width <= 0:
        raise ValueError("预览页宽度必须为正数")
    return max(WIDTH_BUCKET_PX, -(-width // WIDTH_BUCKET_PX) * WIDTH_BUCKET_PX)


def bucket_dpr(dpr: float) -> float:
    """把 device pixel ratio 折进 `DPR_BUCKET` 的桶，并夹在 `[MIN_DPR, MAX_DPR]`。"""
    try:
        value = float(dpr)
    except (TypeError, ValueError):
        value = MIN_DPR
    if value != value or value <= 0:  # NaN / 非正数：按 1 处理（宁可能糊一点，也别空白）
        value = MIN_DPR
    stepped = round(value / DPR_BUCKET) * DPR_BUCKET
    return round(min(MAX_DPR, max(MIN_DPR, stepped)), 2)


def page_token(pdf_bytes: bytes, *, width_px: int, dpr: float) -> str:
    """内容寻址的 token：同一份 PDF 字节 + 同一个宽高桶 → 同一个 token。

    不掺时间、不掺随机数：前端把 token 写进 `<img src>`，GET 必须能命中同一份；
    版式一变 PDF 就变，token 自然跟着变（见模块 docstring 的「缓存」一节）。
    """
    digest = hashlib.sha256()
    digest.update(pdf_bytes)
    digest.update(b"|")
    digest.update(f"{bucket_width(width_px)}x{bucket_dpr(dpr)}{RENDER_SUPERSAMPLE}".encode())
    return digest.hexdigest()[:32]


def cache_root() -> Path:
    """派生数据的根目录：系统临时目录，**不进数据集/备份**（见模块 docstring）。"""
    return Path(tempfile.gettempdir()) / CACHE_ROOT_NAME


def cache_dir(token: str) -> Path:
    return cache_root() / token


def page_path(token: str, index: int) -> Path:
    return cache_dir(token) / f"{int(index)}.webp"


def pdf_path(token: str) -> Path:
    return cache_dir(token) / PDF_NAME


def _find_bundle(token: str) -> Path | None:
    """按名字在缓存根下找 token 目录；形状不合或不存在返回 ``None``。

    **只做白名单查找，不用请求里的字符串拼路径**：命中的 ``Path`` 来自 ``iterdir()``，
    请求参数只是"要找的目录名"。这样即使调用方忘了校验，路径也不可能被输入左右——
    CodeQL 的 ``py/path-injection`` 认的正是"路径不来自输入"，而不是"输入看起来像个哈希"。
    目录数被 ``MAX_TOKENS`` 限制在十几个，逐个比名字的代价可以忽略。
    """
    if not _TOKEN_RE.fullmatch(token):
        return None
    root = cache_root()
    try:
        children = list(root.iterdir())
    except OSError:  # 目录还没建（从未渲染过）或没有读权限
        return None
    for child in children:
        if child.name == token and child.is_dir():
            return child
    return None


def lookup_page(token: str, index: int) -> Path | None:
    """GET 用：``(token, index)`` 对应的那页位图；不存在返回 ``None``（调用方回 404）。"""
    bundle = _find_bundle(token)
    if bundle is None:
        return None
    page = bundle / f"{int(index)}.webp"
    return page if page.is_file() else None


def lookup_pdf(token: str) -> Path | None:
    """GET 用：``token`` 对应的那份 PDF（「在新标签打开」）；不存在返回 ``None``。"""
    bundle = _find_bundle(token)
    if bundle is None:
        return None
    document = bundle / PDF_NAME
    return document if document.is_file() else None


def _write_atomic(target: Path, payload: bytes) -> None:
    """先写同目录临时文件再 `os.replace`：GET 永远读不到半张图。"""
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(dir=str(target.parent), suffix=".part")
    try:
        # `mkstemp` 给的是 fd：用 `os.fdopen` 接管，避免泄漏句柄。
        with os.fdopen(handle, "wb") as stream:
            stream.write(payload)
        os.replace(temp_name, target)
    except BaseException:
        # 半成品文件必须清掉，否则下一次写同一页会撞上残留（`os.replace` 会覆盖，但临时
        # 文件名是随机的，留着只会脏目录）。清理失败不能盖住原始异常，所以只抑制 OSError。
        with contextlib.suppress(OSError):
            Path(temp_name).unlink()
        raise


def _remember(token: str) -> None:
    """登记 token 并按条数回收最久未用的整目录（LRU，与 `pdf_preview_cache` 同一套）。"""
    with _lock:
        _tokens.pop(token, None)
        _tokens[token] = None
        while len(_tokens) > MAX_TOKENS:
            dropped, _ = _tokens.popitem(last=False)
            shutil.rmtree(cache_dir(dropped), ignore_errors=True)


def _read_manifest(token: str) -> RenderedPreviewPages | None:
    """读已完成的 manifest；文件缺失/损坏/与 PDF 对不上都按"没渲染过"处理。"""
    manifest = cache_dir(token) / MANIFEST_NAME
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        pages = tuple(
            PreviewPageSize(
                index=int(item["index"]), width=int(item["width"]), height=int(item["height"])
            )
            for item in payload["pages"]
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not pages:
        return None
    if not all(page_path(token, page.index).is_file() for page in pages):
        return None
    # 命中也要记一笔使用：否则"一直在看的那一版"会被刚改过的旧版本挤掉。
    with _lock:
        if token in _tokens:
            _tokens.move_to_end(token)
    return RenderedPreviewPages(token=token, pages=pages)


def _open_document(pdf_bytes: bytes) -> pdfium.PdfDocument:
    """为**当前线程**打开一份独立的 PDF 句柄。

    pypdfium2 的 `PdfDocument` 不是线程安全的：多线程共用一个对象会在 C 层崩掉,
    那不是可捕获的 Python 异常，日志里只会看到进程消失。所以"逐页并发"的前提是
    "每个线程各自打开一份字节流"——字节流本身只读，可以安全共享。

    :raises PreviewPagesError: 文件损坏 / 引擎拒绝打开。
    """
    try:
        return pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    except Exception as exc:  # noqa: BLE001 - pdfium 的失败类型没有稳定基类
        raise PreviewPagesError(f"无法打开导出 PDF：{exc}") from exc


def _page_count(pdf_bytes: bytes) -> int:
    """页数：开一份临时句柄数完就关（不给并发线程留下共享对象）。

    :raises PreviewPagesError: PDF 打不开 / 里面一页都没有。
    """
    document = _open_document(pdf_bytes)
    try:
        count = len(document)
    finally:
        document.close()
    if count == 0:
        raise PreviewPagesError("导出 PDF 里没有页面")
    return count


def _render_one_page(
    pdf_bytes: bytes, index: int, *, token: str, target_px: float
) -> PreviewPageSize:
    """渲染**一页**并落盘。可以安全地在多个线程里同时调用（各自持有一份文档）。

    :param pdf_bytes: 整份 PDF 字节（只读，线程间共享）。
    :param index: 0 起始页号；返回的 `PreviewPageSize.index` 与它一致。
    :param token: 缓存目录名。
    :param target_px: 目标位图宽（已经乘过超采样）。
    :raises PreviewPagesError: 渲染或编码失败。
    """
    document = _open_document(pdf_bytes)
    try:
        page = document[index]
        width_pt, height_pt = page.get_size()
        long_edge_pt = max(width_pt, height_pt)
        # 目标像素宽 / 页面点宽 = 需要的缩放系数；再按长边上限收敛。
        scale = target_px / width_pt if width_pt else 1.0
        if long_edge_pt:
            scale = min(scale, MAX_LONG_EDGE_PX / long_edge_pt)
        # pypdfium2 的 `scale` 没有类型标注（默认 `1` 让静态检查以为只收 int），
        # 运行时是浮点系数；取整会把 1.5× 掉回 1×，所以按浮点传 + `cast` 说明。
        bitmap = page.render(scale=cast(int, scale))
        image = bitmap.to_pil()
        if image.mode != "RGB":
            # WebP 支持 alpha，但 PDF 的"透明"应当显示成白纸：先并到白底再丢 alpha，
            # 直接 `convert("RGB")` 会把透明区压成黑色。
            canvas = image.convert("RGBA")
            background = type(image).new("RGBA", canvas.size, (255, 255, 255, 255))
            image = type(image).alpha_composite(background, canvas).convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
        _write_atomic(page_path(token, index), buffer.getvalue())
        return PreviewPageSize(index=index, width=image.width, height=image.height)
    except PreviewPagesError:
        raise
    except Exception as exc:  # noqa: BLE001 - 同上
        raise PreviewPagesError(f"渲染第 {index + 1} 页失败：{exc}") from exc
    finally:
        document.close()


def _render_pages(
    pdf_bytes: bytes, *, token: str, width_px: int, dpr: float
) -> RenderedPreviewPages:
    """真正渲染一趟：**逐页并发** → WebP → 落盘。**不在锁里跑**（会卡住其它请求）。

    并发度取 `min(页数, MAX_RENDER_THREADS)`：两页稿两路、四页以上不再加路。
    结果按页号收回（`ThreadPoolExecutor.map` 保序），返回值结构与串行版逐字段一致。
    """
    target_px = bucket_width(width_px) * bucket_dpr(dpr) * RENDER_SUPERSAMPLE
    count = _page_count(pdf_bytes)
    workers = min(count, MAX_RENDER_THREADS)
    try:
        if workers <= 1:
            sizes = [
                _render_one_page(pdf_bytes, index, token=token, target_px=target_px)
                for index in range(count)
            ]
        else:
            worker = functools.partial(
                _render_one_page, pdf_bytes, token=token, target_px=target_px
            )
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="preview-page") as pool:
                # `map` 按提交顺序产出：页序与导出 PDF 逐页对应，前端 `<img>` 不会错位。
                sizes = list(pool.map(worker, range(count)))
    except PreviewPagesError:
        raise
    except Exception as exc:  # noqa: BLE001 - 同上
        raise PreviewPagesError(f"渲染预览页失败：{exc}") from exc
    manifest = {
        "width": bucket_width(width_px),
        "dpr": bucket_dpr(dpr),
        "pages": [
            {"index": page.index, "width": page.width, "height": page.height} for page in sizes
        ],
    }
    # manifest 最后写：它是"这一组页已经渲染完"的唯一标志（见 `_read_manifest`）。
    _write_atomic(
        cache_dir(token) / MANIFEST_NAME,
        json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
    )
    return RenderedPreviewPages(token=token, pages=tuple(sizes))


def render_preview_pages(pdf_bytes: bytes, *, width_px: int, dpr: float) -> RenderedPreviewPages:
    """把 PDF 渲染成逐页 WebP（命中缓存则 0 次光栅化）。

    :param pdf_bytes: 导出管线的产物字节（与「导出 PDF」逐字节相同）。
    :param width_px: 前端相框的 CSS 像素宽（分桶后使用）。
    :param dpr: 设备像素比（分桶并夹在 `[1, 3]`）。
    :raises PreviewPagesError: PDF 打不开 / 渲染失败。
    """
    token = page_token(pdf_bytes, width_px=width_px, dpr=dpr)
    cached = _read_manifest(token)
    if cached is not None:
        return cached
    directory = cache_dir(token)
    # 半成品目录（上一趟崩在中途）：先清掉，避免 manifest 与图片错位。
    if directory.exists() and not (directory / MANIFEST_NAME).is_file():
        shutil.rmtree(directory, ignore_errors=True)
    rendered = _render_pages(pdf_bytes, token=token, width_px=width_px, dpr=dpr)
    # 「在新标签打开」用同一份字节：落一份 PDF 进同一目录，GET 直接读，不再重排。
    pdf_target = pdf_path(token)
    if not pdf_target.is_file():
        _write_atomic(pdf_target, pdf_bytes)
    _remember(token)
    return rendered


def clear_cache() -> None:
    """整份清掉：测试隔离用（也让"换数据集"将来有明确出口）。"""
    with _lock:
        _tokens.clear()
    shutil.rmtree(cache_root(), ignore_errors=True)


def cache_stats() -> tuple[int, int]:
    """(登记的 token 数, 目录总字节)：调试与测试断言用。"""
    with _lock:
        tokens = len(_tokens)
    total = 0
    root = cache_root()
    if root.is_dir():
        for path in root.rglob("*"):
            if path.is_file():
                total += path.stat().st_size
    return tokens, total

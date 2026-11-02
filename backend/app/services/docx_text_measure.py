# SPDX-License-Identifier: Apache-2.0
"""Word 侧文本宽度度量（2026-11 #9）：用导出声明的那款字体，按 96dpi 折算成毫米。

## 为什么 Word 也需要"量文本宽度"

预览里联系方式按**字段**断行（`.contact span { white-space: nowrap }` + 字段间 `<wbr>`），
PDF 侧有 `pdf.rich_text_width` 做贪心装行，Word 侧此前把整组字段拼成一段交给 Word 自己
度量——三端行分布因此对不上（用户看到"预览 GitHub 起第二行、Word 个人主页才落第二行"）。

要复用 `resume_contact.pack_contact_lines`，Word 侧就必须给出一个与 Word 排版口径接近的
宽度函数。这里用 **Pillow 读同一个字体文件**（`resolve_font_paths`：本简历选择 → 当前
全局字体 → 系统候选，与 PDF 完全同一条解析），字号按版面 px 值、宽度按 96dpi 折 mm。

## 边界（必须如实说明）

* python-docx 只写字体**族名**、不嵌入字体；打开端缺这款字时 Word 会替代。本度量因此
  只承诺"与 PDF 的行分布同口径"，不承诺 Word 里逐像素一致；
* 字体文件探测不到（Linux CI 常见）时返回 `None`，调用方退回"整段交给 Word 换行"的旧
  行为——导出不会因为量不出宽度而失败；
* 度量失败（坏字符 / 字体被删）逐个降级为 `0.0`（"装得下"），由 Word 自己兜底换行。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import lru_cache

from .pdf_exporter.fonts import resolve_font_paths

logger = logging.getLogger(__name__)

#: CSS px → mm（与 `pdf_exporter.layout._PX_TO_MM` 同一口径：96dpi）。
PX_TO_MM = 25.4 / 96


@lru_cache(maxsize=8)
def _load_font(path: str, size_px: int):
    """按磅值/像素加载字体（进程内缓存：同一份导出会为每个联系方式行调很多次）。

    **必须从内存加载，不能把路径交给 Pillow**：`ImageFont.truetype(路径)` 会持有该文件的
    句柄（Windows 上是 mmap），此后同一进程里再写这个字体文件会直接 `OSError [Errno 22]`——
    用户上传的字体正是"会被重写"的文件，实测表现是第二次导出/上传同名字体失败。
    读成 `bytes` 再交给 Pillow 后，文件句柄当场释放。
    """
    from io import BytesIO
    from pathlib import Path

    from PIL import ImageFont

    data = Path(path).read_bytes()
    return ImageFont.truetype(BytesIO(data), size=max(1, size_px))


def make_text_measure(size_px: float, font_key: str | None = None) -> Callable[[str], float] | None:
    """构造"文本 → 宽度（mm）"的度量函数；字体不可用时返回 `None`。

    :param size_px: 该行文字的字号，单位是版面的 CSS px（Word 侧写 `pt = px * 0.75`，
        所以这里直接用 px 加载字体即可对齐）。
    :param font_key: 这份简历选的字体键（`format_config` 的字体项）；`None` = 跟随
        当前全局字体 / 系统候选，与 PDF 的解析顺序一致。
    """
    paths = resolve_font_paths(font_key)
    if not paths:
        logger.info("Word 联系方式装行：没有可用字体文件，退回整段换行")
        return None
    try:
        font = _load_font(str(paths[0]), int(round(size_px)))
    except Exception:  # noqa: BLE001 - 字体读不出来不能让导出失败
        logger.warning("Word 联系方式装行：字体加载失败，退回整段换行", exc_info=True)
        return None

    def measure(text: str) -> float:
        try:
            return float(font.getlength(text)) * PX_TO_MM
        except Exception:  # noqa: BLE001 - 个别坏字符按 0 宽处理，Word 自己兜底
            return 0.0

    return measure


__all__ = ["PX_TO_MM", "make_text_measure"]

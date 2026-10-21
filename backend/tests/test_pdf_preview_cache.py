# SPDX-License-Identifier: Apache-2.0
"""精确预览缓存的 LRU 语义（``services/pdf_preview_cache``）。

它是"同一组参数只排一次 PDF"的落点：命中 = 0ms，未命中 = ~450ms（字体解析占七成）。
所以这里必须钉住三件事：命中返回同一份字节与头、命中会刷新 LRU 顺序、容量到顶时淘汰
**最久未用**的那一份（不能把用户刚看过的扔掉）。
"""

from __future__ import annotations

from app.services import pdf_preview_cache
from app.services.pdf_preview_cache import CachedPreviewPdf


def _entry(size: int = 8) -> CachedPreviewPdf:
    return CachedPreviewPdf(
        content=b"%PDF-1.3" + b"0" * size,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline", "Cache-Control": "no-store"},
    )


def setup_function() -> None:
    pdf_preview_cache.clear()


def teardown_function() -> None:
    pdf_preview_cache.clear()


def test_hit_returns_the_same_bytes_and_headers():
    pdf_preview_cache.put("a", _entry())

    hit = pdf_preview_cache.get("a")

    assert hit is not None
    assert hit.content == _entry().content
    assert hit.headers["Cache-Control"] == "no-store"
    assert pdf_preview_cache.get("没有这个键") is None


def test_hit_moves_the_entry_to_the_recent_end():
    for key in ("a", "b", "c"):
        pdf_preview_cache.put(key, _entry())

    # 命中 a → 顺序变成 b, c, a；再存到容量顶满，最该被淘汰的是 b（而不是刚看过的 a）。
    assert pdf_preview_cache.get("a") is not None
    for index in range(pdf_preview_cache.MAX_ENTRIES - 2):
        pdf_preview_cache.put(f"x{index}", _entry())

    assert pdf_preview_cache.get("a") is not None
    assert pdf_preview_cache.get("b") is None
    assert pdf_preview_cache.get("c") is not None


def test_byte_budget_drops_the_oldest_but_keeps_the_newest(monkeypatch):
    # 把预算压到 24 字节，三份 10 字节的产物就够触发淘汰（不必真的分配几十 MB）。
    monkeypatch.setattr(pdf_preview_cache, "MAX_BYTES", 24)
    payload = b"x" * 10
    for key in ("a", "b", "c"):
        pdf_preview_cache.put(key, CachedPreviewPdf(payload, "application/pdf", {}))

    entries, total = pdf_preview_cache.stats()
    assert entries <= 2
    assert total <= 24
    # 刚写的那份一定还在：刚存完就删等于没缓存。
    assert pdf_preview_cache.get("c") is not None


def test_clear_empties_everything():
    pdf_preview_cache.put("a", _entry())
    pdf_preview_cache.clear()

    assert pdf_preview_cache.stats() == (0, 0)
    assert pdf_preview_cache.get("a") is None


def test_changing_the_active_font_drops_cached_previews():
    """换字体必须连这份缓存一起清：键里**没有字体文件本身**。

    只清 PDF 的字体探测缓存（``reset_font_cache``）是不够的——内存里躺着的是上一次用旧
    字体排出来的字节，用户看到的是"字体换了、精确预览还是旧字体"，而这条路径没有任何
    报错可以查。``api/fonts.py`` 的上传/启用/删除三处都走 ``_invalidate_render_caches``。
    """
    from app.api.fonts import _invalidate_render_caches

    pdf_preview_cache.put("k", _entry())
    assert pdf_preview_cache.stats()[0] == 1

    _invalidate_render_caches()

    assert pdf_preview_cache.stats() == (0, 0)

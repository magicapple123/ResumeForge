# SPDX-License-Identifier: Apache-2.0
"""把当前自定义字体子集化后内嵌进简历 HTML（R10）。

为什么要在 HTML 里内嵌：预览、导出 HTML、导出 PDF 必须是**同一款字**。PDF 端已经由
``pdf_exporter/fonts.py`` 直接读字体文件实现；HTML 端没有任何办法假设"用户机器上装了
这款字"，所以只能把用到的字形切出来，以 ``data:`` URL 塞进 ``@font-face``。整份 20MB
字体不能塞——一份中文简历只用到几百个字，子集通常是 200–400KB。

失败策略是"绝不让渲染失败"：字体损坏、字体集合读不出、子集化抛错、子集反而变大，一律
记 warning 并退回模板自带的系统字体栈。用户上传了字体却看到系统字体，比看不到简历好。
"""

from __future__ import annotations

import base64
import functools
import hashlib
import io
import logging
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont

from . import user_fonts

logger = logging.getLogger(__name__)

# CSS 里用的族名固定，跟用户字体的真实族名无关：真实族名只用于日志与调试。
CSS_FAMILY = "ResumeActiveFont"
# 子集化后仍然超过这个体积就放弃内嵌（正常 CJK 简历子集约 200–400KB）。
MAX_EMBED_BYTES = 1_500_000

# ASCII 可打印字符 + 常用中文标点：简历里的数字、日期、英文专有名词与标点几乎都落在这里，
# 而它们未必出现在 ``text`` 的字符集里（例如模板自己画的分隔符）。
_EXTRA_CHARS = "".join(chr(code) for code in range(0x20, 0x7F)) + (
    "，。、；：？！“”‘’（）《》【】〈〉…—～·　％＃＆＋－／"
)
_FALLBACK_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'


def _family_name(font: TTFont, path: Path) -> str:
    """字体族名；取不到就用文件名（不带扩展名），只用于日志/调试。"""
    try:
        for record in font["name"].names:
            if record.nameID != 1:
                continue
            try:
                value = record.toUnicode().strip()
            except (UnicodeDecodeError, ValueError):
                continue
            if value:
                return value
    except (KeyError, AttributeError):
        pass
    return path.stem


def _read_font_bytes(path: Path) -> tuple[str, bytes]:
    """读出可用于子集化的单 face 字节；``.ttc`` 取 face 0 并拆成独立字体。"""
    raw = path.read_bytes()
    if path.suffix.lower() != ".ttc":
        # 先解析一次：损坏文件在这里就暴露，而不是到 subset 里抛奇怪的 KeyError。
        font = TTFont(io.BytesIO(raw))
        try:
            return _family_name(font, path), raw
        finally:
            font.close()

    collection = TTCollection(io.BytesIO(raw))
    try:
        if not collection.fonts:
            raise ValueError("字体集合里没有任何 face")
        face = collection.fonts[0]
        buffer = io.BytesIO()
        face.save(buffer)
        return _family_name(face, path), buffer.getvalue()
    finally:
        for item in collection.fonts:
            item.close()


def active_web_font() -> tuple[str, bytes] | None:
    """当前自定义字体的 (族名, 单 face 字节)；没选字体或文件读不出时返回 None。"""
    path = user_fonts.active_font_path()
    if path is None:
        return None
    try:
        return _read_font_bytes(path)
    except Exception as exc:  # noqa: BLE001 - 读字体失败只该退回系统字体
        logger.warning("读取自定义字体失败（%s）：%s", path.name, exc)
        return None


def _subset_bytes(data: bytes, text: str) -> tuple[bytes, str, str]:
    """按 ``text`` 的字符集子集化，返回 (字节, MIME 子类型, CSS format() 关键字)。"""
    font = TTFont(io.BytesIO(data))
    try:
        options = subset.Options()
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text="".join(sorted(set(text) | set(_EXTRA_CHARS))))
        subsetter.subset(font)
        buffer = io.BytesIO()
        font.save(buffer)
        # CFF 轮廓的 OTF 不是 TrueType：标成 truetype 会被一部分浏览器直接拒绝。
        if font.sfntVersion == "OTTO":
            return buffer.getvalue(), "otf", "opentype"
        return buffer.getvalue(), "ttf", "truetype"
    finally:
        font.close()


def _build_css(payload: bytes, mime: str, css_format: str) -> str:
    encoded = base64.b64encode(payload).decode("ascii")
    return (
        f'@font-face{{font-family:"{CSS_FAMILY}";'
        f'src:url(data:font/{mime};base64,{encoded}) format("{css_format}");}}'
        f'\nbody{{font-family:"{CSS_FAMILY}",{_FALLBACK_STACK} !important}}'
    )


@functools.lru_cache(maxsize=8)
def _embed_css_cached(font_path: str, mtime_ns: int, text_digest: str, text: str) -> str:
    """按 (字体路径, mtime, 文本 sha256) 缓存；缓存未命中才真的切一次字。

    文件换了（mtime 变）或简历文本变了（digest 变）都会落到新键上，所以不需要手动失效。
    """
    del mtime_ns, text_digest  # 只作为缓存键使用
    try:
        _, data = _read_font_bytes(Path(font_path))
        payload, mime, css_format = _subset_bytes(data, text)
    except Exception as exc:  # noqa: BLE001 - 子集化失败不该让渲染失败
        logger.warning("内嵌自定义字体失败，回退系统字体：%s", exc)
        return ""
    if len(payload) > MAX_EMBED_BYTES:
        logger.warning(
            "自定义字体子集有 %d 字节，超过 %d 上限，回退系统字体",
            len(payload),
            MAX_EMBED_BYTES,
        )
        return ""
    return _build_css(payload, mime, css_format)


def embed_css(text: str) -> str:
    """返回内嵌当前字体的 CSS；没有可用字体时返回空串（调用方据此不插 style）。"""
    path = user_fonts.active_font_path()
    if path is None:
        return ""
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError as exc:
        logger.warning("读取自定义字体信息失败（%s）：%s", path.name, exc)
        return ""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return _embed_css_cached(str(path), mtime_ns, digest, text)

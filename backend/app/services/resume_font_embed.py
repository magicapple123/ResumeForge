# SPDX-License-Identifier: Apache-2.0
"""把当前自定义字体子集化后内嵌进简历 HTML（R10）。

为什么要在 HTML 里内嵌：预览、导出 HTML、导出 PDF 必须是**同一款字**。PDF 端已经由
``pdf_exporter/fonts.py`` 直接读字体文件实现；HTML 端没有任何办法假设"用户机器上装了
这款字"，所以只能把用到的字形切出来，以 ``data:`` URL 塞进 ``@font-face``。整份 30MB
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
from .resume.resume_template_format import SYSTEM_FONT

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


def _font_face(payload: bytes, mime: str, css_format: str, weight: int) -> str:
    """一条 ``@font-face``。``weight`` 必须写死：两条同族名的 face 靠它区分字重。"""
    encoded = base64.b64encode(payload).decode("ascii")
    return (
        f'@font-face{{font-family:"{CSS_FAMILY}";font-weight:{weight};'
        f'src:url(data:font/{mime};base64,{encoded}) format("{css_format}");}}'
    )


def _build_css(regular: tuple[bytes, str, str], bold: tuple[bytes, str, str] | None) -> str:
    """常规 + 粗体两条 ``@font-face``，再加一条 body 覆盖。

    只有**内置双字重字体**才给 ``bold``；单文件的历史字体只出一条 ``font-weight:400``，
    浏览器对 700 走自身的合成加粗——那是本功能上线前的行为，不回退它。
    """
    faces = [_font_face(*regular, 400)]
    if bold is not None:
        faces.append(_font_face(*bold, 700))
    return "\n".join(faces) + (
        f'\nbody{{font-family:"{CSS_FAMILY}",{_FALLBACK_STACK} !important}}'
    )


@functools.lru_cache(maxsize=8)
def _embed_css_cached(
    font_path: str,
    mtime_ns: int,
    bold_path: str,
    bold_mtime_ns: int,
    text_digest: str,
    text: str,
) -> str:
    """按 (常规路径/mtime, 粗体路径/mtime, 文本 sha256) 缓存；未命中才真的切字。

    粗体的 mtime 必须进缓存键：内置字体两个文件是分别下载的，只按 Regular 的 mtime
    做键的话，"Bold 换了但 Regular 没变"（例如先删后单独补下 Bold）会命中旧 CSS，
    用户看到的是"换了粗体不生效"。
    """
    del mtime_ns, bold_mtime_ns, text_digest  # 只作为缓存键使用
    bold: tuple[bytes, str, str] | None = None
    try:
        _family, regular_data = _read_font_bytes(Path(font_path))
        regular = _subset_bytes(regular_data, text)
        if bold_path and bold_path != font_path:
            try:
                _, bold_data = _read_font_bytes(Path(bold_path))
                bold = _subset_bytes(bold_data, text)
            except Exception as exc:  # noqa: BLE001 - 缺粗体只该少一档字重，不该整体失败
                logger.warning("读取粗体字面失败，仅内嵌常规字重：%s", exc)
                bold = None
    except Exception as exc:  # noqa: BLE001 - 子集化失败不该让渲染失败
        logger.warning("内嵌自定义字体失败，回退系统字体：%s", exc)
        return ""
    payload_size = len(regular[0]) + (len(bold[0]) if bold else 0)
    if payload_size > MAX_EMBED_BYTES:
        logger.warning(
            "自定义字体子集有 %d 字节，超过 %d 上限，回退系统字体",
            payload_size,
            MAX_EMBED_BYTES,
        )
        return ""
    return _build_css(regular, bold)


def embed_css(text: str, font_name: str | None = None) -> str:
    """返回内嵌字体的 CSS；没有可用字体时返回空串（调用方据此不插 style）。

    ``font_name`` 是这份简历自己的选择（项 14，存在 ``format_config["font"]``）：

    * ``None`` —— 没设过：用设备上**当前选中的**那个字体（历史行为，零改动）；
    * ``SYSTEM_FONT`` —— 用户显式要求"这份简历不用自定义字体"：返回空串，模板自带的
      ``font-family`` 栈生效。**不能**在这里回落到全局字体，否则那个选项等于没写；
    * 其它 —— 该文件名；文件已不存在时回落到全局当前字体（同一份简历不该因为一个被删掉
      的字体文件而失去字形）。
    """
    paths = _embed_font_paths(font_name)
    if paths is None:
        return ""
    regular_path, bold_path = paths
    try:
        mtime_ns = regular_path.stat().st_mtime_ns
    except OSError as exc:
        logger.warning("读取自定义字体信息失败（%s）：%s", regular_path.name, exc)
        return ""
    bold_key = ""
    bold_mtime = 0
    if bold_path is not None:
        try:
            bold_mtime = bold_path.stat().st_mtime_ns
            bold_key = str(bold_path)
        except OSError:
            bold_key, bold_mtime = "", 0
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return _embed_css_cached(str(regular_path), mtime_ns, bold_key, bold_mtime, digest, text)


def _embed_font_paths(font_name: str | None) -> tuple[Path, Path | None] | None:
    """把"这份简历的字体选择"解析成 ``(常规文件, 粗体文件或 None)``。

    返回 ``None`` 表示不内嵌（系统字体、或根本没有可用字体）。粗体为 ``None`` 有两种
    情况：单文件字体（常规自身就是粗体来源）、以及取不到当前选择。
    """
    if font_name == SYSTEM_FONT:
        return None
    if font_name:
        try:
            regular = user_fonts.font_path(font_name)
        except user_fonts.FontError:
            logger.warning("「%s」已不存在，回落到当前选中的字体", font_name)
        else:
            return _pair_for(regular)
    pair = user_fonts.active_font_paths()
    if pair is None:
        return None
    regular, bold = pair
    return regular, (bold if bold != regular else None)


def _pair_for(path: Path) -> tuple[Path, Path | None]:
    """单个字体文件 → ``(常规, 粗体或 None)``；只有内置双字重才给出不同的粗体。"""
    try:
        regular, bold = user_fonts.font_pair(path.name)
    except user_fonts.FontError:
        return path, None
    return regular, (bold if bold != regular else None)

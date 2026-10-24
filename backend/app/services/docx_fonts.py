# SPDX-License-Identifier: Apache-2.0
"""Word 导出的字体族名解析（W05）：把"这份简历选了哪款字"翻译成 Word 的字体族名。

**为什么单独成文件**：``docx_blocks.py`` 贴着 500 行预算，而"读字体 name 表"与"段落级原语"
是两件事；它只依赖 PDF 侧同一套字体解析（``resolve_font_paths``）与 fontTools，不知道任何
简历语义。

**查看端边界（必须如实说明，不许伪报）**：python-docx 只能写字体**名字**，不会把字体文件
嵌进 .docx。打开端没有这一族字体时，Word 会替代（通常是宋体 / Calibri），所以 Word 不承诺
与 PDF 像素一致。这里只保证"声明的名字是真的"：按用户实际选择的字体文件读 name 表，而不是
把"微软雅黑"写死当成用户的字体、也不声称已嵌入。

本机没有任何可用字体资源（Linux CI 常见）时退回 ``DOCX_FONT``：写一个明确的默认族名，
比伪造一个读不出来的名字诚实。
"""

from __future__ import annotations

from functools import lru_cache

from .pdf_exporter import resolve_font_paths

# Word 写的是**字体族名**，最终由打开端解析；缺省/解析失败时用微软雅黑（历史默认值）。
DOCX_FONT = "微软雅黑"

# 字体 name 表的族名：16 = typographic family（更准确），1 = family（兼容老字体）。
_FAMILY_NAME_IDS: tuple[int, ...] = (16, 1)


@lru_cache(maxsize=16)
def _read_font_family(path: str) -> str | None:
    """从字体文件读**真实族名**（name 表）；读不到/不是合法 sfnt 时返回 None。

    ``.ttc`` 是字体集合（微软雅黑、宋体都是），取第一个字面即可——PDF 侧注册的也是它。
    """
    try:
        from fontTools.ttLib import TTCollection, TTFont

        if path.lower().endswith(".ttc"):
            faces = TTCollection(path, lazy=True).fonts
            font = faces[0] if faces else None
        else:
            font = TTFont(path, lazy=True)
        if font is None:
            return None
        records = font["name"].names
    except Exception:  # noqa: BLE001 - 字体读不出来就退回默认族名，导出不该因此失败
        return None
    for name_id in _FAMILY_NAME_IDS:
        matches = [record for record in records if record.nameID == name_id]
        # Windows 英文记录最通用（跨语言 Word 都认）；其次任意一条能解码的记录。
        matches.sort(key=lambda record: (record.platformID != 3, record.langID not in (0x409, 0x0)))
        for record in matches:
            try:
                value = record.toUnicode().strip()
            except Exception:  # noqa: BLE001 - 个别坏记录不能挡住整份导出
                continue
            if value:
                return value
    return None


def resolve_docx_font_name(font_key: str | None) -> str:
    """这份简历选的字体 → Word 应写入的**真实字体族名**。

    取字体文件与 PDF 完全同一条解析（``resolve_font_paths``：本简历选择 → 当前全局字体 →
    系统候选），所以"预览/PDF 用的那款字"与"Word 里声明的字族"是同一个来源。
    """
    paths = resolve_font_paths(font_key)
    if paths is None:
        return DOCX_FONT
    return _read_font_family(str(paths[0])) or DOCX_FONT


__all__ = ["DOCX_FONT", "resolve_docx_font_name"]

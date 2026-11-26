# SPDX-License-Identifier: Apache-2.0
"""PDF 读侧：能力探测 + 字形提取（外部简历「覆盖式改字」的前半段）。

三件事，都是**只读**的：

1. **归一化 CID 编码**（:func:`normalize_cid_encoding`）：fpdf2 2.9 用 OTF/CFF 字体导出
   时，Type0 字体的 ``/Encoding`` 是内嵌 CMap 流（``CMapName=Adobe-Identity-UCS``），
   而 pdfminer.six 只按 CMap **名字**查预定义表，查不到就退回一个空 CMap——表现为
   整份 PDF 零个字形，会被误判成扫描件。改写成 ``/Identity-H`` 语义完全等价
   （2 字节码就是 CID），``/ToUnicode`` 照旧负责 CID → Unicode。**只改分析用的副本**，
   输出的 PDF 一个字节都不动。
2. **字形提取**（:func:`scan_pdf`）：pdfminer.six 逐页取 ``LTChar``，连同字号、基线
   （``LTChar.matrix`` 的平移量，不是 bbox 顶边）与旋转角一起交出去。
3. **能力探测**：解析失败 / 加密 / 表单字段 / 没有文本层（扫描件）/ 文字已转曲
   → 抛 :class:`PdfEditError`（带原因码），由接口层转成 4xx。**宁可拒绝，不产出压坏的
   PDF**——这与项目里"登录状态无法判断要说清原因"是同一条原则。

不在这层做的事：切块（见 ``external_resume_pdf_blocks``）与写回（见
``external_resume_pdf``）。这一层不认识"块"，只认识"字形"。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from fontTools.ttLib import TTFont
from pdfminer.converter import PDFPageAggregator
from pdfminer.layout import LAParams, LTChar, LTContainer, LTFigure
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

from .external_resume_pdf_blocks import Glyph, glyph_angle

logger = logging.getLogger(__name__)

# 原因码：接口层把它放进 4xx 的 detail 里，前端据此决定"是拒绝还是可以引导"。
CODE_PARSE_FAILED = "pdf_parse_failed"
CODE_ENCRYPTED = "pdf_encrypted"
CODE_FORM_FIELDS = "pdf_form_fields"
CODE_NO_TEXT = "pdf_no_text_layer"
CODE_OUTLINED = "pdf_outlined_text"
CODE_UNSUPPORTED = "pdf_unsupported"

# 面向用户的拒绝文案：说清"为什么不行 + 用户该怎么办"，不写底层异常。
_MESSAGES = {
    CODE_PARSE_FAILED: "这份 PDF 无法解析，不支持在线编辑；请下载后用本地工具修改",
    CODE_ENCRYPTED: "这份 PDF 已加密，不支持在线编辑；请先解除密码后再上传",
    CODE_FORM_FIELDS: "这份 PDF 含表单字段，覆盖式改字会与表单控件冲突，不支持在线编辑",
    CODE_NO_TEXT: "这份 PDF 没有文字层（扫描件或纯图片），不支持在线编辑",
    CODE_OUTLINED: "这份 PDF 的文字已转曲（导出时被转成图形），不支持在线编辑",
    CODE_UNSUPPORTED: "这份 PDF 不支持在线编辑",
}

# 转曲判据：没有字形、却有大量矢量路径算子。
_OUTLINED_PATHS = 50
# 解析深度上限：防御异常嵌套的 LTContainer 链。
_MAX_DEPTH = 12


class PdfEditError(ValueError):
    """PDF 不能在线编辑（或改不动）。``code`` 给前端，文案直接展示。

    ``message`` 允许调用方自带（编辑链路上的"文字为空""块不存在"这类原因不在读侧），
    不给就用本模块的默认文案；两种情况下 ``str(exc)`` 都是可读的完整句子。
    """

    def __init__(self, code: str, detail: str = "", *, message: str = "") -> None:
        self.code = code
        self.detail = detail
        base = message or _MESSAGES.get(code, _MESSAGES[CODE_UNSUPPORTED])
        super().__init__(f"{base}（{code}{'：' + detail if detail else ''}）")


@dataclass
class PdfScan:
    """一份可编辑 PDF 的读侧结果。"""

    page_count: int = 0
    # 逐页字形（下标 0 = 第 1 页）。
    pages: list[list[Glyph]] = field(default_factory=list)
    # 被归一化改写 /Encoding 的 Type0 字体数（诊断用；0 = 原文件本来就标准）。
    normalized_fonts: int = 0

    @property
    def glyph_count(self) -> int:
        return sum(len(page) for page in self.pages)


def read_reader(data: bytes) -> PdfReader | None:
    """尽力打开 PDF；失败返回 None（调用方按解析失败处理）。"""
    try:
        return PdfReader(BytesIO(data), strict=False)
    except Exception:  # noqa: BLE001 - 坏文件是用户输入，不是程序缺陷
        return None


def normalize_cid_encoding(data: bytes) -> tuple[bytes, int]:
    """把「内嵌 CMap 的 2 字节恒等编码」改写成 ``/Identity-H``，返回（新字节, 改写数）。"""
    reader = read_reader(data)
    if reader is None:
        return data, 0
    rewritten = 0
    try:
        for page in reader.pages:
            fonts = (page.get("/Resources") or {}).get("/Font") or {}
            for ref in dict(fonts).values():
                try:
                    font = ref.get_object()
                except Exception:  # noqa: BLE001 - 单个字体坏掉不影响其它字体
                    continue
                if font.get("/Subtype") != "/Type0":
                    continue
                encoding = font.get("/Encoding")
                if encoding is None or not hasattr(encoding, "get"):
                    # 已经是 /Identity-H 这类名字，或根本没有编码声明：不动。
                    continue
                if "Identity" not in str(encoding.get("/CMapName") or ""):
                    continue
                font[NameObject("/Encoding")] = NameObject("/Identity-H")
                rewritten += 1
        if not rewritten:
            return data, 0
        buffer = BytesIO()
        PdfWriter(clone_from=reader).write(buffer)
        return buffer.getvalue(), rewritten
    except Exception:  # noqa: BLE001 - 归一化失败就交回原文，让解析去报它自己的错
        logger.info("PDF 编码归一化失败，按原文件继续", exc_info=True)
        return data, 0


def _iter_chars(node, depth: int = 0):
    """递归取字形；``LTFigure`` 自带坐标变换，跳过（里面的字位置不可比）。"""
    if depth > _MAX_DEPTH:
        return
    if isinstance(node, LTChar):
        yield node
        return
    if isinstance(node, LTFigure):
        return
    if isinstance(node, LTContainer):
        for child in node:
            yield from _iter_chars(child, depth + 1)


def _glyph_of(char: LTChar) -> Glyph | None:
    """``LTChar`` → :class:`Glyph`；空白字与缺矩阵的字形丢弃。"""
    text = char.get_text()
    if not text or not text.strip():
        return None
    matrix = getattr(char, "matrix", None)
    if matrix is None:
        return None
    return Glyph(
        ch=text,
        x0=float(char.x0),
        x1=float(char.x1),
        y0=float(char.y0),
        y1=float(char.y1),
        size=float(char.size or 0.0),
        # 基线 = 文本矩阵的平移量（bbox 顶边会让中英混排改完错半格）。
        baseline=float(matrix[5]) + float(getattr(char, "rise", 0) or 0),
        angle=glyph_angle(matrix),
    )


def _page_layouts(data: bytes) -> list:
    manager = PDFResourceManager()
    device = PDFPageAggregator(manager, laparams=LAParams())
    interpreter = PDFPageInterpreter(manager, device)
    layouts = []
    for page in PDFPage.get_pages(BytesIO(data), check_extractable=True):
        interpreter.process_page(page)
        layouts.append(device.get_result())
    return layouts


def _content_stats(reader: PdfReader | None) -> tuple[int, int]:
    """返回（矢量路径算子数, 图像 XObject 数）：区分扫描件与转曲 PDF。"""
    if reader is None:
        return 0, 0
    paths = 0
    images = 0
    for page in reader.pages:
        try:
            contents = page.get_contents()
            if contents is not None:
                raw = contents.get_data() if hasattr(contents, "get_data") else b""
                tokens = raw.split()
                paths += sum(
                    1
                    for token in tokens
                    if token in (b"re", b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*")
                )
        except Exception:  # noqa: BLE001 - 内容流坏了就当没有路径，后面还有文本层兜底
            logger.info("读取页面内容流失败（路径统计跳过）", exc_info=True)
        try:
            resources = page.get("/Resources") or {}
            for ref in dict(resources.get("/XObject") or {}).values():
                obj = ref.get_object() if hasattr(ref, "get_object") else ref
                if getattr(obj, "get", lambda *_: None)("/Subtype") == "/Image":
                    images += 1
        except Exception:  # noqa: BLE001
            logger.info("读取页面 XObject 失败（图像统计跳过）", exc_info=True)
    return paths, images


def scan_pdf(data: bytes) -> PdfScan:
    """读一份 PDF 的字形；不能编辑的情形抛 :class:`PdfEditError`。"""
    if not data:
        raise PdfEditError(CODE_PARSE_FAILED, "文件为空")
    reader = read_reader(data)
    if reader is None:
        raise PdfEditError(CODE_PARSE_FAILED, "无法打开 PDF 结构")
    try:
        if reader.is_encrypted:
            raise PdfEditError(CODE_ENCRYPTED)
    except PdfEditError:
        raise
    except Exception as exc:  # noqa: BLE001 - 加密状态读不出来按加密处理（保守）
        raise PdfEditError(CODE_ENCRYPTED, str(exc)[:80]) from exc
    try:
        root = reader.trailer.get("/Root") or {}
        if "/AcroForm" in root:
            raise PdfEditError(CODE_FORM_FIELDS)
    except PdfEditError:
        raise
    except Exception:  # noqa: BLE001 - 读不到根对象不算"有表单"
        logger.info("读取 PDF 根对象失败（表单检测跳过）", exc_info=True)

    try:
        analysis_bytes, normalized = normalize_cid_encoding(data)
        layouts = _page_layouts(analysis_bytes)
    except PdfEditError:
        raise
    except Exception as exc:  # noqa: BLE001 - 解析失败一律拒绝，不产出坏 PDF
        raise PdfEditError(CODE_PARSE_FAILED, f"{type(exc).__name__}") from exc

    pages: list[list[Glyph]] = []
    for layout in layouts:
        glyphs = [glyph for glyph in (_glyph_of(char) for char in _iter_chars(layout)) if glyph]
        pages.append(glyphs)

    scan = PdfScan(page_count=len(pages), pages=pages, normalized_fonts=normalized)
    if scan.glyph_count == 0:
        paths, images = _content_stats(reader)
        if images:
            raise PdfEditError(CODE_NO_TEXT, f"{images} 张整页图像")
        if paths > _OUTLINED_PATHS:
            raise PdfEditError(CODE_OUTLINED, f"{paths} 个矢量路径算子、无字形")
        raise PdfEditError(CODE_NO_TEXT, "页面没有可提取的文字")
    return scan


_SYSTEM_CHARSET: set[str] | None = None


def system_font_path() -> Path | None:
    """系统 CJK 字体（与导出链同一套解析：用户字体 → 系统候选 → 内置思源黑体）。"""
    try:
        from .pdf_exporter.fonts import resolve_font_paths

        pair = resolve_font_paths(None)
    except Exception:  # noqa: BLE001 - 字体探测失败不该让整条链路起不来
        logger.warning("系统 CJK 字体探测失败", exc_info=True)
        return None
    if pair is None:
        return None
    path = Path(pair[0])
    return path if path.is_file() else None


def system_font_charset() -> set[str]:
    """系统 CJK 字体能渲染的字符集合（结果缓存；字体文件在进程内不会增减）。

    探测不到字体时返回全集：此时编辑会在写字那一步明确失败（"找不到中文字体"），
    而不是在这里把所有块判成不可编辑——两件事对用户的意思不一样。
    """
    global _SYSTEM_CHARSET
    if _SYSTEM_CHARSET is not None:
        return _SYSTEM_CHARSET
    path = system_font_path()
    if path is None:
        _SYSTEM_CHARSET = set()
        return _SYSTEM_CHARSET
    try:
        # .ttc 是字体集合，取第一个字面（导出链用的也是它）。
        font = TTFont(str(path), fontNumber=0 if path.suffix.lower() == ".ttc" else -1, lazy=True)
        cmap = font.getBestCmap() or {}
        charset = {chr(code) for code in cmap}
        font.close()
    except Exception:  # noqa: BLE001
        logger.warning("解析系统中文字体失败：%s", path, exc_info=True)
        return set()
    _SYSTEM_CHARSET = charset
    return charset


__all__ = [
    "CODE_ENCRYPTED",
    "CODE_FORM_FIELDS",
    "CODE_NO_TEXT",
    "CODE_OUTLINED",
    "CODE_PARSE_FAILED",
    "CODE_UNSUPPORTED",
    "PdfEditError",
    "PdfScan",
    "normalize_cid_encoding",
    "read_reader",
    "scan_pdf",
    "system_font_charset",
    "system_font_path",
]

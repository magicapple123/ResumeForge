# SPDX-License-Identifier: Apache-2.0
"""外部简历「在应用内改字」的格式分发层（#5 的 P1 + P2 入口）。

三种格式各有一条**保格式**的路径，这里只负责按后缀选路、把结果统一成一套 DTO：

| 格式 | 编辑单元 | 怎么保格式 |
| --- | --- | --- |
| TXT / MD | 整篇（一个块） | 纯文本没有版式可丢，按原编码写回 |
| DOCX | 段落 | 只改 `word/document.xml` 里 `<w:t>` 的文字，样式 / 表格 / 图片一个字节不动 |
| 文字版 PDF | 文本块 | 删旧字 + 系统字体覆盖层重排（见 `external_resume_pdf`） |

**DOCX 为什么按 run 分配文字**：同一段话常被 Word 拆成多个 run（改过字体/加粗就会拆），
直接 `paragraph.text = new` 会把整段格式塌成一个 run。这里按"原字符偏移 → run"的映射
把新文字切片回各个 run：前缀没动的部分格式逐字保持，改长了的尾巴落在最后一个原 run 上。

**扫描件 PDF 不在这里拒绝**：那是读侧（`external_resume_pdf_scan`）的职责，它给出的
原因码更具体（无文本层 / 转曲 / 加密 / 表单）。
"""

from __future__ import annotations

import codecs
import logging
from dataclasses import dataclass, field
from io import BytesIO

from docx import Document

from ..schemas.external_resume import MAX_EDIT_TEXT_CHARS
from .external_resume_pdf import (
    CODE_BLOCK_GLYPHS,
    CODE_BLOCK_NOT_EDITABLE,
    CODE_BLOCK_NOT_FOUND,
    BlockDocument,
    analyse,
    replace_block,
)
from .external_resume_pdf_overlay import MAX_BLOCK_TEXT_CHARS
from .external_resume_pdf_scan import PdfEditError

logger = logging.getLogger(__name__)

KIND_PDF = "pdf"
KIND_DOCX = "docx"
KIND_TEXT = "text"

# 整篇文本（txt/md）的上限：比单块宽得多，但仍挡得住"把一本书贴进来"。
MAX_DOCUMENT_TEXT_CHARS = 200_000

CODE_UNSUPPORTED_KIND = "edit_unsupported_kind"
CODE_DOCX_PARAGRAPH = "docx_paragraph_not_editable"


@dataclass(frozen=True)
class EditableBlock:
    """一个可点选的编辑单元（PDF 块 / DOCX 段落 / 整篇文本）。"""

    block_id: str
    text: str
    page: int = 0
    editable: bool = True
    reason: str = ""
    x0: float = 0.0
    y0: float = 0.0
    x1: float = 0.0
    y1: float = 0.0
    size: float = 0.0
    leading: float = 0.0
    align: str = ""


@dataclass(frozen=True)
class EditableDocument:
    """一份可编辑文档的编辑单元清单 + 页面尺寸（PDF 用，其余为 0）。"""

    kind: str
    blocks: tuple[EditableBlock, ...]
    page_count: int = 0
    page_width: float = 0.0
    page_height: float = 0.0
    warnings: tuple[str, ...] = ()

    @property
    def editable_count(self) -> int:
        return sum(1 for block in self.blocks if block.editable)


@dataclass(frozen=True)
class EditOutcome:
    """一次改字的结果（新文件字节 + 前端画红框/提示要用的量）。"""

    content: bytes
    kind: str
    block_id: str
    page: int = 0
    delta_pt: float = 0.0
    overflow: bool = False
    scaled: bool = False
    shifted: bool = False
    lines_before: int = 0
    lines_after: int = 0
    warnings: list[str] = field(default_factory=list)


def kind_of(original_name: str) -> str:
    """按后缀判定格式；不支持的格式抛面向用户的 ``ValueError``。"""
    suffix = (original_name or "").strip().rsplit(".", 1)[-1].lower()
    if suffix == "pdf":
        return KIND_PDF
    if suffix == "docx":
        return KIND_DOCX
    if suffix in ("txt", "md", "markdown"):
        return KIND_TEXT
    raise ValueError("这种格式不支持在应用内编辑（支持 PDF / DOCX / TXT / Markdown）")


# --------------------------------------------------------------------------- #
# 列块
# --------------------------------------------------------------------------- #


def _pdf_document(data: bytes) -> EditableDocument:
    document: BlockDocument = analyse(data)
    blocks = tuple(
        EditableBlock(
            block_id=block.block_id,
            text=block.text,
            page=block.page,
            editable=block.editable,
            reason=block.reason,
            x0=block.x0,
            y0=block.y0,
            x1=block.x1,
            y1=block.y1,
            size=block.size,
            leading=block.leading,
            align=block.align,
        )
        for block in document.blocks
    )
    size = document.page_sizes[0] if document.page_sizes else None
    return EditableDocument(
        kind=KIND_PDF,
        blocks=blocks,
        page_count=document.page_count,
        page_width=size.width if size is not None else 0.0,
        page_height=size.height if size is not None else 0.0,
    )


def _docx_document(data: bytes) -> EditableDocument:
    document = Document(BytesIO(data))
    blocks: list[EditableBlock] = []
    for index, paragraph in enumerate(document.paragraphs):
        text = "".join(run.text for run in paragraph.runs)
        if not text.strip():
            continue
        blocks.append(
            EditableBlock(
                block_id=f"para-{index}",
                text=text,
                editable=bool(paragraph.runs),
                reason="" if paragraph.runs else CODE_DOCX_PARAGRAPH,
            )
        )
    if not blocks:
        raise ValueError(
            "这份 Word 里没有可直接改字的段落（内容可能都在表格或图片里），请下载后用 Word 修改"
        )
    return EditableDocument(kind=KIND_DOCX, blocks=tuple(blocks))


def _text_document(data: bytes) -> EditableDocument:
    text, _codec = decode_text(data)
    return EditableDocument(
        kind=KIND_TEXT,
        blocks=(
            EditableBlock(
                block_id="text",
                text=text,
                editable=True,
            ),
        ),
    )


def decode_text(data: bytes) -> tuple[str, str]:
    """按 BOM → UTF-8 → GB18030 的顺序解码，返回（文本, 实际编码）。

    BOM 必须**显式**判定而不是直接试 ``utf-8-sig``：``utf-8-sig`` 解没有 BOM 的文件也
    会成功，写回时却会凭空多出三个字节的 BOM——一份原本干净的 txt 改完就成了"带 BOM"。
    """
    if data.startswith(codecs.BOM_UTF8):
        return data.decode("utf-8-sig"), "utf-8-sig"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("gb18030"), "gb18030"
    except UnicodeDecodeError as exc:
        raise ValueError("这份文本的编码无法识别，请另存为 UTF-8 后再上传") from exc


def list_blocks(original_name: str, data: bytes) -> EditableDocument:
    """列出编辑单元；文件坏了 / 不支持编辑时抛面向用户的 ``ValueError``。"""
    kind = kind_of(original_name)
    if kind == KIND_PDF:
        return _pdf_document(data)
    if kind == KIND_DOCX:
        return _docx_document(data)
    return _text_document(data)


# --------------------------------------------------------------------------- #
# 改字
# --------------------------------------------------------------------------- #


def _replace_docx(data: bytes, block_id: str, new_text: str) -> EditOutcome:
    """改写一个段落的文字，按原 run 的字符区间切回去，格式逐字保持。"""
    document = Document(BytesIO(data))
    try:
        index = int(block_id.removeprefix("para-"))
    except ValueError as exc:
        raise PdfEditError(
            CODE_BLOCK_NOT_FOUND, block_id, message="这一段已经不存在了，请刷新后重试"
        ) from exc
    paragraphs = document.paragraphs
    if not (0 <= index < len(paragraphs)):
        raise PdfEditError(
            CODE_BLOCK_NOT_FOUND, block_id, message="这一段已经不存在了，请刷新后重试"
        )
    paragraph = paragraphs[index]
    runs = paragraph.runs
    if not runs:
        raise PdfEditError(
            CODE_DOCX_PARAGRAPH,
            block_id,
            message="这一段没有可编辑的文字（内容可能在图片、超链接或表格里）",
        )

    # "原字符偏移 → run 下标"：新文字第 j 个字符沿用原文第 min(j, 原长-1) 个字符的格式。
    # 因此没动过的前缀逐字保格式，改长了的尾巴落在最后一个原 run 上。
    owners: list[int] = []
    for run_index, run in enumerate(runs):
        owners.extend([run_index] * len(run.text))
    segments = [""] * len(runs)
    for position, char in enumerate(new_text):
        owner = owners[min(position, len(owners) - 1)] if owners else 0
        segments[owner] += char
    for run, segment in zip(runs, segments, strict=True):
        if run.text != segment:
            run.text = segment

    buffer = BytesIO()
    document.save(buffer)
    return EditOutcome(
        content=buffer.getvalue(),
        kind=KIND_DOCX,
        block_id=block_id,
        lines_before=1,
        lines_after=new_text.count("\n") + 1,
        warnings=[],
    )


def _replace_text(data: bytes, new_text: str) -> EditOutcome:
    """整篇替换（TXT / MD）：按原编码写回，BOM 也照原样保留。"""
    _text, codec = decode_text(data)
    try:
        content = new_text.encode(codec)
    except UnicodeEncodeError:
        # 原文件是 GB18030 而新文字里有它编不出的字符（极少数生僻字/emoji）→ 退到 UTF-8。
        content = new_text.encode("utf-8")
    return EditOutcome(
        content=content,
        kind=KIND_TEXT,
        block_id="text",
        lines_before=1,
        lines_after=new_text.count("\n") + 1,
        warnings=[],
    )


def _check_text_size(text: str, limit: int) -> None:
    if len(text) > limit:
        raise ValueError(f"文字太多（{len(text)} 字），单次最多 {limit} 字")


def replace(
    original_name: str,
    data: bytes,
    *,
    block_id: str,
    new_text: str,
    shift_below: float = 0.0,
) -> EditOutcome:
    """改一个字：PDF 按块、DOCX 按段落、TXT/MD 按整篇。"""
    kind = kind_of(original_name)
    if kind == KIND_PDF:
        limit = MAX_BLOCK_TEXT_CHARS
        _check_text_size(new_text, limit)
        outcome = replace_block(data, block_id, new_text, shift_below=shift_below)
        return EditOutcome(
            content=outcome.content,
            kind=KIND_PDF,
            block_id=outcome.block_id,
            page=outcome.page,
            delta_pt=outcome.delta_pt,
            overflow=outcome.overflow,
            scaled=outcome.scaled,
            shifted=outcome.shifted,
            lines_before=outcome.lines_before,
            lines_after=outcome.lines_after,
            warnings=(["新文字较长，字号已按块宽缩小"] if outcome.scaled else [])
            + (
                ["新文字压到了下方内容；可点「下移下方内容」把下面整体下移"]
                if outcome.overflow and not outcome.shifted
                else []
            ),
        )
    if kind == KIND_DOCX:
        if shift_below > 0:
            raise ValueError("Word 文档没有「下移下方内容」这一步：Word 会自己重排")
        _check_text_size(new_text, MAX_EDIT_TEXT_CHARS)
        return _replace_docx(data, block_id, new_text)
    _check_text_size(new_text, MAX_DOCUMENT_TEXT_CHARS)
    return _replace_text(data, new_text)


__all__ = [
    "CODE_DOCX_PARAGRAPH",
    "CODE_UNSUPPORTED_KIND",
    "KIND_DOCX",
    "KIND_PDF",
    "KIND_TEXT",
    "MAX_DOCUMENT_TEXT_CHARS",
    "CODE_BLOCK_GLYPHS",
    "CODE_BLOCK_NOT_EDITABLE",
    "CODE_BLOCK_NOT_FOUND",
    "EditOutcome",
    "EditableBlock",
    "EditableDocument",
    "decode_text",
    "kind_of",
    "list_blocks",
    "replace",
]

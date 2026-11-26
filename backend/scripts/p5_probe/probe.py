# SPDX-License-Identifier: Apache-2.0
"""逐份 PDF 的探针：把「能不能切块、能不能改字」变成一个可比的数字。

判定口径（与 `services/external_resume_pdf` 上线后的行为一致，不是另写一套）：

* **拒绝**：解析失败 / 加密 / 表单字段 / 没有文本层（扫描件）/ 文字已转曲。
* **可编辑**：至少切出 1 个可编辑块。旋转块与"含系统字体渲染不出的字"的块在**块级**
  排除，不牵连整份文档。
* **仅只读**：有文本层但一个可编辑块都没有（全部旋转或全部缺字）。

多栏 / 表格**不是**拒绝理由：切块规则让它们退化成单行块（见
`external_resume_pdf_blocks` 的模块注释）。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from app.services.external_resume_pdf_blocks import (
    group_blocks,
    mark_tabular,
    multi_column_pairs,
    split_into_lines,
)
from app.services.external_resume_pdf_scan import (
    CODE_PARSE_FAILED,
    CODE_UNSUPPORTED,
    PdfEditError,
    read_reader,
    scan_pdf,
    system_font_charset,
)

# "探针根本没把它读进来"的原因码。注意与**读进来了但不支持**分开：扫描件
# （`pdf_no_text_layer`）是合法的真实样本结果，不能被算成"语料不可用"。
_UNREADABLE_CODES = frozenset({CODE_PARSE_FAILED, CODE_UNSUPPORTED})


@dataclass
class DocReport:
    """一份文档的探针结论（报告的每一行就是它）。"""

    name: str
    origin: str  # real / generated
    pages: int = 0
    chars: int = 0
    blocks: int = 0
    editable_blocks: int = 0
    rotated_blocks: int = 0
    column_pairs: int = 0
    coverage: float = 1.0
    missing: list[str] = field(default_factory=list)
    normalized: int = 0
    verdict: str = "拒绝"
    reason: str = ""
    detail: str = ""
    # 探针有没有把这份文件读进来。``False`` = 读取/解析失败，"这份语料不构成评测"；
    # 扫描件这类"读进来了但判定不支持"必须保持 ``True``，否则 2 份拒绝样本就会
    # 被误当成"真实语料全部不可读"。
    readable: bool = True


def probe_document(
    path: Path, origin: str, charset: set[str], *, display_name: str = ""
) -> DocReport:
    """跑一份文档，返回可直接进报告的结论。"""
    report = DocReport(name=display_name or path.name, origin=origin)
    try:
        data = path.read_bytes()
    except OSError as exc:
        # 权限 / 文件被别的进程占住：读不到就是读不到，别让它变成"0 个块的可编辑文档"。
        report.readable = False
        report.verdict, report.reason = "拒绝", CODE_PARSE_FAILED
        report.detail = f"读取文件失败：{type(exc).__name__}"
        return report
    reader = read_reader(data)
    if reader is not None:
        # 拒绝的文档也要报页数：扫描件"9 页全图"和"1 页空白"对判断支持范围不是一回事。
        try:
            report.pages = len(reader.pages)
        except Exception:  # noqa: BLE001 - 页数读不出就当 0
            report.pages = 0
    try:
        scan = scan_pdf(data)
    except PdfEditError as exc:
        report.verdict, report.reason, report.detail = "拒绝", exc.code, exc.detail or str(exc)
        report.readable = exc.code not in _UNREADABLE_CODES
        return report
    except Exception as exc:  # noqa: BLE001 - 探针不因单份文件崩溃
        report.verdict, report.reason = "拒绝", CODE_UNSUPPORTED
        report.detail = f"{type(exc).__name__}: {exc}"[:160]
        report.readable = False
        return report

    report.pages = scan.page_count
    report.normalized = scan.normalized_fonts
    report.chars = scan.glyph_count

    text = "".join(glyph.ch for glyph in (g for page in scan.pages for g in page))
    visible = [ch for ch in text if ch.strip()]
    missing = sorted({ch for ch in visible if ch not in charset})
    report.coverage = (
        round(sum(1 for ch in visible if ch in charset) / len(visible), 4) if visible else 1.0
    )
    report.missing = missing[:20]

    blocks = []
    for index, page_glyphs in enumerate(scan.pages, start=1):
        lines = mark_tabular(split_into_lines(page_glyphs))
        page_blocks = group_blocks(lines, index)
        report.column_pairs += multi_column_pairs(page_blocks)
        blocks.extend(page_blocks)

    report.blocks = len(blocks)
    report.editable_blocks = sum(1 for block in blocks if block.editable(charset))
    report.rotated_blocks = sum(1 for block in blocks if block.rotated)

    if report.editable_blocks == 0:
        report.verdict = "拒绝"
        if report.rotated_blocks:
            report.reason = "pdf_rotated_text"
            report.detail = f"{report.rotated_blocks}/{report.blocks} 个块旋转或倾斜，无可编辑块"
        else:
            report.reason = "pdf_missing_glyphs"
            report.detail = f"全部 {report.blocks} 个块都含系统字体渲染不出的字"
        return report

    report.verdict, report.reason = "可编辑", "editable"
    skipped = report.blocks - report.editable_blocks
    if skipped:
        report.detail = f"{skipped}/{report.blocks} 个块不可编辑（旋转 / 倾斜 / 缺字），其余可编辑"
    return report


def collect_real(roots: list[Path]) -> list[Path]:
    """收敛真实语料：按**内容 sha256** 去重（同名不同内容必须都保留）。"""
    found: list[Path] = []
    for root in roots:
        if root.is_file() and root.suffix.lower() == ".pdf":
            found.append(root)
        elif root.is_dir():
            found.extend(sorted(path for path in root.rglob("*") if path.suffix.lower() == ".pdf"))
    seen: set[str] = set()
    unique: list[Path] = []
    for path in found:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        unique.append(path)
    return unique


def run_paths(paths: list[Path]) -> list[DocReport]:
    """把已收敛好的 PDF 列表当真实语料跑一遍（不再去重）。"""
    charset = system_font_charset()
    return [
        probe_document(path, "real", charset, display_name=display_path(path)) for path in paths
    ]


def run(roots: list[Path]) -> list[DocReport]:
    """真实语料整批跑一遍。"""
    return run_paths(collect_real(roots))


def display_path(path: Path) -> str:
    """报告里的文件名：相对 ``backend/data`` 的路径（够识别，且不含用户目录）。"""
    backend_dir = Path(__file__).resolve().parents[2]
    try:
        return str(path.resolve().relative_to(backend_dir)).replace("\\", "/")
    except ValueError:
        return path.name


__all__ = [
    "DocReport",
    "collect_real",
    "display_path",
    "probe_document",
    "run",
    "run_paths",
]

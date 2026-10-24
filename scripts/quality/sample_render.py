# SPDX-License-Identifier: Apache-2.0
"""把一份样例渲染成真实产物，并提供"从产物里取事实"的小工具。

渲染**只走产品自己的导出管线**：build_export（即 API 下载走的那一条），不另写
第二套渲染。这样样例回归测的是用户真的会拿到的文件，而不是一份专供测试的旁路。

本模块只回答"产物是什么"（页数、文本、结构事实）；"是否符合期望"在
sample_verify 里判定，两边分开是为了让失败报告能说清楚是哪一层不对。
"""

from __future__ import annotations

import contextlib
import io
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def ensure_backend_on_path() -> None:
    """让 scripts/ 下的脚本能 import app.*；重复调用无副作用。"""
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)


ensure_backend_on_path()

from app.schemas.resume import ResumeContent  # noqa: E402
from app.services.export_pipeline import (  # noqa: E402
    ExportArtifact,
    ExportRequest,
    RenderContext,
    build_export,
)

SUPPORTED_FORMATS = ("json", "md", "html", "pdf", "docx", "txt")
# 全量检查默认渲染的格式：PDF 是主产物；md/txt 是"内容是否真的都在"的确定性文本；
# html/docx 承担转义、加粗、照片与 Word 交叉验证。json 只在迭代样例里跑（往返）。
DEFAULT_FORMATS = ("pdf", "md", "txt", "html", "docx")

_GIT_PDFTOTEXT_CANDIDATES = (
    # Git for Windows 自带 poppler 的 pdftotext，但默认不在系统 PATH 上。
    Path(r"C:\Program Files\Git\mingw64\bin\pdftotext.exe"),
    Path(r"C:\Program Files\Git\usr\bin\pdftotext.exe"),
)


def find_pdftotext() -> str | None:
    """找 pdftotext：先 PATH，再 Git for Windows 的固定候选路径（仅研究工具用）。"""
    found = shutil.which("pdftotext")
    if found:
        return found
    for candidate in _GIT_PDFTOTEXT_CANDIDATES:
        if candidate.is_file():
            return str(candidate)
    return None


_MISSING_GLYPH_RE = re.compile(r"is missing the following glyphs?:\s*(.+)$")
_CODEPOINT_RE = re.compile(r"\\U([0-9a-fA-F]{8})|\\u([0-9a-fA-F]{4})")


def request_for(sample, fmt: str) -> ExportRequest:  # noqa: ANN001 - 避免依赖方向倒置
    """样例 → 导出请求（格式不同、其余参数一致）。"""
    return ExportRequest(
        format=fmt,
        font_scale=sample.font_scale,
        page_limit=sample.page_limit,
        format_config=sample.format_config,
        language=sample.language,
        include_photo=sample.include_photo,
    )


def context_for(sample) -> RenderContext:  # noqa: ANN001
    return RenderContext(
        template=sample.template,
        page_limit=sample.page_limit,
        font_scale=sample.font_scale,
        format_config=sample.format_config,
        include_photo=sample.include_photo,
        language=sample.language,
    )


def render_artifacts(
    sample, formats: tuple[str, ...] = DEFAULT_FORMATS
) -> dict[str, ExportArtifact]:  # noqa: ANN001
    """渲染一份样例，返回 格式 → ExportArtifact（含 pages / pages_needed / overflow）。"""
    resume = ResumeContent.model_validate(sample.content_dict())
    artifacts: dict[str, ExportArtifact] = {}
    for fmt in formats:
        artifacts[fmt] = build_export(request_for(sample, fmt), resume, context_for(sample))
    return artifacts


def render_sample(sample, formats: tuple[str, ...] = DEFAULT_FORMATS) -> dict[str, bytes]:  # noqa: ANN001
    """渲染一份样例，返回 格式 → 字节。任何失败原样抛给调用方（不许静默跳过）。"""
    return {fmt: artifact.content for fmt, artifact in render_artifacts(sample, formats).items()}


@contextlib.contextmanager
def capture_missing_glyphs() -> Iterator[dict[str, Any]]:
    """捕获 fpdf2 的"字体缺字"警告（它只打 log，不抛异常）。

    返回一个可变 dict，退出 with 后含 missing_glyphs（字符列表，去重排序）与
    messages（原始警告文本，便于人工复核）。这是"缺字"这一类边界唯一的可复现证据。
    """
    captured: dict[str, Any] = {"missing_glyphs": [], "messages": []}

    class _Handler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            message = record.getMessage()
            if "missing the following glyphs" not in message:
                return
            captured["messages"].append(message)
            match = _MISSING_GLYPH_RE.search(message)
            if not match:
                return
            for hex8, hex4 in _CODEPOINT_RE.findall(match.group(1)):
                codepoint = int(hex8 or hex4, 16)
                try:
                    captured["missing_glyphs"].append(chr(codepoint))
                except (ValueError, OverflowError):  # pragma: no cover - 数据异常时忽略
                    continue

    handler = _Handler()
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(min(old_level, logging.WARNING) if old_level else logging.WARNING)
    try:
        yield captured
    finally:
        root.removeHandler(handler)
        root.setLevel(old_level)
        captured["missing_glyphs"] = sorted(set(captured["missing_glyphs"]))


def pdf_structure(data: bytes) -> dict[str, Any]:
    """从 PDF 字节里取结构事实（页数、图片、字体、标签能力）。

    只用 pypdf 读对象树，不做文本抽取——文本抽取的口径在 extract_pdf_text 里单独
    处理（外部工具优先），两者失败原因不同，不能混成一个"PDF 坏了"。
    """
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    root = reader.trailer["/Root"]
    pages = list(reader.pages)
    fonts: list[str] = []
    image_count = 0
    for page in pages:
        resources = page.get("/Resources") or {}
        font_dict = resources.get("/Font") or {}
        for _name, ref in font_dict.items():
            font = ref.get_object()
            fonts.append(str(font.get("/BaseFont", "")))
        xobjects = resources.get("/XObject") or {}
        for _name, ref in xobjects.items():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                image_count += 1
    return {
        "pages": len(pages),
        "image_count": image_count,
        "fonts": sorted(set(fonts)),
        "tagged": "/StructTreeRoot" in root,
        "mark_info": "/MarkInfo" in root,
        "lang": root.get("/Lang"),
        "metadata_xmp": "/Metadata" in root,
        "page_labels": "/PageLabels" in root,
    }


def normalize_text(text: str) -> str:
    """文本查 token 用的归一化：去 NUL、去所有空白。

    空白必须去掉：PDF 提取会在折行处换行，中文之间还可能被插空格；"长链接不丢字符"
    要判的是字符序列，不是排版位置。
    """
    return re.sub(r"\s+", "", text.replace("\x00", ""))


def extract_pdf_text(data: bytes, extractor: str = "auto") -> tuple[str, str]:
    """从 PDF 提取文本，返回 (文本, 实际使用的工具名)。

    优先级：pdftotext（本机可用时优先，它对 CJK / 多字体切换的提取更稳）→ pypdf
    （纯 python，随项目依赖走）。工具不可用时退回 pypdf 并如实返回工具名，报告里
    能看到"这次结论建立在哪个提取器上"。
    """
    pdftotext = find_pdftotext()
    if extractor in ("auto", "pdftotext") and pdftotext:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(data)
            temp_path = Path(handle.name)
        try:
            result = subprocess.run(
                [pdftotext, "-enc", "UTF-8", str(temp_path), "-"],
                capture_output=True,
                check=False,
                timeout=60,
            )
            if result.returncode == 0:
                return result.stdout.decode("utf-8", errors="replace"), "pdftotext"
        finally:
            temp_path.unlink(missing_ok=True)
    if extractor == "pdftotext":
        raise RuntimeError("指定了 pdftotext，但本机找不到该命令")
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages), "pypdf"


def docx_text(data: bytes) -> str:
    """Word 正文的纯文本：只取 word/document.xml，去掉标签（不追求排版）。"""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    return (
        xml.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )


def docx_has_image(data: bytes) -> bool:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return any(name.startswith("word/media/") for name in archive.namelist())


__all__ = [
    "BACKEND_DIR",
    "DEFAULT_FORMATS",
    "REPO_ROOT",
    "SUPPORTED_FORMATS",
    "capture_missing_glyphs",
    "context_for",
    "docx_has_image",
    "docx_text",
    "ensure_backend_on_path",
    "extract_pdf_text",
    "find_pdftotext",
    "normalize_text",
    "pdf_structure",
    "render_artifacts",
    "render_sample",
    "request_for",
]

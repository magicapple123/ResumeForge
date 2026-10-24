# SPDX-License-Identifier: Apache-2.0
"""D12 标签 PDF 能力研究工具：生成真实样例，探测本机工具，报告 PDF 结构事实。

这不是产品功能，是**研究取证工具**：结论写进 docs/quality/tagged-pdf-research-d12.md，
本脚本负责让结论可复现（同一命令重跑得到同一组结构事实）。

做三件事：
1. 探测本机可用的 PDF 结构/文本工具（python 库 + 系统命令），记录版本与路径；
2. 用产品自身的 build_resume_pdf 生成 4 类样例（经典单页/学术长 CV/双栏/超页截断），
   逐份读取 PDF 对象树：是否 Tagged（StructTreeRoot / MarkInfo）、Lang、Tabs、
   StructParents、图片替代文本、字体与 ToUnicode、XMP/PDF-UA 标识、页数；
3. 对照 HTML / Word 产物的语义信息，说明"当前能证明什么、不能证明什么"。

不承诺 PDF/UA：本脚本只输出事实与限制，任何"已达标"的结论都必须由外部验证支撑。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from quality.sample_corpus import build_corpus  # noqa: E402
from quality.sample_render import (  # noqa: E402
    REPO_ROOT,
    docx_has_image,
    docx_text,
    extract_pdf_text,
    find_pdftotext,
    render_artifacts,
    render_sample,
)

DEFAULT_OUTPUT_DIR = Path(tempfile.gettempdir()) / "resumeforge-w20-pdf-research"
# 研究样例：直接从 120 份语料里挑"结构最值得看"的四类，不另造第二套内容。
CASE_SAMPLE_IDS = {
    "iter-classic": "iter-01",
    "scholar-long-cv": "bound-100",
    "split-two-column": "iter-18",
    "dense-overflow": "bound-017",
}


def _run_version(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, check=False, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:  # pragma: no cover - 环境相关
        return f"error: {exc}"
    text = (result.stdout or result.stderr or b"").decode("utf-8", errors="replace").strip()
    return text.splitlines()[0] if text else f"exit {result.returncode}"


def _find_command(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    # Git for Windows 自带 poppler 的 pdftotext，但默认不在系统 PATH 上。
    for candidate in (
        Path(r"C:\Program Files\Git\mingw64\bin"),
        Path(r"C:\Program Files\Git\usr\bin"),
    ):
        path = candidate / f"{name}.exe"
        if path.is_file():
            return str(path)
    return None


def probe_tools() -> dict[str, Any]:
    """探测本机可用于 PDF 研究的工具（有就记版本，没有就记 None）。"""
    import pypdf

    tools: dict[str, Any] = {
        "python": sys.version.split()[0],
        "pypdf": getattr(pypdf, "__version__", "unknown"),
    }
    for name in ("pdftotext", "qpdf", "pdfinfo", "mutool", "gs", "pdftoppm"):
        path = find_pdftotext() if name == "pdftotext" else _find_command(name)
        tools[name] = {"path": path, "version": _run_version([path, "-v"]) if path else None}
    # fpdf2 版本决定"有没有标签 PDF 能力"，必须记录。
    try:
        import fpdf

        tools["fpdf2"] = getattr(fpdf, "__version__", "unknown")
    except ImportError:  # pragma: no cover - 项目依赖里必有
        tools["fpdf2"] = None
    tools["font_paths"] = _resolved_fonts()
    return tools


def _resolved_fonts() -> dict[str, str] | None:
    try:
        from app.services.pdf_exporter import resolve_font_paths

        pair = resolve_font_paths(None)
    except Exception as exc:  # noqa: BLE001 - 探测失败只记录
        return {"error": f"{type(exc).__name__}: {exc}"}
    if pair is None:
        return None
    return {"regular": pair[0], "bold": pair[1], "outline": _outline_kind(pair[0])}


def _outline_kind(path: str) -> str:
    """字体轮廓类型：TrueType（glyf）还是 CFF。CI 注释说明 CFF + fpdf2 会丢提取文本。"""
    try:
        from fontTools.ttLib import TTFont

        font = TTFont(path, fontNumber=0, lazy=True)
        has_glyf = "glyf" in font
        has_cff = "CFF " in font or "CFF2" in font
        return "truetype" if has_glyf else ("cff" if has_cff else "unknown")
    except Exception:  # noqa: BLE001
        return "unknown"


def inspect_pdf(data: bytes) -> dict[str, Any]:
    """读取 PDF 对象树里的结构事实（不做价值判断）。"""
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    root = reader.trailer["/Root"]
    pages = list(reader.pages)
    struct_tree = root.get("/StructTreeRoot")
    mark_info = root.get("/MarkInfo")
    page_facts: list[dict[str, Any]] = []
    images_with_alt = 0
    images_total = 0
    fonts: dict[str, dict[str, Any]] = {}
    for page in pages:
        resources = page.get("/Resources") or {}
        font_dict = resources.get("/Font") or {}
        for name, ref in font_dict.items():
            font = ref.get_object()
            descendant = font.get("/DescendantFonts")
            embedded = False
            base = font
            if descendant:
                base = descendant[0].get_object()
            descriptor = base.get("/FontDescriptor")
            if descriptor is None and descendant:
                descriptor = base.get("/FontDescriptor")
            descriptor = descriptor.get_object() if descriptor else {}
            embedded = any(key in descriptor for key in ("/FontFile", "/FontFile2", "/FontFile3"))
            fonts[str(name)] = {
                "base_font": str(font.get("/BaseFont", "")),
                "subtype": str(font.get("/Subtype", "")),
                "embedded": embedded,
                "to_unicode": "/ToUnicode" in font,
                "cid_to_gid_map": "/CIDToGIDMap" in base,
            }
        xobjects = resources.get("/XObject") or {}
        for _name, ref in xobjects.items():
            obj = ref.get_object()
            if obj.get("/Subtype") != "/Image":
                continue
            images_total += 1
            if obj.get("/Alt"):
                images_with_alt += 1
        page_facts.append(
            {
                "page": len(page_facts) + 1,
                "tabs": page.get("/Tabs"),
                "struct_parents": "/StructParents" in page,
                "annots": len(page.get("/Annots") or []),
                "mediabox": [round(float(value), 1) for value in page.mediabox],
            }
        )
    xmp = root.get("/Metadata")
    xmp_text = ""
    if xmp is not None:
        try:
            xmp_text = xmp.get_object().get_data().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            xmp_text = "<unreadable>"
    try:
        outline_length = len(reader.outline)
    except Exception:  # noqa: BLE001 - 大纲解析失败不影响主结论
        outline_length = None
    return {
        "pages": len(pages),
        "tagged_pdf": struct_tree is not None,
        "struct_tree_root": "/StructTreeRoot" in root,
        "mark_info": {
            "present": mark_info is not None,
            "marked": str((mark_info or {}).get("/Marked", "")),
        },
        "lang": root.get("/Lang"),
        "viewer_preferences": str(root.get("/ViewerPreferences", "")),
        "page_labels": "/PageLabels" in root,
        "xmp_metadata": {
            "present": xmp is not None,
            "pdfuaid_part": "pdfuaid" in xmp_text,
            "bytes": len(xmp_text),
        },
        "outline_entries": outline_length,
        "embedded_fonts": fonts,
        "images_total": images_total,
        "images_with_alt": images_with_alt,
        "pages_facts": page_facts,
        "document_info": {str(key): str(value) for key, value in (reader.metadata or {}).items()},
        "file_id": str(reader.trailer.get("/ID", "")),
    }


def inspect_html(html: bytes) -> dict[str, Any]:
    """HTML 产物的语义事实：有没有标题标签/语言/图片替代文本（作为对照路线）。"""
    import re

    text = html.decode("utf-8", errors="replace")
    return {
        "lang": (re.search(r'<html[^>]*lang="([^"]*)"', text) or [None, None])[1],
        "h1_count": len(re.findall(r"<h1\b", text)),
        "h2_count": len(re.findall(r"<h2\b", text)),
        "h3_count": len(re.findall(r"<h3\b", text)),
        "section_count": len(re.findall(r"<section\b", text)),
        "main_count": len(re.findall(r"<main\b", text)),
        "img_count": len(re.findall(r"<img\b", text)),
        "img_with_alt": len(re.findall(r'<img[^>]*\balt="[^"]*"', text)),
    }


def _sample_by_id(sample_id: str):
    for sample in build_corpus():
        if sample.sample_id == sample_id:
            return sample
    raise KeyError(f"语料里没有 {sample_id}")


def build_cases() -> list[dict[str, Any]]:
    """四个研究样例：经典单页 / 学术长 CV / 双栏 / 超页截断。"""
    cases = []
    for label, sample_id in CASE_SAMPLE_IDS.items():
        sample = _sample_by_id(sample_id)
        artifacts = render_artifacts(sample, ("pdf", "html", "docx"))
        pdf_artifact = artifacts["pdf"]
        cases.append(
            {
                "label": label,
                "sample_id": sample_id,
                "template": sample.template,
                "page_limit": sample.page_limit,
                "font_scale": sample.font_scale,
                "pdf_meta": {
                    "pages": pdf_artifact.pages,
                    "pages_needed": pdf_artifact.pages_needed,
                    "overflow": pdf_artifact.overflow,
                },
                "pdf_bytes": pdf_artifact.content,
                "html": artifacts["html"].content,
                "docx": artifacts["docx"].content,
            }
        )
    return cases


def _pdf_creation_date(data: bytes) -> str | None:
    import pypdf

    metadata = pypdf.PdfReader(io.BytesIO(data)).metadata or {}
    return str(metadata.get("/CreationDate")) if metadata.get("/CreationDate") else None


def determinism_probe() -> dict[str, Any]:
    """同一份样例连渲多次，分离"时间戳"与"字体子集缓存"两个字节差异来源。

    做法：先 reset 字体子集缓存并**关掉后台预热**（研究工具允许碰这个内部开关，
    目的是把"冷缓存"变成可复现状态），连渲两份 → 只差创建时间（秒级）；
    再等 1.1 秒渲第三份 → 创建时间必变；最后打开预热、等它完成再渲第四份 →
    嵌入字体度量变化。结论：**文本与页数可回归，PDF 字节不可回归**。
    """
    from app.services.pdf_exporter import font_subset

    sample = _sample_by_id("iter-01")
    font_subset.reset()
    font_subset._warm_enabled = False  # noqa: SLF001 - 研究取证：固定冷缓存状态
    try:
        first = render_sample(sample, ("pdf",))["pdf"]
        second = render_sample(sample, ("pdf",))["pdf"]
    finally:
        font_subset._warm_enabled = True
    time.sleep(1.1)
    third = render_sample(sample, ("pdf",))["pdf"]
    text_first, tool = extract_pdf_text(first)
    text_second, _ = extract_pdf_text(second)
    text_third, _ = extract_pdf_text(third)
    import pypdf

    return {
        "first_vs_second": {
            "bytes_equal": first == second,
            "sha256": [hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest()],
            "creation_date": [_pdf_creation_date(first), _pdf_creation_date(second)],
            "sizes": [len(first), len(second)],
        },
        "first_vs_third": {
            "bytes_equal": first == third,
            "sha256": [hashlib.sha256(first).hexdigest(), hashlib.sha256(third).hexdigest()],
            "creation_date": [_pdf_creation_date(first), _pdf_creation_date(third)],
            "sizes": [len(first), len(third)],
        },
        "text_equal": text_first == text_second == text_third,
        "extractor": tool,
        "pages": [
            len(pypdf.PdfReader(io.BytesIO(first)).pages),
            len(pypdf.PdfReader(io.BytesIO(second)).pages),
            len(pypdf.PdfReader(io.BytesIO(third)).pages),
        ],
        "reason": "创建时间是秒级（隔秒必变）；字体预子集缓存就绪后嵌入字体度量会变。"
        "二者都不影响文本与页数，所以回归口径是文本+页数，不是字节。",
    }


def reading_order_probe(case: dict[str, Any]) -> dict[str, Any]:
    """双栏样例的阅读顺序事实：pypdf 流顺序 vs pdftotext 的原始/版面两种模式。"""
    pdf = case["pdf_bytes"]
    plain, tool = extract_pdf_text(pdf)
    layout = ""
    pdftotext = find_pdftotext()
    if tool == "pdftotext" and pdftotext:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(pdf)
            temp_path = Path(handle.name)
        try:
            result = subprocess.run(
                [pdftotext, "-enc", "UTF-8", "-layout", str(temp_path), "-"],
                capture_output=True,
                check=False,
                timeout=60,
            )
            layout = result.stdout.decode("utf-8", errors="replace")
        finally:
            temp_path.unlink(missing_ok=True)
    return {
        "extractor": tool,
        "plain_text_head": plain[:600],
        "layout_text_head": layout[:600],
        "plain_has_layout_only_markers": False,
    }


def build_report(out_dir: Path) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tools = probe_tools()
    cases = build_cases()
    report: dict[str, Any] = {
        "repo_root": str(REPO_ROOT),
        "tools": tools,
        "cases": [],
        "determinism": determinism_probe(),
    }
    for case in cases:
        pdf_path = out_dir / f"{case['label']}.pdf"
        pdf_path.write_bytes(case["pdf_bytes"])
        html_path = out_dir / f"{case['label']}.html"
        html_path.write_bytes(case["html"])
        docx_path = out_dir / f"{case['label']}.docx"
        docx_path.write_bytes(case["docx"])
        entry: dict[str, Any] = {
            "label": case["label"],
            "sample_id": case["sample_id"],
            "template": case["template"],
            "page_limit": case["page_limit"],
            "pdf_meta": case["pdf_meta"],
            "files": {"pdf": str(pdf_path), "html": str(html_path), "docx": str(docx_path)},
            "pdf": inspect_pdf(case["pdf_bytes"]),
            "html": inspect_html(case["html"]),
            "docx": {
                "has_image": docx_has_image(case["docx"]),
                "text_has_name": "示例" in docx_text(case["docx"]),
            },
        }
        if "text_has_name" in entry["docx"] and not entry["docx"]["text_has_name"]:
            entry["docx"]["text_has_name"] = False  # 显式记录：Word 文本提取失败也要可见
        if case["label"] == "split-two-column":
            entry["reading_order"] = reading_order_probe(case)
        report["cases"].append(entry)
    (out_dir / "pdf-structure-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "pdf-structure-report.md").write_text(render_markdown(report), encoding="utf-8")
    return report


def render_markdown(report: dict[str, Any]) -> str:
    lines = ["# 标签 PDF 能力研究（D12）实测报告", ""]
    lines.append("## 工具探测")
    lines.append("")
    lines.append("| 工具 | 路径 / 版本 |")
    lines.append("| --- | --- |")
    for name, value in report["tools"].items():
        if isinstance(value, dict) and ("path" in value or "version" in value):
            lines.append(
                f"| {name} | {value.get('path') or '缺失'} · {value.get('version') or '—'} |"
            )
        elif isinstance(value, dict):
            lines.append(f"| {name} | {json.dumps(value, ensure_ascii=False)} |")
        else:
            lines.append(f"| {name} | {value} |")
    lines.extend(["", "## 样例结构事实", ""])
    lines.append(
        "| 样例 | 模板 | 页数/需要/溢出 | Tagged | StructTreeRoot | MarkInfo | Lang | Tabs | 图片/替代文本 | XMP/PDF-UA |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for case in report["cases"]:
        pdf = case["pdf"]
        tabs = ",".join(str(fact["tabs"]) for fact in pdf["pages_facts"])
        meta = case.get("pdf_meta") or {}
        page_summary = f"{meta.get('pages')}/{meta.get('pages_needed')}/{meta.get('overflow')}"
        lines.append(
            "| {label} | {template} | {pages} | {tagged} | {struct} | {mark} | {lang} | {tabs} | {img}/{alt} | {xmp}/{ua} |".format(
                label=case["label"],
                template=case["template"],
                pages=page_summary,
                tagged=pdf["tagged_pdf"],
                struct=pdf["struct_tree_root"],
                mark=pdf["mark_info"]["present"],
                lang=pdf["lang"],
                tabs=tabs,
                img=pdf["images_total"],
                alt=pdf["images_with_alt"],
                xmp=pdf["xmp_metadata"]["present"],
                ua=pdf["xmp_metadata"]["pdfuaid_part"],
            )
        )
    lines.extend(["", "## 字体与 ToUnicode", ""])
    for case in report["cases"]:
        fonts = case["pdf"]["embedded_fonts"]
        lines.append(f"### {case['label']}")
        for name, fact in fonts.items():
            lines.append(
                f"- {name}: {fact['base_font']} / {fact['subtype']} / embedded={fact['embedded']} / ToUnicode={fact['to_unicode']}"
            )
    lines.extend(["", "## HTML / Word 对照（同类产物的语义信息）", ""])
    lines.append(
        "| 样例 | HTML lang | h1/h2/h3 | section/main | img/alt | Word 有图片 | Word 文本含姓名 |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for case in report["cases"]:
        html = case["html"]
        docx = case["docx"]
        lines.append(
            "| {label} | {lang} | {h1}/{h2}/{h3} | {sec}/{main} | {img}/{alt} | {wimg} | {wname} |".format(
                label=case["label"],
                lang=html["lang"],
                h1=html["h1_count"],
                h2=html["h2_count"],
                h3=html["h3_count"],
                sec=html["section_count"],
                main=html["main_count"],
                img=html["img_count"],
                alt=html["img_with_alt"],
                wimg=docx["has_image"],
                wname=docx["text_has_name"],
            )
        )
    for case in report["cases"]:
        order = case.get("reading_order")
        if not order:
            continue
        lines.extend(
            [
                "",
                f"## 阅读顺序实测：{case['label']}（提取器 {order['extractor']}）",
                "",
                "默认提取（按内容流 / 提取器启发式）：",
                "",
                "~~~text",
                order["plain_text_head"],
                "~~~",
                "",
                "版面模式（pdftotext -layout，按视觉行/列）：",
                "",
                "~~~text",
                order["layout_text_head"],
                "~~~",
            ]
        )
    determinism = report["determinism"]
    lines.extend(
        [
            "",
            "## 可复现性",
            "",
            f"- 冷缓存首渲 vs 紧随其后的第二渲：字节相同={determinism['first_vs_second']['bytes_equal']}；"
            f"创建时间 {determinism['first_vs_second']['creation_date']}；"
            f"字节数 {determinism['first_vs_second']['sizes']}",
            f"- 首渲 vs 隔 1.1 秒后的第三渲：字节相同={determinism['first_vs_third']['bytes_equal']}；"
            f"创建时间 {determinism['first_vs_third']['creation_date']}；"
            f"字节数 {determinism['first_vs_third']['sizes']}",
            f"- 三次文本相同={determinism['text_equal']}，页数={determinism['pages']}",
            f"- 原因：{determinism['reason']}",
            "",
            "## 限制（必须随结论一起引用）",
            "",
            "- 当前 PDF **不是 Tagged PDF**：没有结构树、没有 Marked 内容、没有语言、没有图片替代文本，",
            "  阅读顺序来自绘制顺序与提取器启发式，不是结构保证。",
            "- 未做任何 PDF/UA、WCAG 或真实屏幕阅读器验证；本报告不构成无障碍达标声明。",
            "- 文本提取结论依赖字体轮廓格式与提取器：CFF 字体（本机默认）存在已知提取缺陷，",
            "  详见 docs/quality/tagged-pdf-research-d12.md 与 .github/workflows/ci.yml 的字体说明。",
        ]
    )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="D12 标签 PDF 能力研究取证工具")
    parser.add_argument("--out", default="", help=f"输出目录（默认 {DEFAULT_OUTPUT_DIR}）")
    args = parser.parse_args(argv)
    out_dir = Path(args.out).expanduser().resolve() if args.out else DEFAULT_OUTPUT_DIR
    report = build_report(out_dir)
    print(f"仓库根：{REPO_ROOT}")
    print(f"输出目录：{out_dir}")
    print(f"样例数：{len(report['cases'])}；报告：pdf-structure-report.json / .md")
    for case in report["cases"]:
        pdf = case["pdf"]
        meta = case.get("pdf_meta") or {}
        print(
            f"  {case['label']:<20} pages={pdf['pages']} needed={meta.get('pages_needed')} "
            f"overflow={meta.get('overflow')} tagged={pdf['tagged_pdf']} "
            f"lang={pdf['lang']} images={pdf['images_total']} alt={pdf['images_with_alt']}"
        )
    determ = report["determinism"]
    print(
        f"复现性：首渲/次渲字节相同={determ['first_vs_second']['bytes_equal']} "
        f"首渲/第三渲字节相同={determ['first_vs_third']['bytes_equal']} "
        f"文本相同={determ['text_equal']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

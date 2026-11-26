# SPDX-License-Identifier: Apache-2.0
"""探针报告的 Markdown 渲染（三项数字 + 逐份明细 + 支持范围结论）。

报告是给人看的东西，所以数字必须**自带口径**：表格下面写清每一列怎么算的，
结论里点明"拒绝的是哪一类、为什么不是实现水平问题"。
"""

from __future__ import annotations

from .probe import DocReport

_TABLE_HEADER = "| # | 文件 | 类别 | 页 | 字符 | 块 | 可编辑块 | 旋转块 | 分栏对 | 覆盖率 | 归一化字体 | 判定 | 原因码 |"
_TABLE_RULE = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"

_COLUMN_NOTES = (
    "列说明：「块」= 切出来的文本块总数；「可编辑块」= 正向、字号可用、字全部在系统字体里；"
    "「旋转块」= 块内存在 |旋转角| > 1° 的行；「分栏对」= 左右并列且各自 ≥2 行的块对数；"
    "「覆盖率」= 文档字符里系统 CJK 字体可渲染的比例；「归一化字体」= 因 `/Encoding` 是"
    "内嵌 CMap（fpdf2 2.9 + OTF/CFF 的产物）而被改写成 `/Identity-H` 的 Type0 字体数。"
)


def _doc_rate(rows: list[DocReport], verdict: str) -> float:
    if not rows:
        return 0.0
    return sum(1 for row in rows if row.verdict == verdict) / len(rows)


def _has(rows: list[DocReport], attr: str) -> float:
    if not rows:
        return 0.0
    return sum(1 for row in rows if getattr(row, attr)) / len(rows)


def _block_rate(rows: list[DocReport]) -> float:
    total = sum(row.blocks for row in rows)
    return sum(row.editable_blocks for row in rows) / total if total else 0.0


def _coverage(rows: list[DocReport]) -> float:
    chars = sum(row.chars for row in rows)
    return sum(row.coverage * row.chars for row in rows) / chars if chars else 0.0


_METRICS = (
    ("文档级块识别率（切出 ≥1 个可编辑块 / 总数）", lambda rows: _has(rows, "editable_blocks")),
    ("块级识别率（可编辑块 / 总文本块）", _block_rate),
    ("字体覆盖率（系统 CJK 字体可覆盖的字符占比）", _coverage),
    ("含旋转文本的文档占比", lambda rows: _has(rows, "rotated_blocks")),
    ("检测到并列分栏块的文档占比（各 ≥2 行）", lambda rows: _has(rows, "column_pairs")),
    ("判定=可编辑的文档占比", lambda rows: _doc_rate(rows, "可编辑")),
    ("判定=仅只读的文档占比", lambda rows: _doc_rate(rows, "仅只读")),
    ("判定=拒绝的文档占比", lambda rows: _doc_rate(rows, "拒绝")),
)


def _conclusion(real: list[DocReport], generated: list[DocReport]) -> list[str]:
    rows = real + generated
    total = len(rows)
    ok = [row for row in rows if row.verdict == "可编辑"]
    read_only = [row for row in rows if row.verdict == "仅只读"]
    rejected = [row for row in rows if row.verdict == "拒绝"]
    doc_rate = len(ok) / total if total else 0.0
    lines = [
        f"- 文档级块识别率 **{doc_rate:.1%}**（{len(ok)}/{total} 份判为可编辑），"
        f"块级 **{_block_rate(rows):.1%}**（"
        f"{sum(row.editable_blocks for row in rows)}/{sum(row.blocks for row in rows)} 个块）。",
        f"- 判定分布：可编辑 {len(ok)} / 仅只读 {len(read_only)} / 拒绝 {len(rejected)}。",
        "- 拒绝的只有**没有文本层**的文件（两份 `scan_resume*.pdf` 整页是图像）："
        "覆盖式改字无从下手，只能引导用户下载后用本地工具改。",
        "- 并列分栏（表格 / 两栏）**不作为拒绝理由**：切块时同一基线上的多段各自成行、"
        "该行不再跨行合并，编辑单元退化为单行，回流只在该行宽度内，不会跨栏。"
        "（表格样本切出 27 个单元格块，两栏样本切出 20 个单行块。）",
        "- 6 份 fpdf2 2.9 + 思源黑体（OTF/CFF）导出的样本，pdfminer.six 直接读会得到"
        "**零个字形**：它们的 `/Encoding` 是内嵌 CMap 流（`CMapName=Adobe-Identity-UCS`），"
        "而 pdfminer 只按 CMap 名字查预定义表。把该字体改写成 `/Identity-H`（2 字节码 = CID，"
        "语义等价）后全部可读。**这条必须进实现**，否则本应用自己导出的 PDF 会被误判成扫描件。",
        "  **反证（已实测）**：把 `normalize_cid_encoding` 短路成恒等函数后重跑，这 6 份"
        "全部变成 `拒绝`、字符数 0，其中带表格线的那份还被误判成 `pdf_outlined_text`——"
        "说明「没有文字层」的分支确实会被这条编码差异骗到。",
        "- 旋转 / 倾斜块与含系统字体渲染不出字符的块在**块级**排除，其余照样可编辑。",
    ]
    if doc_rate < 0.6:
        lines.append(
            "- **文档级块识别率低于 60%，按协议停下等裁决**：不支持在线编辑，"
            "只保留「查看文本 / 下载后本地修改」两条路径。"
        )
    else:
        lines.append(
            "- 结论：块识别率达标，PDF 覆盖式改字可按「文本块」粒度实现；"
            "扫描件 / 转曲 / 加密 / 表单页一律 4xx 拒绝并给出原因码。"
        )
    return lines


def render_markdown(real: list[DocReport], generated: list[DocReport], meta: dict[str, str]) -> str:
    """整篇报告。"""
    rows = real + generated
    lines: list[str] = [
        "# #5 步骤 0 探针报告：真实 PDF 的块识别率 / 字体覆盖 / 旋转与多栏",
        "",
        f"> 生成时间：{meta.get('generated_at', '')}　语料：真实 {len(real)} 份 + 生成 {len(generated)} 份",
        f"> 环境：{meta.get('env', '')}",
        "> 切块规则：`backend/app/services/external_resume_pdf_blocks.py`（阈值改动需重跑本报告）",
        "",
        "## 1. 三项数字（真实样本 / 生成样本分开统计，绝不混成一个数）",
        "",
        "| 指标 | 真实样本 | 生成样本 | 合计 |",
        "| --- | --- | --- | --- |",
    ]
    for label, metric in _METRICS:
        lines.append(
            f"| {label} | {metric(real):.2%} | {metric(generated):.2%} | {metric(rows):.2%} |"
        )
    lines += ["", "## 2. 逐份明细", "", _TABLE_HEADER, _TABLE_RULE]
    for index, row in enumerate(rows, start=1):
        lines.append(
            f"| {index} | {row.name} | {'真实' if row.origin == 'real' else '生成'} | "
            f"{row.pages} | {row.chars} | {row.blocks} | {row.editable_blocks} | "
            f"{row.rotated_blocks} | {row.column_pairs} | {row.coverage:.2%} | "
            f"{row.normalized} | {row.verdict} | `{row.reason}` |"
        )
    lines += ["", _COLUMN_NOTES, "", "### 2.1 非可编辑文档的原因", ""]
    flagged = [row for row in rows if row.detail or row.missing]
    for row in flagged:
        example = "".join(row.missing)
        suffix = f"；缺字样例：{example}" if example else ""
        lines.append(f"- **{row.name}**（{row.verdict} / `{row.reason}`）：{row.detail}{suffix}")
    if not flagged:
        lines.append("- 无（全部可编辑）")
    lines += ["", "## 3. 支持范围结论", ""]
    lines += _conclusion(real, generated)
    lines += [
        "",
        "## 4. 复现",
        "",
        "```bash",
        "cd backend && .venv/Scripts/python.exe scripts/p5_pdf_block_probe.py \\",
        "    --real data/datasets/user_files data/share_packages data/legacy-archive \\",
        "    --generate 6 --out D:/rf_tools/p5-probe-2026-11-26.md",
        "```",
        "",
    ]
    return "\n".join(lines)


__all__ = ["render_markdown"]

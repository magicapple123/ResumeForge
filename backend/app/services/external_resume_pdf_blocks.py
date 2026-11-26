# SPDX-License-Identifier: Apache-2.0
"""PDF 文本块几何：字形 → 行 → 块（外部简历「覆盖式改字」的编辑单元）。

**为什么单独一层**：这一层只做纯几何计算（无 I/O、无 pdfminer 依赖），所以既能被
`services/external_resume_pdf.py` 用于改字，也能被探针脚本直接复用来统计切块质量。
如果把它和 pdfminer 的读取混在一起，"切块规则"就没有唯一定义处了。

## 切块规则（改一个阈值就要重跑 `scripts/p5_pdf_block_probe.py`）

1. **字 → 行**：基线（`LTChar.matrix` 的平移量，**不是 bbox 顶边**）接近、字号接近、
   旋转角一致的字归一行；同一基线上水平间隙超过 1.8 倍字号就断成两段——两栏并排的
   文字因此不会粘成一行。
2. **行结构标记**：同一基线上还有别的段（表格一行里的多个单元格、两栏并排）→ 该行
   标 `tabular`。这类行**不参与跨行合并**，否则表格第一列会从表头一路并到最后一行，
   用户点一个单元格却选中整列。
3. **行 → 块**：同字号（±0.6pt）+ 左缩进一致（±2.5pt）+ 行距连续（0.5~2.2 倍字号）
   + 同向（±1°）。
4. **可编辑**：块内所有非空白字符都能被系统 CJK 字体渲染（否则重排后缺字变豆腐块）、
   正向、字号 ≥ 4pt、块宽 > 0。

**多栏不是拒绝理由**：规则 1/2 的结果是"多栏文档的编辑单元退化为单行"，回流只在
该行宽度内，不可能跨栏；真正拒绝的只有"没有文本层"（扫描件 / 转曲）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# 同字号判定（pt）。
SIZE_TOL = 0.6
# 左缩进一致判定（pt）。
INDENT_TOL = 2.5
# 行距上限 = 2.2 × 字号（超过就当换段）。
LINE_GAP_MAX = 2.2
# 行距下限，避免把上下叠在一起的字并成一行。
LINE_GAP_MIN = 0.5
# 同一行带内水平间隙 > 1.8 × 字号 → 断成两段（拦两栏并行）。
COLUMN_GAP = 1.8
# 同一行的基线容差 = 0.5 × 字号。
BASELINE_TOL = 0.5
# |旋转角| ≤ 1° 视为正向。
UPRIGHT_DEG = 1.0
# 块内可用字号下限。
MIN_SIZE = 4.0
# 对齐判定容差（pt）。
ALIGN_TOL = 2.0


@dataclass(frozen=True)
class Glyph:
    """一个字形：位置、字号、基线、旋转角。"""

    ch: str
    x0: float
    x1: float
    y0: float
    y1: float
    size: float
    baseline: float
    angle: float


@dataclass
class Line:
    """一行字（可能是表格里的一格，也可能是两栏中的一栏）。"""

    glyphs: list[Glyph] = field(default_factory=list)
    size: float = 0.0
    baseline: float = 0.0
    angle: float = 0.0
    x0: float = 0.0
    x1: float = 0.0
    y0: float = 0.0
    y1: float = 0.0
    # 同一基线上还有别的段 → 表格单元格 / 并列栏，不参与跨行合并。
    tabular: bool = False

    def text(self) -> str:
        """行文本：字间水平间隙超过 0.25 倍字号就补一个空格。"""
        parts: list[str] = []
        prev: Glyph | None = None
        for glyph in self.glyphs:
            if prev is not None and glyph.x0 - prev.x1 > 0.25 * max(self.size, 1.0):
                parts.append(" ")
            parts.append(glyph.ch)
            prev = glyph
        return "".join(parts)


@dataclass
class TextBlock:
    """一个编辑单元：基线连续、左缩进一致、同字号的一叠行。"""

    block_id: str
    page: int
    lines: list[Line]

    @property
    def size(self) -> float:
        return round(self.lines[0].size, 1)

    @property
    def x0(self) -> float:
        return min(line.x0 for line in self.lines)

    @property
    def x1(self) -> float:
        return max(line.x1 for line in self.lines)

    @property
    def y0(self) -> float:
        return min(line.y0 for line in self.lines)

    @property
    def y1(self) -> float:
        return max(line.y1 for line in self.lines)

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def baseline(self) -> float:
        """首行基线：回填时按基线对齐（用 bbox 顶边会让中英混排错半格）。"""
        return self.lines[0].baseline

    @property
    def leading(self) -> float:
        """行距：多行块取平均基线间距；单行块按 1.35 倍字号估。"""
        if len(self.lines) < 2:
            return round(self.lines[0].size * 1.35, 2)
        gaps = [
            self.lines[index].baseline - self.lines[index + 1].baseline
            for index in range(len(self.lines) - 1)
        ]
        return round(sum(gaps) / len(gaps), 2)

    @property
    def align(self) -> str:
        """对齐方式：left / center / right / justify。"""
        if len(self.lines) == 1:
            return "left"
        left_aligned = all(abs(line.x0 - self.x0) <= ALIGN_TOL for line in self.lines)
        right_aligned = all(abs(line.x1 - self.x1) <= ALIGN_TOL for line in self.lines)
        if left_aligned and right_aligned:
            # 两端都贴边 = 两端对齐（中文简历里很常见）。
            return "justify"
        if left_aligned:
            return "left"
        if right_aligned:
            return "right"
        centres = [(line.x0 + line.x1) / 2 for line in self.lines]
        if all(abs(centre - sum(centres) / len(centres)) <= ALIGN_TOL for centre in centres):
            return "center"
        return "left"

    @property
    def text(self) -> str:
        return "\n".join(line.text() for line in self.lines)

    @property
    def rotated(self) -> bool:
        return any(abs(line.angle) > UPRIGHT_DEG for line in self.lines)

    def rerenderable(self, charset: set[str]) -> bool:
        """块内非空白字符是否都能被目标字体渲染出来。"""
        return all(ch in charset for ch in "".join(self.text.split()))

    def editable(self, charset: set[str]) -> bool:
        """块能否在线编辑：正向 + 有字 + 字号可用 + 字都在系统字体里。

        缺字必须落到块上：新字用系统 CJK 字体写，块里但凡有一个系统字体渲染不出来的
        字（子集字体里的异体 / 私用区），重排后那个字就会变成豆腐块——宁可整块不许编辑。
        """
        if not self.text.strip():
            return False
        if self.width <= 0 or self.size < MIN_SIZE:
            return False
        if self.rotated:
            return False
        return self.rerenderable(charset)


def split_into_lines(glyphs: list[Glyph]) -> list[Line]:
    """字形 → 行：按基线聚类，再按水平间隙切成段（两栏不并成一行）。"""
    ordered = sorted(glyphs, key=lambda glyph: (-round(glyph.baseline, 1), glyph.x0))
    clusters: list[list[Glyph]] = []
    for glyph in ordered:
        placed = False
        # 只看最近几簇：基线是降序排的，越往后差得越远，全表扫描纯属浪费。
        for cluster in clusters[-6:]:
            head = cluster[0]
            if (
                abs(glyph.baseline - head.baseline)
                <= BASELINE_TOL * max(head.size, glyph.size, 1.0)
                and abs(glyph.size - head.size) <= SIZE_TOL
                and abs(glyph.angle - head.angle) <= UPRIGHT_DEG
            ):
                cluster.append(glyph)
                placed = True
                break
        if not placed:
            clusters.append([glyph])

    lines: list[Line] = []
    for cluster in clusters:
        cluster.sort(key=lambda glyph: glyph.x0)
        segment: list[Glyph] = []
        for glyph in cluster:
            if segment and glyph.x0 - segment[-1].x1 > COLUMN_GAP * max(glyph.size, 1.0):
                lines.append(_line_of(segment))
                segment = []
            segment.append(glyph)
        if segment:
            lines.append(_line_of(segment))
    lines = [line for line in lines if line.glyphs]
    lines.sort(key=lambda line: (-line.baseline, line.x0))
    return lines


def _line_of(glyphs: list[Glyph]) -> Line:
    head = glyphs[0]
    return Line(
        glyphs=list(glyphs),
        size=round(head.size, 1),
        baseline=head.baseline,
        angle=head.angle,
        x0=min(glyph.x0 for glyph in glyphs),
        x1=max(glyph.x1 for glyph in glyphs),
        y0=min(glyph.y0 for glyph in glyphs),
        y1=max(glyph.y1 for glyph in glyphs),
    )


def mark_tabular(lines: list[Line]) -> list[Line]:
    """标出"同一基线上有多段"的行（表格单元格 / 两栏并排）。"""
    rows: dict[int, list[Line]] = {}
    for line in lines:
        rows.setdefault(round(line.baseline), []).append(line)
    for members in rows.values():
        if len(members) < 2:
            continue
        for line in members:
            line.tabular = True
    return lines


def group_blocks(lines: list[Line], page_no: int) -> list[TextBlock]:
    """行 → 块：同字号 + 左缩进一致 + 行距连续 + 同向；行结构里的行只独占成块。"""
    blocks: list[TextBlock] = []
    for line in lines:
        target: TextBlock | None = None
        candidates = [] if line.tabular else list(reversed(blocks))
        for block in candidates:
            last = block.lines[-1]
            if last.tabular:
                continue
            if abs(line.size - block.lines[0].size) > SIZE_TOL:
                continue
            if abs(line.x0 - block.lines[0].x0) > INDENT_TOL:
                continue
            if abs(line.angle - block.lines[0].angle) > UPRIGHT_DEG:
                continue
            gap = last.baseline - line.baseline
            if not (LINE_GAP_MIN * line.size <= gap <= LINE_GAP_MAX * line.size):
                continue
            target = block
            break
        if target is None:
            blocks.append(TextBlock(block_id="", page=page_no, lines=[line]))
        else:
            target.lines.append(line)
    blocks.sort(key=lambda block: (-block.baseline, block.x0))
    for index, block in enumerate(blocks):
        block.block_id = f"p{page_no}b{index}"
    return blocks


def multi_column_pairs(blocks: list[TextBlock]) -> int:
    """并列分栏的对数（诊断用）：两块各自 ≥2 行、竖向区间重叠 ≥40%、横向不相交。

    切块规则生效后多栏文档会退化成单行块，所以这个数通常为 0；留着是为了在探针里
    发现"规则失效把两栏并进了一个块"的回归。
    """
    pairs = 0
    tall = [block for block in blocks if len(block.lines) >= 2]
    for index, left in enumerate(tall):
        for right in tall[index + 1 :]:
            overlap = min(left.y1, right.y1) - max(left.y0, right.y0)
            if overlap <= 0:
                continue
            shorter = min(left.y1 - left.y0, right.y1 - right.y0)
            if shorter <= 0 or overlap / shorter < 0.4:
                continue
            if left.x1 <= right.x0 or right.x1 <= left.x0:
                pairs += 1
    return pairs


def glyph_angle(matrix: tuple[float, ...]) -> float:
    """从文本矩阵取旋转角（度）。正向文本恒为 0。"""
    a, b = float(matrix[0]), float(matrix[1])
    return math.degrees(math.atan2(b, a))


__all__ = [
    "ALIGN_TOL",
    "BASELINE_TOL",
    "COLUMN_GAP",
    "INDENT_TOL",
    "LINE_GAP_MAX",
    "LINE_GAP_MIN",
    "MIN_SIZE",
    "SIZE_TOL",
    "UPRIGHT_DEG",
    "Glyph",
    "Line",
    "TextBlock",
    "glyph_angle",
    "group_blocks",
    "mark_tabular",
    "multi_column_pairs",
    "split_into_lines",
]

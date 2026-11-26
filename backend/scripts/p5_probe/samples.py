# SPDX-License-Identifier: Apache-2.0
"""探针用的合成 PDF 样本：用应用自己的导出链（fpdf2 + 系统 CJK 字体）造版式。

真实语料只有 10 份、且清一色是"单栏文字简历 + 扫描件"，覆盖不到表格线、两栏、
页眉页脚这些会直接影响切块质量的版式。这六份样本补的正是那几块：

====================  ============================================
文件                    版式
====================  ============================================
gen-01-cn-en-long      中英混排长段落（块内回流的主要场景）
gen-02-two-column      两栏并列（编辑单元应退化为单行）
gen-03-table-lines     带边框的表格（守"只删文本算子、不碰表格线"）
gen-04-header-footer   页眉页脚（每页都有的短块）
gen-05-en-only         纯英文（西文断行与中文不同）
gen-06-dense-list      短行密集列表（行距接近字号，检验块合并阈值）
====================  ============================================
"""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

_LONG_CN = (
    "负责企业级 Agent 平台的产品设计与落地，覆盖意图识别、工具编排与效果评测三条主链。"
    "主导从 0 到 1 搭建评测闭环，把人工抽检改造成可回归的自动化基线，季度内把线上事故率降了 42%。"
    "与算法、后端、设计三方协同，把需求拆成可验证的里程碑，按两周一个节奏交付。"
)
_LONG_EN = (
    "Owned the enterprise agent platform end to end, from intent routing to tool orchestration "
    "and offline evaluation. Shipped a regression baseline that replaced manual spot checks and "
    "cut production incidents by 42% within one quarter."
)

SAMPLE_NAMES: tuple[str, ...] = (
    "gen-01-cn-en-long.pdf",
    "gen-02-two-column.pdf",
    "gen-03-table-lines.pdf",
    "gen-04-header-footer.pdf",
    "gen-05-en-only.pdf",
    "gen-06-dense-list.pdf",
)

# 样本字体刻意用**仓库自带的思源黑体 OTF**：它走 CFF/CIDFontType0 那条路，产物的
# `/Encoding` 是内嵌 CMap 流——正是 pdfminer.six 读不出字、必须做编码归一化的那一类。
# 用系统 TrueType（msyh）生成会写成 `/Identity-H`，把这条最关键的坑盖住。
SAMPLE_FONT = Path(__file__).resolve().parents[2] / "data" / "fonts" / "SourceHanSansSC-Regular.otf"


def default_sample_font() -> Path | None:
    """造样本用的字体：优先仓库自带的思源黑体 OTF，没有就返回 None（由调用方回退）。"""
    return SAMPLE_FONT if SAMPLE_FONT.is_file() else None


def _new_pdf(font_regular: Path) -> FPDF:
    """新画布：注册常规 + 粗体；粗体缺失时退回常规（与导出链同口径）。"""
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(auto=True, margin=60)
    pdf.add_font("cjk", "", str(font_regular))
    bold = font_regular.parent / "SourceHanSansSC-Bold.otf"
    pdf.add_font("cjk", "B", str(bold if bold.is_file() else font_regular))
    return pdf


def _long_paragraphs(pdf: FPDF, rounds: int) -> None:
    """中英混排长段落：每轮中英各一段。"""
    pdf.set_font("cjk", "", 10.5)
    for _ in range(rounds):
        pdf.multi_cell(0, 17, _LONG_CN, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)
        pdf.multi_cell(0, 17, _LONG_EN, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(8)


def _sample_cn_en_long(font_regular: Path, out: Path) -> None:
    pdf = _new_pdf(font_regular)
    pdf.add_page()
    pdf.set_font("cjk", "B", 18)
    pdf.multi_cell(0, 26, "黄岑果 / 高级产品经理", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    _long_paragraphs(pdf, rounds=3)
    pdf.output(str(out))


def _sample_two_column(font_regular: Path, out: Path) -> None:
    pdf = _new_pdf(font_regular)
    pdf.add_page()
    left_x, right_x, col_w, top = 56, 310, 230, 70
    pdf.set_font("cjk", "B", 12)
    pdf.set_xy(left_x, top)
    pdf.cell(col_w, 18, "工作经历")
    pdf.set_xy(right_x, top)
    pdf.cell(col_w, 18, "项目经历")
    pdf.set_font("cjk", "", 9)
    for index in range(9):
        pdf.set_xy(left_x, top + 26 + index * 26)
        pdf.multi_cell(
            col_w,
            13,
            f"2021-2024 某公司 产品经理 第{index + 1}段经历",
            new_x="LEFT",
            new_y="TOP",
        )
        pdf.set_xy(right_x, top + 26 + index * 26)
        pdf.multi_cell(
            col_w,
            13,
            f"2022-2023 某项目 负责人 第{index + 1}段项目",
            new_x="LEFT",
            new_y="TOP",
        )
    pdf.output(str(out))


def _sample_table_lines(font_regular: Path, out: Path) -> None:
    pdf = _new_pdf(font_regular)
    pdf.add_page()
    pdf.set_font("cjk", "", 10)
    pdf.set_xy(56, 70)
    pdf.cell(120, 20, "公司", border=1)
    pdf.cell(160, 20, "职位", border=1)
    pdf.cell(120, 20, "时间", border=1)
    pdf.ln(20)
    for index in range(8):
        pdf.set_x(56)
        pdf.cell(120, 20, f"示例公司{index}", border=1)
        pdf.cell(160, 20, f"高级产品经理 {index}", border=1)
        pdf.cell(120, 20, f"2021.0{index + 1}-2023.0{index + 1}", border=1)
        pdf.ln(20)
    pdf.output(str(out))


class _HeaderFooterPDF(FPDF):
    """每页都画页眉页脚（页脚用的是 fpdf2 的钩子）。"""

    def header(self) -> None:
        self.set_font("cjk", "", 8)
        self.set_xy(56, 30)
        # 定宽而非 0：0 会把 x 推到右边界，正文的 multi_cell(0, ...) 就没宽度了。
        self.cell(300, 12, "黄岑果 · 简历 · 机密")
        self.set_xy(self.l_margin, 60)

    def footer(self) -> None:
        self.set_font("cjk", "", 8)
        self.set_xy(56, 800)
        self.cell(300, 12, f"第 {self.page_no()} 页 · 联系方式 138-0000-0000")


def _sample_header_footer(font_regular: Path, out: Path) -> None:
    pdf = _HeaderFooterPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(auto=True, margin=70)
    pdf.add_font("cjk", "", str(font_regular))
    pdf.set_font("cjk", "", 10.5)
    pdf.add_page()
    for _ in range(5):
        pdf.multi_cell(0, 17, _LONG_CN, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(6)
    pdf.output(str(out))


def _sample_en_only(font_regular: Path, out: Path) -> None:
    pdf = _new_pdf(font_regular)
    pdf.add_page()
    pdf.set_font("cjk", "B", 16)
    pdf.multi_cell(0, 24, "Senior Product Manager", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)
    pdf.set_font("cjk", "", 10)
    for _ in range(6):
        pdf.multi_cell(0, 15, _LONG_EN, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(6)
    pdf.output(str(out))


def _sample_dense_list(font_regular: Path, out: Path) -> None:
    pdf = _new_pdf(font_regular)
    pdf.add_page()
    pdf.set_font("cjk", "", 9.5)
    for index in range(30):
        pdf.multi_cell(
            0,
            14,
            f"· 技能项 {index + 1}：需求分析 / 数据分析 / A/B 实验 / SQL",
            new_x="LMARGIN",
            new_y="NEXT",
        )
    pdf.output(str(out))


_BUILDERS = {
    "gen-01-cn-en-long.pdf": _sample_cn_en_long,
    "gen-02-two-column.pdf": _sample_two_column,
    "gen-03-table-lines.pdf": _sample_table_lines,
    "gen-04-header-footer.pdf": _sample_header_footer,
    "gen-05-en-only.pdf": _sample_en_only,
    "gen-06-dense-list.pdf": _sample_dense_list,
}


def generate_samples(out_dir: Path, font_regular: Path, limit: int = 6) -> list[Path]:
    """把样本写进 ``out_dir``，返回文件路径（顺序固定，便于报告横向比对）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name in SAMPLE_NAMES[:limit]:
        path = out_dir / name
        _BUILDERS[name](font_regular, path)
        written.append(path)
    return written


__all__ = ["SAMPLE_FONT", "SAMPLE_NAMES", "default_sample_font", "generate_samples"]

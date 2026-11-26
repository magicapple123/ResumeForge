# SPDX-License-Identifier: Apache-2.0
"""探针 CLI（#5 步骤 0）的**真实性闸门**：没有真实样本时必须失败退出。

## 为什么这算缺陷，不是口味问题

报告的第一张表有一列「合计」，它把真实样本与生成样本加在一起算。不传 `--real` 时
真实样本为空、生成样本全绿，于是那三行都打印 **100%**——看着像"真实简历都跑通了"，
实际一个真实 PDF 都没打开过。这正是项目里"无法判断要说清原因"要禁止的静默降级：
数字好看，结论不成立。

## 守四件事

1. 不传 `--real` → 非零退出，stderr 说明"本次不是真实评测"，输出里**没有** `100%`；
2. `--real` 指向空目录 → 同上（目录存在但没有 PDF）；
3. `--real` 里全是坏文件（读不进来）→ 同上，并逐份列出原因；
4. 有真实样本 → 退出码 0、正常出汇总（否则闸门会变成"永远失败"的空转守卫）。

第 4 条同时钉住"读进来了但判定不支持"（扫描件）**不能**被闸门算成不可读：`readable`
与 `verdict` 是两个口径。这里用一份正常文本 PDF 证明真实样本这条路是通的；扫描件那
一侧由 `pdf_no_text_layer` 的语义与 `probe.py::_UNREADABLE_CODES` 保证（只有
`pdf_parse_failed` / `pdf_unsupported` 算不可读）。

反证（跑过）：把 `main()` 里的 `if not args.real:` 分支删掉 → 第 1 条精确变红
（输出里出现 `合计 … 100%`，退出码 0）；复原后 sha256 一致、复绿。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from app.services.external_resume_pdf_scan import system_font_path
from fpdf import FPDF

BACKEND_DIR = Path(__file__).resolve().parents[1]
# 与 `test_backup_restore_drill.py` 同一做法：脚本不在 app 包里，显式补 sys.path。
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.p5_pdf_block_probe import (  # noqa: E402 - 先补 backend/ 到 sys.path
    EXIT_NOT_A_REAL_RUN,
    main,
)


def build_text_pdf() -> bytes:
    """一份真的有文字层的 PDF（用内置 Helvetica，不依赖系统 CJK 字体）。"""
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    pdf.set_font("helvetica", size=14)
    pdf.text(50, 700, "Alex Chen - Backend Engineer - 5 years")
    return bytes(pdf.output())


def test_without_real_flag_it_fails_and_never_prints_100_percent(capsys):
    """不传 `--real`：非零退出 + 说清"不是真实评测" + 输出里不能出现 100%。"""
    code = main(["--generate", "6"])

    captured = capsys.readouterr()
    assert code == EXIT_NOT_A_REAL_RUN
    assert code != 0
    assert "未提供真实语料目录" in captured.err
    assert "不是真实评测" in captured.err
    # 关键断言：那句话之前，这里会打印「合计 … 100.00%」。
    assert "100%" not in captured.out + captured.err


def test_real_flag_pointing_at_empty_dir_fails(tmp_path, capsys):
    """给了 `--real` 但目录里没有 PDF：与"没给"同等处理，不降级成生成样本。"""
    code = main(["--real", str(tmp_path), "--generate", "6"])

    captured = capsys.readouterr()
    assert code == EXIT_NOT_A_REAL_RUN
    assert "没有可读的 PDF" in captured.err
    assert "100%" not in captured.out + captured.err


def test_real_flag_pointing_at_missing_path_fails(tmp_path, capsys):
    """路径根本不存在（打错目录名）同样不能出报告。"""
    code = main(["--real", str(tmp_path / "no-such-dir"), "--generate", "0"])

    captured = capsys.readouterr()
    assert code == EXIT_NOT_A_REAL_RUN
    assert "没有可读的 PDF" in captured.err


@pytest.mark.skipif(system_font_path() is None, reason="本机没有中文字体，探针跑不起来")
def test_all_unreadable_samples_fail(tmp_path, capsys):
    """语料在、但一份都解析不了：这不是"全部被拒绝"，是"没读到东西"，必须失败。"""
    (tmp_path / "broken.pdf").write_bytes(b"%PDF-1.4 not really a pdf")

    code = main(["--real", str(tmp_path), "--generate", "0"])

    captured = capsys.readouterr()
    assert code == EXIT_NOT_A_REAL_RUN
    assert "全部无法读取" in captured.err
    # 逐份点名：只给一句"全部无法读取"等于让人猜是哪一份坏了。
    assert "broken.pdf" in captured.err
    assert "100%" not in captured.out + captured.err


@pytest.mark.skipif(system_font_path() is None, reason="本机没有中文字体，探针跑不起来")
def test_real_sample_produces_the_summary(tmp_path, capsys):
    """有真实样本时正常出报告（闸门不能把正常路径也拦掉）。"""
    sample = tmp_path / "resume.pdf"
    sample.write_bytes(build_text_pdf())

    code = main(["--real", str(tmp_path), "--generate", "0"])

    captured = capsys.readouterr()
    assert code == 0
    assert "文档级块识别率" in captured.out
    assert "语料：真实 1 份 + 生成 0 份" in captured.out
    assert "resume.pdf" in captured.out
    # 这份样本有文字层 → 判可编辑，不该出现拒绝行。
    assert "拒绝" not in captured.err

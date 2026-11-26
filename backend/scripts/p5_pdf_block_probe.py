# SPDX-License-Identifier: Apache-2.0
"""探针（#5 步骤 0）：pdfminer.six 能不能把真实简历 PDF 切成可编辑文本块。

**为什么先跑探针**：外部简历「应用内编辑」的前提是"文字版 PDF 能被稳定切成以文本块
为单位的编辑单元"。这个前提读文档确认不了——真实语料里有扫描件、有转曲的作品集、
有多栏排版。切不动就不该开工写编辑逻辑。

本脚本只做统计，**不产出、不改写任何 PDF**。三项数字：块识别率 / 字体覆盖率 /
旋转与多栏占比；真实样本与生成样本**分开统计**。切块与读侧的代码都在
`app/services/external_resume_pdf_blocks.py` / `external_resume_pdf_scan.py`，
探针只负责跑一遍并汇总——所以报告里的数字就是上线后的行为。

用法：

    cd backend && .venv/Scripts/python.exe scripts/p5_pdf_block_probe.py \
        --real data/datasets/user_files data/share_packages data/legacy-archive \
        --generate 6 --out D:/rf_tools/p5-probe-2026-11-26.md
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    # 允许 `python scripts/p5_pdf_block_probe.py` 直接跑（不要求先安装成包）。
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.external_resume_pdf_scan import (  # noqa: E402
    system_font_charset,
    system_font_path,
)
from scripts.p5_probe import report as report_mod  # noqa: E402
from scripts.p5_probe import samples as samples_mod  # noqa: E402
from scripts.p5_probe.probe import DocReport, probe_document, run  # noqa: E402


def _environment(regular_font: Path) -> str:
    """环境指纹：换了 pdfminer 版本或字体，数字就可能不同，报告里要能对上。"""
    import fontTools
    import pdfminer
    import pypdf

    return (
        f"pdfminer.six {getattr(pdfminer, '__version__', '?')} / pypdf {pypdf.__version__} / "
        f"fontTools {fontTools.version} / Python {sys.version.split()[0]}；"
        f"系统 CJK 字体 {regular_font.name}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PDF 文本切块探针（#5 步骤 0）")
    parser.add_argument("--real", nargs="*", default=[], help="真实语料目录或文件")
    parser.add_argument("--generate", type=int, default=6, help="生成样本数量（0 = 不生成）")
    parser.add_argument("--out", default="", help="报告输出路径（.md）；留空则打印到 stdout")
    parser.add_argument("--json", default="", help="明细 JSON 输出路径（可选）")
    args = parser.parse_args(argv)

    regular_font = system_font_path()
    if regular_font is None:
        print("找不到系统中文字体，无法统计字体覆盖率", file=sys.stderr)
        return 2

    charset = system_font_charset()
    real_rows = run([Path(item) for item in args.real])

    generated_rows: list[DocReport] = []
    if args.generate:
        # 样本用仓库自带的思源黑体 OTF（CFF 路径），系统字体只用来量覆盖率。
        sample_font = samples_mod.default_sample_font() or regular_font
        sample_paths = samples_mod.generate_samples(
            BACKEND_DIR / "data" / "probe-samples", sample_font, limit=args.generate
        )
        generated_rows = [
            probe_document(path, "generated", charset, display_name=path.name)
            for path in sample_paths
        ]

    meta = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "env": _environment(regular_font),
    }
    if args.json:
        payload = {
            "real": [row.__dict__ for row in real_rows],
            "generated": [row.__dict__ for row in generated_rows],
            "meta": meta,
        }
        target = Path(args.json)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")

    markdown = report_mod.render_markdown(real_rows, generated_rows, meta)
    if args.out:
        target = Path(args.out)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markdown, "utf-8")
        print(f"报告已写入 {args.out}")
    else:
        print(markdown)

    for row in real_rows + generated_rows:
        print(f"{row.origin:9s} {row.verdict:4s} {row.reason:20s} {row.name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# SPDX-License-Identifier: Apache-2.0
"""已知缺陷最小复现：scholar 技能列表的「•」在同一进程跨模板切换后丢失。

这不是守卫、也不是产品功能，是**缺陷跟踪工具**：W20 期间发现的既有缺陷，修好后
本脚本应打印 FIXED。背景（2026-10-24）：

- scholar 的 PDF 技能列表用 skill_tags._TAG_BULLET = "•" 画项目符号；
- fit._DECORATIVE_CHARS 只登记了「·」（U+00B7），没有「•」（U+2022）；
- PDF 字体子集缓存的字符集按**内容签名**记（不含模板），所以"同一份内容先渲一套
  不含「•」的模板、再渲 scholar"时，scholar 这一趟拿到的子集缺该字形，fpdf2 只打
  一条 missing glyph 警告，纸面上那个符号静默消失。

真实用户路径：同一份简历先看 classic 预览、再切 scholar（同一后端进程），就会命中。

用法（仓库根）：
    backend/.venv/Scripts/python.exe scripts/quality/repro_scholar_bullet_glyph.py
退出码恒为 0；输出里的 REPRODUCED / FIXED 才是结论。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from quality.sample_corpus import build_corpus  # noqa: E402
from quality.sample_render import extract_pdf_text, render_sample  # noqa: E402


def _render_sequence(sample_ids: list[str]) -> tuple[dict[str, bool], list[str]]:
    """按顺序渲染样例，返回 模板→是否含「•」 与 fpdf2 缺字警告。"""
    from app.services.pdf_exporter import font_subset

    samples = {sample.sample_id: sample for sample in build_corpus()}
    font_subset.reset()
    warnings: list[str] = []

    class _Handler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            message = record.getMessage()
            if "missing the following glyphs" in message:
                warnings.append(message)

    handler = _Handler()
    root = logging.getLogger()
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.WARNING)
    try:
        result: dict[str, bool] = {}
        for sample_id in sample_ids:
            sample = samples[sample_id]
            pdf = render_sample(sample, ("pdf",))["pdf"]
            text, _tool = extract_pdf_text(pdf)
            result[f"{sample.template}:{sample_id}"] = "•" in text
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)
    return result, warnings


def main() -> int:
    # iter-01 = classic、iter-06 = scholar；两份样例的 content 完全相同（同一个虚构底座），
    # 正好复现"同一内容、先 classic 后 scholar"的真实切换路径。
    classic_then_scholar, warnings = _render_sequence(["iter-01", "iter-06"])
    scholar_first, _ = _render_sequence(["iter-06", "iter-01"])
    print("顺序 classic→scholar：", classic_then_scholar)
    print("顺序 scholar→classic：", scholar_first)
    print("缺字警告：", warnings[-2:] if warnings else "无")
    classic_ok = classic_then_scholar.get("classic:iter-01") is False
    scholar_broken = classic_then_scholar.get("scholar:iter-06") is False
    scholar_first_ok = scholar_first.get("scholar:iter-06") is True
    if classic_ok and scholar_broken and scholar_first_ok:
        print("RESULT: REPRODUCED（既有缺陷：跨模板切换后 scholar 的「•」丢失）")
    else:
        print("RESULT: FIXED（或环境不满足复现条件，请人工确认）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

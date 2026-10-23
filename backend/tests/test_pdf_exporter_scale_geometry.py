# SPDX-License-Identifier: Apache-2.0
"""三个"乘在模板基准上"的系数在**真实 PDF 几何**里生效（T03 的验收口径）。

从 `test_pdf_exporter_layout.py` 拆出（2026-10-23）：那个文件在补 trio 参数时已到
445 行，再放这一组会破 500 行预算（`test_file_size_budget.py` 零豁免）。

为什么不能用 `resolve_layout` 的比例断言代替这一组：比例算对与"PDF 里真的画成那么大"
是两件事——`name_ratio` 被算出来却没人用它画字，`resolve_layout` 的用例照样全绿。
这里直接读 pypdf 从产物里取回的字号，把"预览改了、导出没改"这条最贵的分叉钉死
（设计 §8 风险 9）。

复用 `test_pdf_exporter.py` 的 helper：`needs_font` / `_text_runs` / `_body_lines`。
"""

import pytest
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import _PX_TO_PT, build_resume_pdf
from app.services.resume.resume_templates import TEMPLATE_LAYOUT_DEFAULTS
from test_pdf_exporter import _body_lines, _text_runs, needs_font


@needs_font
@pytest.mark.parametrize("name", ["classic", "compact", "modern"])
def test_name_scale_changes_the_rendered_name_font_size(name):
    """`name_scale=1.25` 时，PDF 里姓名的字号 = 模板基准 × 系数（不传时严格等于基准）。"""
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
    base_px = 14.0
    resume = ResumeContent(name="张三", summary="一句话总结。")

    def name_pt(format_config: dict) -> float:
        content = build_resume_pdf(
            resume,
            template=name,
            page_limit=2,
            font_scale="standard",
            format_config=format_config,
        ).content
        runs = [run for run in _text_runs(content) if "张三" in run[3]]
        assert runs, f"{name} 里没读到姓名"
        return runs[0][2]

    assert name_pt({}) == pytest.approx(
        base_px * float(defaults["name_ratio"]) * _PX_TO_PT, abs=0.01
    )
    assert name_pt({"name_scale": 1.25}) == pytest.approx(
        base_px * float(defaults["name_ratio"]) * 1.25 * _PX_TO_PT, abs=0.02
    )


@needs_font
def test_section_title_scale_changes_the_rendered_section_title_size():
    """`section_title_scale` 只作用于区块标题：正文仍是基准字号（层次不能一起漂）。"""
    defaults = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    base_px = 14.0
    body = "负责后端接口开发与性能优化。" * 3
    resume = ResumeContent(name="张三", summary=body)

    def sizes(format_config: dict) -> tuple[float, float]:
        content = build_resume_pdf(
            resume,
            template="classic",
            page_limit=2,
            font_scale="standard",
            format_config=format_config,
        ).content
        titles = [run for run in _text_runs(content) if run[3].strip() == "个人总结"]
        assert titles, "没读到区块标题"
        body_runs = _body_lines(content, base_px=base_px)
        assert body_runs, "没读到正文行"
        return titles[0][2], body_runs[0][2]

    plain_title, plain_body = sizes({})
    scaled_title, scaled_body = sizes({"section_title_scale": 1.2})

    assert plain_title == pytest.approx(
        base_px * float(defaults["section_title_ratio"]) * _PX_TO_PT, abs=0.01
    )
    assert scaled_title == pytest.approx(
        base_px * float(defaults["section_title_ratio"]) * 1.2 * _PX_TO_PT, abs=0.02
    )
    # 正文一个字都没变：只调标题层次不该改变正文观感。
    assert scaled_body == pytest.approx(plain_body, abs=0.01)

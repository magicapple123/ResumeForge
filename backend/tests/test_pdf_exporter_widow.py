# SPDX-License-Identifier: Apache-2.0
"""W08 孤行/寡行（PDF）：标题 + 整段摘要保持同页，且不制造空白页。

审计口径：PDF 侧"要点不跨页"已有 bullets 的整条预留，但**段落级首尾孤行**没有实现——
一段 3 行摘要落在页尾时会被劈成 "2 行 + 1 行"（寡行）或 "1 行 + 2 行"（孤行），
而草稿的 CSS 多列视图不会这样。本文件钉住：

1. 摘要 + 板块标题作为整体预留：首句与末句必须在**同一页**；
2. 该规则不许把内容推成空白页（每页至少有一行正文）；
3. 整段比一页还高时仍照常劈开（终止保护：换一次页，不死循环、不丢内容）。

用 format_config.section_order 把经历放到摘要之前，并参数化填充长度制造"摘要刚好落在
页尾跨页窗口"的一组样本——只在一个长度上对上不算修好，换一个填充长度又被劈开就是没修。
"""

from __future__ import annotations

import threading

import pytest
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import _PX_TO_PT, build_resume_pdf
from app.services.pdf_exporter.canvas import _MAX_RESERVED_BODY_LINES
from app.services.pdf_exporter.fonts import FONT_FAMILY
from app.services.pdf_exporter.style_blocks import section_title_total_height
from test_pdf_exporter import _filler, _pdf_with_font, needs_font
from test_pdf_exporter_pagination import _page_texts, _record_ensure_space

SUMMARY_MARK_START = "摘要起始甲乙丙"
SUMMARY_MARK_END = "摘要结束丁戊己"

# 摘要正文 130 字 ≈ classic 标准字号下 3 行：足够跨页，又不至于一页放不下。
_SUMMARY_BODY_CHARS = 130
# 经历填充量覆盖"摘要落在页尾前 / 刚好跨页 / 下一页开头"的窗口（版式参数一漂就换一组值）。
_SUMMARY_PUSH_FILLERS = [700, 900, 1100, 1300, 1500, 1700, 1900]
_SECTION_ORDER = ["experience", "summary"]


def _summary_last_resume(push_chars: int) -> ResumeContent:
    """经历在前、摘要在后的简历：经历把摘要推到页尾附近。"""
    return ResumeContent(
        name="张三",
        experience=[
            {
                "company": "某某科技有限公司",
                "role": "后端开发工程师",
                "start_date": "2023-03",
                "end_date": "至今",
                "description": [_filler(push_chars)],
            }
        ],
        summary=f"{SUMMARY_MARK_START}{_filler(_SUMMARY_BODY_CHARS)}{SUMMARY_MARK_END}",
    )


def _summary_pages(content: bytes) -> tuple[int | None, int | None, list[str]]:
    pages = _page_texts(content)
    start = next((index for index, text in enumerate(pages) if SUMMARY_MARK_START in text), None)
    end = next((index for index, text in enumerate(pages) if SUMMARY_MARK_END in text), None)
    return start, end, pages


def _build(push_chars: int, *, page_limit: int = 9):
    return build_resume_pdf(
        _summary_last_resume(push_chars),
        template="classic",
        page_limit=page_limit,
        font_scale="standard",
        format_config={"section_order": _SECTION_ORDER},
    )


@needs_font
@pytest.mark.parametrize("push_chars", _SUMMARY_PUSH_FILLERS)
def test_a_short_summary_is_never_split_across_pages(push_chars: int):
    """摘要（连同板块标题）必须整段落在同一页：既没有孤行也没有寡行。"""
    start, end, pages = _summary_pages(_build(push_chars).content)

    assert start is not None, f"push={push_chars}：摘要首句在 PDF 里找不到"
    assert end is not None, f"push={push_chars}：摘要末句在 PDF 里找不到"
    assert start == end, (
        f"push={push_chars}：摘要被劈到了两页（首句第 {start + 1} 页、末句第 {end + 1} 页）"
    )
    assert all(text for text in pages), "keep_together 不许把某一页推成空白页"


@needs_font
def test_the_summary_samples_do_reach_a_page_break():
    """守卫的守卫：样本里必须真的有"摘要在第二页"的——否则上面的断言是空转。"""
    starts = [_summary_pages(_build(push_chars).content)[0] for push_chars in _SUMMARY_PUSH_FILLERS]

    assert any(start is not None and start >= 1 for start in starts), (
        f"没有任何样本把摘要推到第二页，跨页窗口没覆盖到：{starts}"
    )


@needs_font
def test_a_summary_taller_than_a_page_still_splits_and_terminates():
    """整段摘要高于一页时允许劈开：不能死循环、不能崩、不能丢内容（超高条目终止保护）。"""
    resume = ResumeContent(
        name="张三",
        experience=[{"company": "甲公司", "role": "工程师", "description": ["短要点。"]}],
        summary=f"{SUMMARY_MARK_START}{_filler(12000)}{SUMMARY_MARK_END}",
    )
    box: dict[str, object] = {}

    def render() -> None:
        try:
            box["result"] = build_resume_pdf(
                resume,
                template="classic",
                page_limit=2,
                font_scale="standard",
                format_config={"section_order": _SECTION_ORDER},
            )
        except BaseException as exc:  # noqa: BLE001 - 渲染里的任何异常都要带回主线程
            box["error"] = exc

    worker = threading.Thread(target=render, daemon=True)
    worker.start()
    worker.join(timeout=120)

    assert not worker.is_alive(), "渲染超时（疑似死循环）"
    assert "error" not in box, f"超高摘要渲染抛异常：{box.get('error')!r}"
    result = box["result"]
    assert result.content.startswith(b"%PDF-")
    assert result.pages == 2, f"页数上限是 2，产物应当裁到 2 页，实际 {result.pages}"
    assert result.pages_needed > 2 and result.overflow is True
    pages = _page_texts(result.content)
    assert all(text for text in pages), "超高摘要渲染出了空白页"
    assert any(SUMMARY_MARK_START in text for text in pages), "首句不见了"


@needs_font
def test_short_paragraph_reserves_title_plus_whole_paragraph():
    """短段落整段同页：预留 = 标题总高 + 整段正文高。

    注意标题总高本身已含"至少一行正文"，所以这里补的是**超出一行**的部分——
    再加上整段正文高会重复计入一行，把刚好一页的内容顶出空白（modern/standard 回归
    就是这么来的）。
    """
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    # 量高前必须先设字体：fpdf2 的 dry_run 也要读当前字体度量。
    pdf.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
    text = _filler(_SUMMARY_BODY_CHARS)
    seen = _record_ensure_space(pdf)

    pdf.ensure_title_paragraph(text, base, leading_gap=layout.header_gap)

    title_total = section_title_total_height(pdf, base, leading_gap=layout.header_gap)
    body_height = pdf._dry_run_height(pdf.frame_width, pdf.line_advance(base), text)
    expected = title_total + max(0.0, body_height - pdf.line_advance(base))
    assert seen == pytest.approx([expected])
    # 这个样本确实是"短段落"（≤ 有界行数），否则本用例测不到整段同页。
    assert body_height <= _MAX_RESERVED_BODY_LINES * pdf.line_advance(base)


@needs_font
def test_long_paragraph_reserves_only_bounded_lines():
    """长段落只预留"标题 + 有界行数"，其余交给自然续页（整段预留会凭空多一页）。"""
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = 14.0
    pdf.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
    text = _filler(800)  # 远长于有界行数
    seen = _record_ensure_space(pdf)

    pdf.ensure_title_paragraph(text, base, leading_gap=layout.header_gap)

    title_total = section_title_total_height(pdf, base, leading_gap=layout.header_gap)
    one_line = pdf.line_advance(base)
    body_height = pdf._dry_run_height(pdf.frame_width, one_line, text)
    assert body_height > _MAX_RESERVED_BODY_LINES * one_line, "样本不是长段落，测不到有界预留"
    expected = title_total + (_MAX_RESERVED_BODY_LINES - 1) * one_line
    assert seen == pytest.approx([expected])
    # 反证：整段预留明显更多——这正是"整段保护"不允许用于长段落的原因。
    assert seen[0] < title_total + body_height - one_line

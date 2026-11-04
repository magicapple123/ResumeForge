# SPDX-License-Identifier: Apache-2.0
"""篇幅上限裁剪（1-D 方案 A）的裁点定位 / 直通 / 裁空保护。

这里**不打真实 PDF**：``_measure`` 被替换成"给定文档 -> 给定页数与绘制日志"，这样三种
裁点（point / entry / section）都能用一份手写文档精确钉住，不依赖字体、不依赖机龄。
真实渲染那一趟由 ``test_export_page_parity.py`` 的五格式一致性用例覆盖。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import pytest
from app.services.resume import document_truncate
from app.services.resume.document_html import coerce_document
from app.services.resume.document_truncate import (
    CutDescriptor,
    _cut_document,
    _find_cut,
    _locate_item,
    truncate_document_to_page_limit,
    truncate_for_format,
)

# ===== 固定样本 =====

SUMMARY_ENTRY = "en_summary01"
EXP_ENTRY_1 = "en_exp000001"
EXP_ENTRY_2 = "en_exp000002"
SKILLS_ENTRY = "en_skills01"

EXP_POINT_1 = "it_exp000001"
EXP_POINT_2 = "it_exp000002"
EXP_POINT_3 = "it_exp000003"


def _document() -> dict:
    """三板块文档：总述（1 条）/ 经历（2 段，第一段两个要点）/ 技能（1 条）。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": "hd_name0001",
                    "key": "name",
                    "value": "张三",
                    "placement": "name",
                }
            ]
        },
        "sections": [
            {
                "key": "summary",
                "kind": "text",
                "entries": [
                    {
                        "id": SUMMARY_ENTRY,
                        "items": [{"kind": "text", "id": "it_summary1", "text": "总述一段"}],
                    }
                ],
            },
            {
                "key": "experience",
                "kind": "entries",
                "entries": [
                    {
                        "id": EXP_ENTRY_1,
                        "items": [
                            {"kind": "text", "id": EXP_POINT_1, "text": "第一段要点一"},
                            {"kind": "text", "id": EXP_POINT_2, "text": "第一段要点二"},
                        ],
                    },
                    {
                        "id": EXP_ENTRY_2,
                        "items": [{"kind": "text", "id": EXP_POINT_3, "text": "第二段要点一"}],
                    },
                ],
            },
            {
                "key": "skills",
                "kind": "inline",
                "entries": [
                    {
                        "id": SKILLS_ENTRY,
                        "items": [{"kind": "text", "id": "it_skills001", "text": "Python"}],
                    }
                ],
            },
        ],
    }


@dataclass(frozen=True)
class _Span:
    """``_ResumePDF.spans`` 的最小替身（本模块只读这五个字段）。"""

    kind: str
    section: str
    page: int
    object_id: str | None = None
    point_index: int | None = None
    text: str = ""


@dataclass(frozen=True)
class _Context:
    """``RenderContext`` 的结构替身：本模块只要这些字段（鸭子类型，见 ``PageLimitContext``）。"""

    page_limit: int = 1
    page_limit_is_unlimited: bool = False
    template: str = "classic"
    font_scale: str = "standard"
    format_config: dict | None = None
    margin_mm: float | None = None
    include_photo: bool = True
    language: str = "zh-CN"


def _fake_measure(needed: int, spans: tuple):
    """把 ``_measure`` 换掉：不再真渲染，直接给定页数与绘制日志。"""

    def measure(document, context):  # noqa: ANN001 - 与被替换的函数同形
        return needed, spans

    return measure


def _cut_with(spans: tuple, *, needed: int = 3) -> dict:
    """用给定绘制日志跑一遍裁点定位 + 裁剪，返回裁后文档。"""
    original = _document()
    model = coerce_document(original)
    cut = _find_cut(spans, 1)
    assert cut is not None
    truncated = _cut_document(model, cut)
    assert truncated is not None
    return document_truncate.document_to_json(truncated)


def _ids(document: dict) -> list[str]:
    return [
        item["id"]
        for section in document["sections"]
        for entry in section["entries"]
        for item in entry["items"]
    ]


def _section_keys(document: dict) -> list[str]:
    return [section["key"] for section in document["sections"]]


# ===== 裁点定位：三种整块 =====


def test_point_cut_drops_that_point_and_everything_after():
    """``point`` 裁点 = 该要点及其后：同段里更早的要点、更早的条目、更早的板块都保留。"""
    document = _cut_with(
        (
            _Span("section", "summary", page=1),
            _Span("entry", "experience", page=1, object_id=EXP_ENTRY_1),
            _Span("point", "experience", page=1, object_id=EXP_ENTRY_1, point_index=0),
            _Span(
                "point",
                "experience",
                page=2,
                object_id=EXP_ENTRY_1,
                point_index=1,
                text="第一段要点二",
            ),
        )
    )

    assert _section_keys(document) == ["summary", "experience"]
    # 裁点那一条**整条**不见，而不是"半句"；它前面的要点还在。
    assert _ids(document) == ["it_summary1", EXP_POINT_1]
    # 裁点之后的条目、板块一并消失。
    assert EXP_POINT_3 not in _ids(document)
    assert "skills" not in _section_keys(document)


def test_entry_cut_keeps_earlier_entries_of_the_same_section():
    """``entry`` 裁点 = 该条目及其后；同板块里更早的条目一个字都不动。"""
    document = _cut_with(
        (
            _Span("section", "summary", page=1),
            _Span("entry", "experience", page=1, object_id=EXP_ENTRY_1),
            _Span("point", "experience", page=1, object_id=EXP_ENTRY_1, point_index=0),
            _Span("point", "experience", page=1, object_id=EXP_ENTRY_1, point_index=1),
            _Span("entry", "experience", page=2, object_id=EXP_ENTRY_2, text="第二段"),
        )
    )

    assert _section_keys(document) == ["summary", "experience"]
    assert _ids(document) == ["it_summary1", EXP_POINT_1, EXP_POINT_2]
    assert "skills" not in _section_keys(document)


def test_section_cut_keeps_every_earlier_section():
    """``section`` 裁点 = 该板块及其后：前面的板块整块保留。"""
    document = _cut_with(
        (
            _Span("section", "summary", page=1),
            _Span("entry", "experience", page=1, object_id=EXP_ENTRY_1),
            _Span("section", "skills", page=2, text="专业技能"),
        )
    )

    assert _section_keys(document) == ["summary", "experience"]
    assert _ids(document) == ["it_summary1", EXP_POINT_1, EXP_POINT_2, EXP_POINT_3]


def test_meta_spans_are_not_cut_points():
    """页头联系方式（``meta``）落在第二页不是"内容越界"，不能拿它当裁点切板块。"""
    cut = _find_cut(
        (
            _Span("meta", "", page=2, text="13800000000"),
            _Span("point", "experience", page=2, object_id=EXP_ENTRY_1, point_index=1),
        ),
        1,
    )

    assert cut is not None
    assert cut.kind == "point"
    assert cut.section == "experience"


def test_point_index_is_checked_against_the_text_before_being_trusted():
    """``point_index`` 只是"本批 bullets 内的序号"，必须用文字核对，否则会裁错行。"""
    model = coerce_document(_document())
    entry = model.sections[1].entries[0]

    by_index = CutDescriptor(
        kind="point", section="experience", object_id=EXP_ENTRY_1, point_index=1
    )
    assert _locate_item(entry, by_index) == 1

    # 序号指向第一条、文字却写着第二条：文字优先（序号在分段 bullets 里会重新从 0 数）。
    mismatched = replace(by_index, point_index=0, text_preview="第一段要点二")
    assert _locate_item(entry, mismatched) == 1

    # 只给文字（没有序号）也能定位。
    text_only = CutDescriptor(
        kind="point", section="experience", object_id=EXP_ENTRY_1, text_preview="第一段要点一"
    )
    assert _locate_item(entry, text_only) == 0

    # 文字在条目里找不到：返回 None，调用方退到"整条裁"（绝不猜一个位置切半句）。
    missing = CutDescriptor(
        kind="point", section="experience", object_id=EXP_ENTRY_1, text_preview="不存在的要点"
    )
    assert _locate_item(entry, missing) is None


def test_unlocatable_point_falls_back_to_dropping_the_whole_entry():
    """定位不到那条要点时按**整条**裁——宁可多丢一条，也不切半句。"""
    document = _cut_with(
        (
            _Span("entry", "experience", page=1, object_id=EXP_ENTRY_1),
            _Span(
                "point",
                "experience",
                page=2,
                object_id=EXP_ENTRY_1,
                point_index=9,
                text="对不上的文字",
            ),
        )
    )

    assert _section_keys(document) == ["summary"]
    assert _ids(document) == ["it_summary1"]


# ===== 直通与保护 =====


def test_unlimited_never_measures_and_never_cuts(monkeypatch):
    """「不限篇幅」直通：连测量都不做（``page_limit=0`` 折成的 10 只是 PDF 的渲染保护）。"""
    original = _document()

    def boom(document, context):  # noqa: ANN001 - 被测代码不该走到这里
        raise AssertionError("「不限篇幅」不应该渲染测量")

    monkeypatch.setattr(document_truncate, "_measure", boom)
    outcome = truncate_document_to_page_limit(
        original, _Context(page_limit=10, page_limit_is_unlimited=True)
    )

    assert outcome.document is original
    assert outcome.truncated is False
    assert outcome.pages_needed is None


def test_fits_within_the_limit_returns_the_original_untouched(monkeypatch):
    """装得下就原样返回（同一引用）：不复制、不归一化，产物逐字节不变。"""
    original = _document()
    monkeypatch.setattr(document_truncate, "_measure", _fake_measure(1, ()))

    outcome = truncate_document_to_page_limit(original, _Context())

    assert outcome.document is original
    assert outcome.truncated is False
    assert outcome.pages_needed == 1


def test_never_cuts_everything_away(monkeypatch):
    """裁空保护：裁点落在第一块内容上时**整份不裁**，绝不让文件变成空壳。"""
    original = _document()
    monkeypatch.setattr(
        document_truncate,
        "_measure",
        _fake_measure(4, (_Span("entry", "summary", page=2, object_id=SUMMARY_ENTRY),)),
    )

    outcome = truncate_document_to_page_limit(original, _Context())

    assert outcome.document is original
    assert outcome.truncated is False
    # 页数结论照样如实带回：「没裁」不等于「装得下」。
    assert outcome.pages_needed == 4


def test_unknown_page_count_does_not_claim_overflow(monkeypatch):
    """测不出页数（没有中文字体）时不做任何裁剪，也不谎报结论。"""
    from app.services.pdf_exporter.fonts import ResumePDFError

    original = _document()

    def no_font(document, context):  # noqa: ANN001 - 模拟字体缺失
        raise ResumePDFError("no font")

    monkeypatch.setattr(document_truncate, "_measure", no_font)
    outcome = truncate_document_to_page_limit(original, _Context())

    assert outcome.document is original
    assert outcome.truncated is False
    assert outcome.pages_needed is None


# ===== 格式分派 =====


@pytest.mark.parametrize("export_format", ["pdf", "json"])
def test_pdf_and_json_are_never_truncated_here(export_format, monkeypatch):
    """PDF 自己裁（fit.py）、JSON 是数据交付物：本模块一律直通、不测量。"""
    original = _document()

    def boom(document, context):  # noqa: ANN001 - 被测代码不该走到这里
        raise AssertionError(f"{export_format} 不该在这里测量")

    monkeypatch.setattr(document_truncate, "_measure", boom)
    outcome = truncate_for_format(original, _Context(), export_format=export_format)

    assert outcome.document is original
    assert outcome.truncated is False


# ===== Word 二次收敛：最多 3 轮、不死循环、不删空 =====


def _five_section_document() -> dict:
    """五个单条板块：每次"再裁一刀"都能稳定少掉一个板块。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": []},
        "sections": [
            {
                "key": f"sec{index}",
                "kind": "text",
                "entries": [
                    {
                        "id": f"en_sec{index:05d}",
                        "items": [
                            {"kind": "text", "id": f"it_sec{index:05d}", "text": f"第{index}块"}
                        ],
                    }
                ],
            }
            for index in range(1, 6)
        ],
    }


class _FakeDocx:
    """Word 产物替身：页数恒超限，逼出"再裁一刀"的收敛路径。"""

    def __init__(self, pages: int) -> None:
        self.pages = pages
        self.overflow = pages > 1
        self.content = b"PK"


def _always_cut_last_section(monkeypatch) -> list[int]:
    """让每次测量都指向"最后一个板块"：文档每轮稳定缩小一个板块。"""
    builds: list[int] = []

    def measure(document, context):  # noqa: ANN001 - 与被替换的函数同形
        last = document.sections[-1].key if document.sections else ""
        return 9, (_Span("section", last, page=2),)

    def build(document, context):  # noqa: ANN001 - 同上
        # 第一轮传进来的是 v2 模型（原对象），裁过之后是 v2 dict（裁后序列化）。
        sections = document["sections"] if isinstance(document, dict) else document.sections
        builds.append(len(sections))
        return _FakeDocx(pages=9)

    monkeypatch.setattr(document_truncate, "_measure", measure)
    monkeypatch.setattr(document_truncate, "_build_docx", build)
    return builds


def test_docx_convergence_stops_after_three_rounds(monkeypatch):
    """Word 一直说"还超"时最多建 3 次：不许死循环，也不许把内容删空。"""
    builds = _always_cut_last_section(monkeypatch)

    outcome = truncate_for_format(_five_section_document(), _Context(), export_format="docx")

    assert len(builds) == 3
    assert outcome.rounds == 3
    # 仍超限就保留内容并如实标 overflow（界面回 X-Resume-Overflow: true）。
    assert outcome.docx is not None and outcome.docx.overflow is True
    assert len(outcome.document["sections"]) == 2


def test_docx_convergence_never_empties_the_document(monkeypatch):
    """放宽轮数上限也只是"更早停"：裁到只剩一块时停止，绝不留空文件。"""
    builds = _always_cut_last_section(monkeypatch)

    outcome = truncate_for_format(
        _five_section_document(), _Context(), export_format="docx", max_rounds=10
    )

    assert len(builds) == 4
    assert len(outcome.document["sections"]) == 1
